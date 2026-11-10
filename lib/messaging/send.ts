import { randomBytes } from "crypto";
import { audit } from "../audit";
import { getConfig } from "../config";
import { addDays, fmtDay, todayLA } from "../dates";
import { one, q, tx } from "../db";
import {
  canSend,
  clock,
  finishSms,
  helpReply,
  keywordOf,
  normalizeEmail,
  normalizePhone,
  optInPhone,
  optOutPhone,
  RECIPIENT_COLS,
  sendAfter,
  startReply,
  stopReply,
  type Channel,
  type Purpose,
  type Recipient,
} from "./compliance";
import { baseUrl, emailProvider, messagingStatus, smsProvider, type Inbound, type StatusUpdate } from "./providers";
import { render, type Vars } from "./templates";

export type Template = {
  id: string;
  key: string | null;
  name: string;
  purpose: Purpose;
  sms_body: string;
  email_subject: string;
  email_body: string;
  auto_send: boolean;
  active: boolean;
};

type Queued = { status: "queued" | "pending_approval" | "blocked" | "skipped"; id?: string; channel?: Channel; reason?: string };

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function emailHtml(text: string, footer: string) {
  const linked = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#12202e;max-width:560px">${linked}<hr style="border:none;border-top:1px solid #d8e0e8;margin:24px 0 12px"><div style="font-size:12px;color:#5b6b7b">${escapeHtml(footer).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</div></div>`;
}

async function unsubscribeUrl(customerId: string): Promise<string> {
  const row = await one<{ unsubscribe_token: string | null }>("select unsubscribe_token from customers where id = $1", [customerId]);
  let token = row?.unsubscribe_token;
  if (!token) {
    token = randomBytes(18).toString("base64url");
    await q("update customers set unsubscribe_token = $2 where id = $1 and unsubscribe_token is null", [customerId, token]);
    token = (await one<{ unsubscribe_token: string }>("select unsubscribe_token from customers where id = $1", [customerId]))!.unsubscribe_token;
  }
  return `${baseUrl()}/unsubscribe/${token}`;
}

export async function getRecipient(customerId: string): Promise<Recipient | null> {
  return one<Recipient>(`select ${RECIPIENT_COLS} from customers where id = $1`, [customerId]);
}

export async function getTemplate(keyOrId: string): Promise<Template | null> {
  return one<Template>(
    `select id, key, name, purpose, sms_body, email_subject, email_body, auto_send, active from message_templates
     where ${/^[0-9a-f-]{36}$/.test(keyOrId) ? "id = $1::uuid" : "key = $1"}`,
    [keyOrId],
  );
}

// Standard merge values for a customer (and a visit, when given).
export async function varsFor(customerId: string, jobId?: string | null, extra: Vars = {}): Promise<Vars> {
  const { businessName } = getConfig();
  const c = await one<{ name: string; portal_token: string }>("select name, portal_token from customers where id = $1", [customerId]);
  const vars: Vars = {
    business: businessName,
    name: c?.name ?? "",
    first_name: (c?.name ?? "").split(" ")[0],
    link: c ? `${baseUrl()}/portal/${c.portal_token}` : "",
  };
  if (jobId) {
    const j = await one<{ boat: string; scheduled_date: string; service: string | null; public_id: string; completion_message: string; skip_reason: string }>(
      `select b.name as boat, j.scheduled_date, s.name as service, j.public_id, j.completion_message, j.skip_reason
       from jobs j join boats b on b.id = j.boat_id left join services s on s.id = j.service_id where j.id = $1`,
      [jobId],
    );
    if (j) {
      vars.boat = j.boat;
      vars.date = fmtDay(j.scheduled_date, { weekday: "long", month: "long", day: "numeric" });
      vars.service = j.service ?? "cleaning";
      vars.message = j.completion_message;
      vars.reason = j.skip_reason;
    }
  } else {
    const b = await one<{ name: string }>("select name from boats where customer_id = $1 and status <> 'sold' order by created_at limit 1", [customerId]);
    vars.boat = b?.name ?? "your boat";
  }
  return { ...vars, ...extra };
}

