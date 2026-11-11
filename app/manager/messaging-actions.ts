"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { audit } from "@/lib/audit";
import { one, q, tx } from "@/lib/db";
import { field, flag, personName, saveNameParts } from "@/lib/http";
import { isUuid, newPublicId } from "@/lib/ids";
import {
  logConsent,
  MARKETING_SMS_WORDING,
  normalizeEmail,
  normalizePhone,
  optOutEmail,
  optOutPhone,
  SERVICE_SMS_WORDING,
} from "@/lib/messaging/compliance";
import { smsProvider } from "@/lib/messaging/providers";
import { deliverDue, getTemplate, handleInbound, notifySafely, queueMessage, varsFor } from "@/lib/messaging/send";
import { render } from "@/lib/messaging/templates";
import { requireManager } from "@/lib/session";

const ACTOR = "manager";

function backTo(fd: FormData, fallback: string) {
  const b = field(fd, "back", 300);
  return b.startsWith("/manager") ? b : fallback;
}
function done(fd: FormData, ok: string, fallback = "/manager/messages"): never {
  const path = backTo(fd, fallback);
  redirect(`${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(ok)}`);
}
function fail(fd: FormData, error: string, fallback = "/manager/messages"): never {
  const path = backTo(fd, fallback);
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);
}
const long = (fd: FormData, name: string, max: number) => {
  const v = fd.get(name);
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
};

// ---------- Templates ----------

export async function saveTemplate(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  const name = field(fd, "name", 80);
  const sms = long(fd, "sms_body", 600);
  const email = long(fd, "email_body", 5000);
  const subject = field(fd, "email_subject", 150);
  if (!name) fail(fd, "Give the template a name.");
  if (!sms && !email) fail(fd, "Write the text wording, the email wording, or both.");
  if (email && !subject) fail(fd, "The email needs a subject line.");
  const purpose = field(fd, "purpose", 12) === "marketing" ? "marketing" : "service";
  if (isUuid(id)) {
    const t = await one<{ key: string | null }>("select key from message_templates where id = $1", [id]);
    if (!t) fail(fd, "Template not found.");
    // Built-in templates keep their purpose: a visit reminder can never be relabeled as marketing or the reverse.
    await q(
      `update message_templates set name = $2, sms_body = $3, email_subject = $4, email_body = $5, auto_send = $6, active = $7,
         purpose = case when key is null then $8 else purpose end, updated_at = now() where id = $1`,
      [id, name, sms, subject, email, flag(fd, "auto_send"), flag(fd, "active"), purpose],
    );
    await audit(q, ACTOR, "update", "template", id, { name });
    done(fd, "Template saved.", "/manager/templates");
  }
  const row = await one<{ id: string }>(
    `insert into message_templates (name, purpose, sms_body, email_subject, email_body, auto_send, active)
     values ($1, $2, $3, $4, $5, false, true) returning id`,
    [name, purpose, sms, subject, email],
  );
  await audit(q, ACTOR, "create", "template", row!.id, { name, purpose });
  redirect(`/manager/templates/${row!.id}?ok=${encodeURIComponent("Template created.")}`);
}

export async function deleteTemplate(fd: FormData) {
  await requireManager();
  if (!flag(fd, "confirm")) fail(fd, "Tick “Yes, delete permanently” to confirm.");
  const id = field(fd, "id");
  const t = isUuid(id) ? await one<{ key: string | null; name: string }>("select key, name from message_templates where id = $1", [id]) : null;
  if (!t) fail(fd, "Template not found.");
  if (t.key) fail(fd, "Built-in templates can be turned off but not deleted.");
  await q("delete from message_templates where id = $1", [id]);
  await audit(q, ACTOR, "delete", "template", id, { name: t.name });
  redirect(`/manager/templates?ok=${encodeURIComponent(`${t.name} deleted.`)}`);
}

// ---------- One customer ----------