// Creates one outgoing message for one customer, on the channel they prefer when the rules allow it,
// otherwise on the other channel. When neither is allowed, a "blocked" record says why.
export async function queueMessage(m: {
  customerId: string;
  purpose: Purpose;
  sms?: string;
  subject?: string;
  email?: string;
  channel?: Channel; // force one channel (a manager typing in a conversation)
  templateId?: string | null;
  jobId?: string | null;
  batchId?: string | null;
  dedupeKey?: string | null;
  manual?: boolean;
  needsApproval?: boolean;
  createdBy?: string;
}): Promise<Queued> {
  const c = await getRecipient(m.customerId);
  if (!c) return { status: "skipped", reason: "Customer not found." };
  const status = messagingStatus();
  const order: Channel[] = m.channel ? [m.channel] : c.contact_pref === "email" ? ["email", "sms"] : ["sms", "email"];
  const usable = order.filter((ch) => (ch === "sms" ? Boolean(m.sms?.trim()) : Boolean(m.email?.trim())));
  if (!usable.length) return { status: "skipped", reason: "The template has no wording for this channel." };

  let firstBlock: { channel: Channel; reason: string } | null = null;
  for (const channel of usable) {
    const verdict = await canSend(c, channel, m.purpose, { manual: m.manual, postalAddress: status.postalAddress });
    if (!verdict.ok) {
      firstBlock ??= { channel, reason: verdict.reason };
      continue;
    }
    const after = await sendAfter(c, channel, Boolean(m.manual));
    const row = await one<{ id: string }>(
      `insert into messages (customer_id, channel, direction, purpose, template_id, job_id, batch_id, to_addr, subject, body, status,
         dedupe_key, manual, created_by, send_after)
       values ($1, $2, 'out', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (dedupe_key) do nothing returning id`,
      [
        c.id, channel, m.purpose, m.templateId ?? null, m.jobId ?? null, m.batchId ?? null, verdict.to,
        channel === "email" ? (m.subject ?? "").trim() : "",
        (channel === "sms" ? m.sms! : m.email!).trim(),
        m.needsApproval ? "pending_approval" : "queued",
        m.dedupeKey ? `${m.dedupeKey}:${channel}` : null, Boolean(m.manual), m.createdBy ?? "system", after,
      ],
    );
    if (!row) return { status: "skipped", reason: "Already sent." };
    return { status: m.needsApproval ? "pending_approval" : "queued", id: row.id, channel };
  }
  // Nothing allowed: keep a record so the manager can see why this customer heard nothing.
  const b = firstBlock!;
  await q(
    `insert into messages (customer_id, channel, direction, purpose, template_id, job_id, batch_id, to_addr, subject, body, status, block_reason,
       dedupe_key, manual, created_by)
     values ($1, $2, 'out', $3, $4, $5, $6, $7, $8, $9, 'blocked', $10, $11, $12, $13) on conflict (dedupe_key) do nothing`,
    [
      c.id, b.channel, m.purpose, m.templateId ?? null, m.jobId ?? null, m.batchId ?? null, b.channel === "sms" ? c.phone : c.email,
      b.channel === "email" ? (m.subject ?? "") : "", (b.channel === "sms" ? m.sms : m.email) ?? "", b.reason,
      m.dedupeKey ? `${m.dedupeKey}:${b.channel}` : null, Boolean(m.manual), m.createdBy ?? "system",
    ],
  );
  return { status: "blocked", channel: b.channel, reason: b.reason };
}