// A manager typing to one customer, or sending them a template. Sent at once when the rules allow it.
export async function sendToCustomer(fd: FormData) {
  await requireManager();
  const customerId = field(fd, "customer_id");
  if (!isUuid(customerId)) fail(fd, "Customer not found.");
  const channel = field(fd, "channel", 6) === "email" ? "email" : "sms";
  const templateId = field(fd, "template_id");
  let body = long(fd, "body", channel === "sms" ? 600 : 5000);
  let subject = field(fd, "subject", 150);
  let purpose: "service" | "marketing" = flag(fd, "marketing") ? "marketing" : "service";
  let tid: string | null = null;
  if (isUuid(templateId)) {
    const t = await getTemplate(templateId);
    if (!t) fail(fd, "Template not found.");
    const vars = await varsFor(customerId);
    body = render(channel === "sms" ? t.sms_body : t.email_body, vars);
    subject = render(t.email_subject, vars);
    purpose = t.purpose;
    tid = t.id;
    if (!body) fail(fd, `That template has no ${channel === "sms" ? "text" : "email"} wording.`);
  }
  if (!body) fail(fd, "Write a message first.");
  if (channel === "email" && !subject) fail(fd, "Add a subject line.");
  const r = await queueMessage({
    customerId, purpose, channel, sms: body, email: body, subject, templateId: tid, manual: true, createdBy: ACTOR,
  });
  if (r.status === "blocked" || r.status === "skipped") fail(fd, `Not sent. ${r.reason}`);
  await audit(q, ACTOR, "send", "message", r.id ?? null, { channel, purpose });
  const sent = await deliverDue();
  const row = r.id ? await one<{ status: string; error: string; send_after: string | null; block_reason: string }>("select status, error, send_after, block_reason from messages where id = $1", [r.id]) : null;
  if (row?.status === "failed") fail(fd, `Not sent. ${row.error}`);
  if (row?.status === "blocked") fail(fd, `Not sent. ${row.block_reason}`);
  if (row?.status === "queued") done(fd, "Texts are held between 9 pm and 8 am Pacific. This one will go out at 8 am.");
  done(fd, sent.sent ? "Sent." : "Queued.");
}

// Used only in test mode, to try the conversation screens before a text provider is connected.
export async function simulateReply(fd: FormData) {
  await requireManager();
  if (smsProvider().live) fail(fd, "A real text provider is connected. Simulated replies are off.");
  const customerId = field(fd, "customer_id");
  const c = isUuid(customerId) ? await one<{ phone: string }>("select phone from customers where id = $1", [customerId]) : null;
  const from = normalizePhone(c?.phone ?? "");
  if (!from) fail(fd, "This customer has no valid mobile number.");
  const body = long(fd, "body", 600);
  if (!body) fail(fd, "Type the customer's reply.");
  await handleInbound({ channel: "sms", from, to: "", body, providerId: `sim-${randomUUID()}` });
  done(fd, "Simulated reply recorded.");
}

export async function markThreadRead(fd: FormData) {
  await requireManager();
  const customerId = field(fd, "customer_id");
  if (isUuid(customerId)) await q("update messages set read_at = now() where customer_id = $1 and direction = 'in' and read_at is null", [customerId]);
  else await q("update messages set read_at = now() where customer_id is null and direction = 'in' and read_at is null");
  done(fd, "Marked as read.");
}

// ---------- Approval ----------

export async function approveMessage(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Message not found.");
  const m = await one<{ channel: string }>("select channel from messages where id = $1 and status = 'pending_approval'", [id]);
  if (!m) fail(fd, "That message was already handled.");
  const body = long(fd, "body", m.channel === "sms" ? 600 : 5000);
  if (!body) fail(fd, "The message is empty.");
  await q("update messages set status = 'queued', body = $2, subject = case when channel = 'email' then $3 else subject end, approved_by = $4 where id = $1 and status = 'pending_approval'", [
    id, body, field(fd, "subject", 150), ACTOR,
  ]);
  await audit(q, ACTOR, "approve", "message", id);
  after(() => deliverDue());
  done(fd, "Approved. It is being sent.");
}

export async function discardMessage(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Message not found.");
  await q("update messages set status = 'cancelled', block_reason = 'Discarded by manager.' where id = $1 and status in ('pending_approval', 'queued', 'failed', 'blocked')", [id]);
  await audit(q, ACTOR, "discard", "message", id);
  done(fd, "Discarded.");
}

export async function approveBatch(fd: FormData) {
  await requireManager();
  const batch = field(fd, "batch_id");
  if (!isUuid(batch)) fail(fd, "Group not found.");
  const op = field(fd, "op", 10);
  const rows =
    op === "discard"
      ? await q("update messages set status = 'cancelled', block_reason = 'Discarded by manager.' where batch_id = $1 and status = 'pending_approval' returning id", [batch])
      : await q("update messages set status = 'queued', approved_by = $2 where batch_id = $1 and status = 'pending_approval' returning id", [batch, ACTOR]);
  await audit(q, ACTOR, op === "discard" ? "discard_batch" : "approve_batch", "message", batch, { count: rows.length });
  if (op !== "discard") after(() => deliverDue(200));
  done(fd, op === "discard" ? `${rows.length} message(s) discarded.` : `${rows.length} message(s) approved and sending.`);
}

export async function retryMessage(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Message not found.");
  // A retry goes back through every rule, so a blocked message only sends if its reason has been fixed.
  await q("update messages set status = 'queued', error = '', block_reason = '' where id = $1 and status in ('failed', 'blocked') and direction = 'out'", [id]);
  const r = await deliverDue();
  done(fd, r.sent ? "Sent." : "Still not sent. Check the reason shown.");
}

// ---------- Groups ----------

const AUDIENCES: Record<string, string> = {
  active: "c.status = 'active'",
  prospects: "c.status in ('prospect', 'lead')",
  leads: "c.status = 'lead'",
  all: "c.status in ('active', 'paused', 'prospect', 'lead')",
};

// Prepares one message per person in a group. Nothing is sent: every message waits for approval,
// and people the rules do not allow are listed as blocked with the reason.
export async function queueGroup(fd: FormData) {
  await requireManager();
  const templateId = field(fd, "template_id");
  const t = isUuid(templateId) ? await getTemplate(templateId) : null;
  if (!t) fail(fd, "Template not found.");
  const audience = field(fd, "audience", 20);
  const marina = field(fd, "marina_id");
  let where = AUDIENCES[audience];
  const params: unknown[] = [];
  if (audience === "marina" && isUuid(marina)) {
    where = "c.status in ('active', 'paused') and exists (select 1 from boats b where b.customer_id = c.id and b.marina_id = $1 and b.status <> 'sold')";
    params.push(marina);
  }
  if (!where) fail(fd, "Choose who should receive this.");
  const people = await q<{ id: string }>(`select c.id from customers c where ${where} order by c.name limit 2000`, params);
  if (!people.length) fail(fd, "Nobody is in that group.");
  const batch = randomUUID();
  const tally = { ready: 0, blocked: 0 };
  for (const p of people) {
    const vars = await varsFor(p.id);
    const r = await queueMessage({
      customerId: p.id, purpose: t.purpose, sms: render(t.sms_body, vars), subject: render(t.email_subject, vars), email: render(t.email_body, vars),
      templateId: t.id, batchId: batch, needsApproval: true, createdBy: ACTOR,
    });
    if (r.status === "pending_approval") tally.ready++;
    else tally.blocked++;
  }
  await audit(q, ACTOR, "queue_group", "template", t.id, { audience, ...tally });
  redirect(`/manager/messages?tab=approval&ok=${encodeURIComponent(`${tally.ready} message(s) ready for your approval. ${tally.blocked} person(s) cannot be contacted under the rules; see Problems for why.`)}`);
}

// ---------- Contact details and consent ----------