// Sends an event-driven template ("photos_ready", "visit_reminder", ...) to one customer.
export async function notify(key: string, o: { customerId: string; jobId?: string | null; vars?: Vars; dedupeKey?: string; channel?: Channel }): Promise<Queued> {
  const t = await getTemplate(key);
  if (!t || !t.active) return { status: "skipped", reason: "Template is turned off." };
  const vars = await varsFor(o.customerId, o.jobId, o.vars);
  return queueMessage({
    customerId: o.customerId,
    purpose: t.purpose,
    sms: render(t.sms_body, vars),
    subject: render(t.email_subject, vars),
    email: render(t.email_body, vars),
    channel: o.channel,
    templateId: t.id,
    jobId: o.jobId,
    dedupeKey: o.dedupeKey ?? null,
    needsApproval: !t.auto_send,
    createdBy: `auto:${key}`,
  });
}

// Never lets a messaging problem break the action that triggered it (finishing a visit, approving a request).
export async function notifySafely(key: string, o: Parameters<typeof notify>[1]) {
  try {
    await notify(key, o);
  } catch (err) {
    console.error("notify failed", key, err);
  }
}

// Delivers messages that are due. Every message is re-checked against the rules at this moment, because
// consent can change between queueing and sending.
export async function deliverDue(limit = 25): Promise<{ sent: number; failed: number; blocked: number }> {
  const out = { sent: 0, failed: 0, blocked: 0 };
  const { businessName } = getConfig();
  const status = messagingStatus();
  // Messages claimed 10 minutes ago and never finished belong to a run that died; put them back.
  await q("update messages set status = 'queued' where status = 'sending' and claimed_at < now() - interval '10 minutes'");
  const due = await q<{ id: string; customer_id: string | null; channel: Channel; purpose: Purpose; subject: string; body: string; manual: boolean }>(
    `update messages set status = 'sending', claimed_at = now() where id in (
       select id from messages where status = 'queued' and direction = 'out' and (send_after is null or send_after <= now())
       order by created_at limit $1 for update skip locked)
     returning id, customer_id, channel, purpose, subject, body, manual`,
    [limit],
  );
  for (const m of due) {
    try {
      const c = m.customer_id ? await getRecipient(m.customer_id) : null;
      if (!c) {
        await q("update messages set status = 'cancelled', block_reason = 'Customer was deleted.' where id = $1", [m.id]);
        continue;
      }
      const verdict = await canSend(c, m.channel, m.purpose, { manual: m.manual, postalAddress: status.postalAddress });
      if (!verdict.ok) {
        await q("update messages set status = 'blocked', block_reason = $2 where id = $1", [m.id, verdict.reason]);
        out.blocked++;
        continue;
      }
      const wait = await sendAfter(c, m.channel, m.manual);
      if (wait) {
        await q("update messages set status = 'queued', send_after = $2 where id = $1", [m.id, wait]);
        continue;
      }
      if (m.channel === "sms") {
        const p = smsProvider();
        if (p.missing().length) throw new Error(`Text provider is not set up: ${p.missing().join(", ")}`);
        const first = !(await one("select 1 from messages where channel = 'sms' and direction = 'out' and to_addr = $1 and status in ('sent', 'delivered') limit 1", [verdict.to]));
        const body = finishSms(m.body, { business: businessName, purpose: m.purpose, firstToNumber: first });
        const r = await p.send({ to: verdict.to, body, statusUrl: `${status.baseUrl}/api/messaging/inbound/${p.name}` });
        await q("update messages set status = 'sent', sent_at = now(), provider = $2, provider_id = $3, body = $4, to_addr = $5, error = '' where id = $1", [m.id, p.name, r.id, body, verdict.to]);
      } else {
        const p = emailProvider();
        if (p.missing().length) throw new Error(`Email provider is not set up: ${p.missing().join(", ")}`);
        const headers: Record<string, string> = {};
        let footer = `${businessName}${status.postalAddress ? `\n${status.postalAddress}` : ""}`;
        if (m.purpose === "marketing") {
          const unsub = await unsubscribeUrl(c.id);
          footer += `\nYou are receiving this because you gave us your email address. Unsubscribe: ${unsub}`;
          headers["List-Unsubscribe"] = `<${unsub}>`;
          headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
        } else {
          footer += "\nThis message is about your boat cleaning service.";
        }
        const r = await p.send({ to: verdict.to, subject: m.subject || businessName, text: `${m.body}\n\n--\n${footer}`, html: emailHtml(m.body, footer), headers });
        await q("update messages set status = 'sent', sent_at = now(), provider = $2, provider_id = $3, to_addr = $4, error = '' where id = $1", [m.id, p.name, r.id, verdict.to]);
      }
      out.sent++;
    } catch (err) {
      await q("update messages set status = 'failed', error = $2 where id = $1", [m.id, String((err as Error).message ?? err).slice(0, 500)]);
      out.failed++;
    }
  }
  return out;
}