export async function saveContactSettings(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  const c = isUuid(id)
    ? await one<{ name: string; phone: string; email: string; sms_consent: boolean; promo_sms_consent: boolean; sms_opted_out_at: string | null; email_opted_out_at: string | null }>(
        "select name, phone, email, sms_consent, promo_sms_consent, sms_opted_out_at, email_opted_out_at from customers where id = $1",
        [id],
      )
    : null;
  if (!c) fail(fd, "Customer not found.");
  const pref = ["text", "email", "none"].includes(field(fd, "contact_pref", 8)) ? field(fd, "contact_pref", 8) : "text";
  const wantSms = flag(fd, "sms_consent");
  const wantPromo = flag(fd, "promo_sms_consent");
  const how = field(fd, "consent_method", 200);
  const granting = (wantSms && !c.sms_consent) || (wantPromo && !c.promo_sms_consent);
  if (granting && !how) fail(fd, "Say how the customer gave consent (for example: signed service agreement on Nov 3). This is your record if it is ever questioned.");
  if (wantPromo && !c.promo_sms_consent && !flag(fd, "promo_written")) {
    fail(fd, "Marketing texts need the customer's consent in writing. Tick the box confirming you have it on file.");
  }
  const phone = normalizePhone(c.phone) ?? c.phone;
  await tx(async (t) => {
    await t(
      `update customers set address1 = $2, address2 = $3, city = $4, state = $5, postal_code = $6, contact_pref = $7,
         sms_consent = $8, promo_sms_consent = $9,
         consent_at = case when $8 and not sms_consent then now() else consent_at end,
         consent_text = case when $8 and not sms_consent then $10 else consent_text end,
         promo_sms_consent_at = case when $9 and not promo_sms_consent then now() when not $9 then null else promo_sms_consent_at end
       where id = $1`,
      [id, field(fd, "address1", 120), field(fd, "address2", 120), field(fd, "city", 80), field(fd, "state", 20).toUpperCase(), field(fd, "postal_code", 12), pref, wantSms, wantPromo, SERVICE_SMS_WORDING],
    );
    const log = (purpose: "service" | "marketing", action: "granted" | "revoked", wording: string) =>
      logConsent(t, { customerId: id, name: c.name, address: phone, channel: "sms", purpose, action, method: action === "granted" ? `Recorded by manager: ${how}` : "Removed by manager", wording, actor: ACTOR });
    if (wantSms !== c.sms_consent) await log("service", wantSms ? "granted" : "revoked", SERVICE_SMS_WORDING);
    if (wantPromo !== c.promo_sms_consent) await log("marketing", wantPromo ? "granted" : "revoked", MARKETING_SMS_WORDING);
    if (flag(fd, "email_opt_out") && !c.email_opted_out_at) await optOutEmail(t, id, "Recorded by manager", ACTOR);
    if (!flag(fd, "email_opt_out") && c.email_opted_out_at && flag(fd, "email_resubscribe")) {
      await t("update customers set email_opted_out_at = null where id = $1", [id]);
      await logConsent(t, { customerId: id, name: c.name, address: c.email, channel: "email", purpose: "marketing", action: "granted", method: `Recorded by manager: ${how || "customer asked to resubscribe"}`, actor: ACTOR });
    }
    await audit(t, ACTOR, "update", "contact_settings", id, { pref, sms: wantSms, promo: wantPromo });
  });
  // A customer newly opted in to texts gets the confirmation text the carriers require.
  if (wantSms && !c.sms_consent && !c.sms_opted_out_at) {
    await notifySafely("opt_in", { customerId: id, channel: "sms", dedupeKey: `optin:${id}:${Date.now()}` });
    after(() => deliverDue());
  }
  done(fd, "Contact settings saved.", `/manager/customers/${id}`);
}

// The customer asked a person (not by texting STOP) to stop texts. Only the customer can undo it, by texting START.
export async function stopTexts(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  const c = isUuid(id) ? await one<{ phone: string }>("select phone from customers where id = $1", [id]) : null;
  const phone = normalizePhone(c?.phone ?? "");
  if (!phone) fail(fd, "This customer has no valid mobile number.");
  await tx((t) => optOutPhone(t, phone, "Customer asked staff to stop texts", ACTOR));
  done(fd, "Texts stopped for this number. Only the customer can restart them, by texting START.", `/manager/customers/${id}`);
}

// ---------- Prospects ----------

export async function createProspect(fd: FormData) {
  await requireManager();
  const back = "/manager/prospects/new";
  const person = personName(fd);
  const name = person.name;
  const phone = field(fd, "phone", 30);
  const email = field(fd, "email", 120);
  if (!person.first) fail(fd, "Enter a first name.", back);
  if (phone && !normalizePhone(phone)) fail(fd, "That phone number is not a valid US number.", back);
  if (email && !normalizeEmail(email)) fail(fd, "That email address does not look right.", back);
  const dup = await one<{ id: string; name: string }>(
    `select id, name from customers where ($1 <> '' and regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g') and phone <> '')
       or ($2 <> '' and lower(email) = lower($2)) limit 1`,
    [phone, email],
  );
  if (dup && !flag(fd, "allow_duplicate")) fail(fd, `${dup.name} already has that phone or email. Tick “Add anyway” if this is a different person.`, back);
  const sms = flag(fd, "sms_consent");
  const promo = flag(fd, "promo_sms_consent");
  const how = field(fd, "consent_method", 200);
  if ((sms || promo) && !how) fail(fd, "Say how this person gave consent to texts.", back);
  if (promo && !flag(fd, "promo_written")) fail(fd, "Marketing texts need consent in writing. Tick the box confirming you have it on file.", back);
  const id = await tx(async (t) => {
    const row = (
      await t<{ id: string }>(
        `insert into customers (name, phone, email, status, notes, portal_token, source, interest, address1, address2, city, state, postal_code,
           contact_pref, sms_consent, consent_at, consent_text, promo_sms_consent, promo_sms_consent_at)
         values ($1, $2, $3, 'prospect', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) returning id`,
        [
          name, phone, email, field(fd, "notes", 1000), newPublicId(), field(fd, "source", 60) || "manager", field(fd, "interest", 200),
          field(fd, "address1", 120), field(fd, "address2", 120), field(fd, "city", 80), field(fd, "state", 20).toUpperCase(), field(fd, "postal_code", 12),
          sms || promo ? "text" : email ? "email" : "none", sms, sms ? new Date().toISOString() : null, sms ? SERVICE_SMS_WORDING : "", promo, promo ? new Date().toISOString() : null,
        ],
      )
    )[0];
    await saveNameParts(t, "customers", row.id, person);
    const addr = normalizePhone(phone) ?? phone;
    if (sms) await logConsent(t, { customerId: row.id, name, address: addr, channel: "sms", purpose: "service", action: "granted", method: `Recorded by manager: ${how}`, wording: SERVICE_SMS_WORDING, actor: ACTOR });
    if (promo) await logConsent(t, { customerId: row.id, name, address: addr, channel: "sms", purpose: "marketing", action: "granted", method: `Recorded by manager: ${how}`, wording: MARKETING_SMS_WORDING, actor: ACTOR });
    await audit(t, ACTOR, "create", "prospect", row.id, { name });
    return row.id;
  });
  redirect(`/manager/customers/${id}?ok=${encodeURIComponent("Prospect added.")}`);
}

export async function convertProspect(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Prospect not found.");
  await q("update customers set status = 'active', converted_at = now(), converted_by = 'manager', stage_changed_at = now() where id = $1 and status in ('prospect', 'lead', 'dnc')", [id]);
  await audit(q, ACTOR, "convert", "prospect", id);
  done(fd, "Now a customer. Add their boat and cleaning plan below.", `/manager/customers/${id}`);
}