// Reminders for tomorrow's visits. Runs once a day; the dedupe key makes a second run harmless.
export async function queueReminders(): Promise<number> {
  const tomorrow = addDays(todayLA(), 1);
  const jobs = await q<{ id: string; customer_id: string }>(
    `select j.id, b.customer_id from jobs j join boats b on b.id = j.boat_id join customers c on c.id = b.customer_id
     where j.scheduled_date = $1 and j.status = 'scheduled' and c.status = 'active'`,
    [tomorrow],
  );
  let n = 0;
  for (const j of jobs) {
    const r = await notify("visit_reminder", { customerId: j.customer_id, jobId: j.id, dedupeKey: `reminder:${j.id}:${tomorrow}` });
    if (r.status === "queued" || r.status === "pending_approval") n++;
  }
  return n;
}

// ---------- Incoming ----------

async function autoReply(customerId: string | null, to: string, body: string, label: string) {
  // Confirmations of STOP, START and HELP are sent directly: the opt-out rules explicitly allow one such reply.
  const p = smsProvider();
  let providerId = "";
  let error = "";
  try {
    if (p.missing().length) throw new Error("Text provider is not set up.");
    providerId = (await p.send({ to, body, statusUrl: `${baseUrl()}/api/messaging/inbound/${p.name}` })).id;
  } catch (err) {
    error = String((err as Error).message ?? err).slice(0, 300);
  }
  await q(
    `insert into messages (customer_id, channel, direction, purpose, to_addr, body, status, provider, provider_id, error, created_by, sent_at)
     values ($1, 'sms', 'out', 'service', $2, $3, $4, $5, $6, $7, $8, now())`,
    [customerId, to, body, error ? "failed" : "sent", p.name, providerId, error, `auto:${label}`],
  );
}

export async function handleInbound(inb: Inbound): Promise<void> {
  const { businessName } = getConfig();
  if (inb.providerId && (await one("select 1 from messages where provider_id = $1 and direction = 'in'", [inb.providerId]))) return; // vendor retry

  if (inb.channel === "email") {
    const from = normalizeEmail(inb.from.replace(/^.*<([^>]+)>.*$/, "$1")) ?? inb.from.slice(0, 200);
    const c = await one<{ id: string }>("select id from customers where lower(email) = $1 order by status = 'active' desc, created_at desc limit 1", [from]);
    await q(
      `insert into messages (customer_id, channel, direction, from_addr, to_addr, subject, body, status, provider_id)
       values ($1, 'email', 'in', $2, $3, $4, $5, 'received', $6)`,
      [c?.id ?? null, from, inb.to.slice(0, 200), (inb.subject ?? "").slice(0, 300), inb.body.slice(0, 5000), inb.providerId],
    );
    return;
  }

  const from = normalizePhone(inb.from) ?? inb.from.slice(0, 40);
  const digits = from.replace(/\D/g, "");
  const c = await one<{ id: string; name: string }>(
    `select id, name from customers where regexp_replace(phone, '[^0-9]', '', 'g') in ($1, $2) and phone <> ''
     order by status = 'active' desc, created_at desc limit 1`,
    [digits, digits.replace(/^1/, "")],
  );
  const body = inb.body.slice(0, 2000);
  const word = keywordOf(body);
  const provider = smsProvider();
  const store = (read: boolean) =>
    q(
      `insert into messages (customer_id, channel, direction, from_addr, to_addr, body, status, provider, provider_id, read_at)
       values ($1, 'sms', 'in', $2, $3, $4, 'received', $5, $6, ${read ? "now()" : "null"})`,
      [c?.id ?? null, from, inb.to.slice(0, 40), body, provider.name, inb.providerId],
    );

  if (word === "stop") {
    await store(true);
    await tx((t) => optOutPhone(t, from, `Texted "${body.slice(0, 60)}"`, "customer"));
    if (!provider.answersKeywords) await autoReply(c?.id ?? null, from, stopReply(businessName), "stop");
    return;
  }
  if (word === "start") {
    await store(true);
    await tx((t) => optInPhone(t, from, "Texted START", "customer"));
    if (!provider.answersKeywords) await autoReply(c?.id ?? null, from, startReply(businessName), "start");
    return;
  }
  if (word === "help") {
    await store(true);
    if (!provider.answersKeywords) await autoReply(c?.id ?? null, from, helpReply(businessName, messagingStatus().helpContact), "help");
    return;
  }
  if ((word === "yes" || word === "no") && c) {
    // A YES or NO answers the most recent reminder, if its visit is still ahead.
    const reminder = await one<{ job_id: string }>(
      `select m.job_id from messages m join jobs j on j.id = m.job_id
       where m.customer_id = $1 and m.created_by = 'auto:visit_reminder' and m.status in ('sent', 'delivered')
         and m.sent_at > now() - interval '48 hours' and j.status = 'scheduled' and j.scheduled_date >= $2
       order by m.sent_at desc limit 1`,
      [c.id, todayLA()],
    );
    if (reminder) {
      await store(word === "yes");
      if (word === "yes") {
        await q("update jobs set customer_confirmed_at = now() where id = $1", [reminder.job_id]);
        await audit(q, `customer:${c.name}`, "confirm", "job", reminder.job_id, { by: "text" });
        await notifySafely("reminder_yes", { customerId: c.id, jobId: reminder.job_id, channel: "sms" });
      } else {
        await q(
          `update jobs set status = 'needs_reschedule', manager_notes = trim(manager_notes || ' Customer replied NO to the reminder.'), updated_at = now()
           where id = $1 and status = 'scheduled'`,
          [reminder.job_id],
        );
        await audit(q, `customer:${c.name}`, "decline", "job", reminder.job_id, { by: "text" });
        await notifySafely("reminder_no", { customerId: c.id, jobId: reminder.job_id, channel: "sms" });
      }
      await deliverDue();
      return;
    }
  }
  await store(false);
}

export async function handleStatus(s: StatusUpdate): Promise<void> {
  if (!s.providerId) return;
  if (s.status === "delivered") {
    await q("update messages set status = 'delivered' where provider_id = $1 and direction = 'out' and status = 'sent'", [s.providerId]);
  } else {
    await q("update messages set status = 'failed', error = $2 where provider_id = $1 and direction = 'out'", [s.providerId, s.error || "Not delivered."]);
  }
}

// Once-a-day work plus delivery. Safe to call often: reminders are claimed once per day and every message has a dedupe key.
export async function runDaily(): Promise<void> {
  try {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(clock()));
    if (hour >= 9 && hour < 20) {
      const claimed = await q(
        `insert into app_meta (key, value) values ('reminders_on', $1)
         on conflict (key) do update set value = excluded.value where app_meta.value <> excluded.value returning key`,
        [todayLA()],
      );
      if (claimed.length) await queueReminders();
    }
    await deliverDue();
  } catch (err) {
    console.error("runDaily failed", err);
  }
}
