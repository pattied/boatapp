"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { isDate, todayLA } from "@/lib/dates";
import { one, q, tx } from "@/lib/db";
import { field, flag, personName, saveNameParts } from "@/lib/http";
import { isPublicId, isUuid, newPublicId } from "@/lib/ids";
import { after } from "next/server";
import { logConsent, MARKETING_SMS_WORDING, normalizeEmail, normalizePhone, optOutEmail, optOutPhone, SERVICE_SMS_WORDING } from "@/lib/messaging/compliance";
import { deliverDue, notifySafely } from "@/lib/messaging/send";
import { berthProblem } from "@/lib/repo";

// The portal link's token identifies the customer. Every action re-checks that the boat belongs to them.
async function customerFor(token: string) {
  if (!isPublicId(token)) return null;
  return one<{ id: string; name: string; status: string }>("select id, name, status from customers where portal_token = $1", [token]);
}

function back(token: string, key: "ok" | "error", msg: string): never {
  redirect(`/portal/${token}?${key}=${encodeURIComponent(msg)}#requests`);
}

export async function requestService(fd: FormData) {
  const token = field(fd, "token", 40);
  const c = await customerFor(token);
  if (!c) redirect("/customer");
  const boatId = field(fd, "boat_id");
  const services = fd.getAll("service_ids").map(String).filter(isUuid).slice(0, 10);
  const date = field(fd, "preferred_date", 10);
  if (!services.length) back(token, "error", "Choose at least one service.");
  const boat = isUuid(boatId) ? await one("select 1 from boats where id = $1 and customer_id = $2", [boatId, c.id]) : null;
  if (!boat) back(token, "error", "Choose your boat.");
  if (date && (!isDate(date) || date < todayLA())) back(token, "error", "Choose a date from today on.");
  await q(
    `insert into requests (customer_id, boat_id, kind, service_ids, preferred_date, note) values ($1, $2, 'service', $3, $4, $5)`,
    [c.id, boatId, services, date || null, field(fd, "note", 500)],
  );
  await audit(q, `customer:${c.name}`, "request", "service", c.id, { services, date });
  back(token, "ok", "Request sent. We'll confirm the date with you.");
}

export async function requestPause(fd: FormData) {
  const token = field(fd, "token", 40);
  const c = await customerFor(token);
  if (!c) redirect("/customer");
  const boatId = field(fd, "boat_id");
  const until = field(fd, "until_date", 10);
  const boat = isUuid(boatId) ? await one("select 1 from boats where id = $1 and customer_id = $2", [boatId, c.id]) : null;
  if (!boat) back(token, "error", "Choose your boat.");
  if (until && (!isDate(until) || until < todayLA())) back(token, "error", "Choose a date from today on.");
  await q(`insert into requests (customer_id, boat_id, kind, until_date, note) values ($1, $2, 'pause', $3, $4)`, [
    c.id,
    boatId,
    until || null,
    field(fd, "note", 500),
  ]);
  await audit(q, `customer:${c.name}`, "request", "pause", c.id, { until });
  back(token, "ok", "Pause request sent. We'll confirm it with you.");
}

// Public sign-up. Creates a pending customer, boat and an inactive plan for the manager to review.
// The customer changes how we reach them, from their own boat page.
export async function savePreferences(fd: FormData) {
  const token = field(fd, "token", 40);
  const c = await customerFor(token);
  if (!c) redirect("/customer");
  const row = await one<{ phone: string; email: string; sms_consent: boolean; promo_sms_consent: boolean; sms_opted_out_at: string | null; email_opted_out_at: string | null }>(
    "select phone, email, sms_consent, promo_sms_consent, sms_opted_out_at, email_opted_out_at from customers where id = $1",
    [c.id],
  );
  if (!row) redirect("/customer");
  const prefsBack = (key: "ok" | "error", msg: string): never => redirect(`/portal/${token}?${key}=${encodeURIComponent(msg)}#contact`);
  const wantSms = flag(fd, "sms_consent");
  const wantPromo = wantSms && flag(fd, "promo_sms_consent");
  const wantEmailNews = flag(fd, "email_news");
  const phone = normalizePhone(row.phone);
  if (wantSms && !phone) prefsBack("error", "We don't have a valid mobile number for you. Reply to any of our messages and we'll fix it.");
  const pref = field(fd, "contact_pref", 8) === "email" || !wantSms ? "email" : "text";
  if (pref === "email" && !normalizeEmail(row.email)) prefsBack("error", "We have no email address for you. Keep texts on, or ask us to add your email.");
  await tx(async (t) => {
    const log = (purpose: "service" | "marketing", action: "granted" | "revoked", wording: string) =>
      logConsent(t, { customerId: c.id, name: c.name, address: phone ?? row.phone, channel: "sms", purpose, action, method: "Changed on their boat page", wording, actor: "customer" });
    if (!wantSms && row.sms_consent && phone) {
      // Turning texts off here is an opt-out like any other.
      await optOutPhone(t, phone, "Turned texts off on their boat page", "customer");
      await t("update customers set sms_consent = false, promo_sms_consent = false, promo_sms_consent_at = null where id = $1", [c.id]);
    } else {
      if (wantSms && (!row.sms_consent || row.sms_opted_out_at) && phone) {
        await t("delete from suppressions where channel = 'sms' and address = $1", [phone]);
        await t("update customers set sms_consent = true, sms_opted_out_at = null, consent_at = now(), consent_text = $2 where id = $1", [c.id, SERVICE_SMS_WORDING]);
        await log("service", "granted", SERVICE_SMS_WORDING);
      }
      if (wantPromo !== row.promo_sms_consent) {
        await t("update customers set promo_sms_consent = $2, promo_sms_consent_at = case when $2 then now() else null end where id = $1", [c.id, wantPromo]);
        await log("marketing", wantPromo ? "granted" : "revoked", MARKETING_SMS_WORDING);
      }
    }
    if (!wantEmailNews && !row.email_opted_out_at) await optOutEmail(t, c.id, "Changed on their boat page", "customer");
    if (wantEmailNews && row.email_opted_out_at) {
      await t("update customers set email_opted_out_at = null where id = $1", [c.id]);
      await logConsent(t, { customerId: c.id, name: c.name, address: row.email, channel: "email", purpose: "marketing", action: "granted", method: "Changed on their boat page", actor: "customer" });
    }
    await t("update customers set contact_pref = $2 where id = $1", [c.id, pref]);
  });
  if (wantSms && (!row.sms_consent || row.sms_opted_out_at)) {
    await notifySafely("opt_in", { customerId: c.id, channel: "sms", dedupeKey: `optin:${c.id}:${Date.now()}` });
    after(() => deliverDue());
  }
  prefsBack("ok", "Saved.");
}

class Invalid extends Error {}

// Returns { error } for a problem the customer can fix, so the form keeps what they typed.
export async function signUp(fd: FormData): Promise<{ error: string } | void> {
  try {
    await createSignUp(fd);
  } catch (err) {
    if (err instanceof Invalid) return { error: err.message };
    throw err; // includes the redirect to the thank-you page
  }
}

async function createSignUp(fd: FormData) {
  const fail = (msg: string): never => {
    throw new Invalid(msg);
  };
  if (field(fd, "website")) redirect("/signup/thanks"); // hidden field: only bots fill it in
  const person = personName(fd);
  const name = person.name;
  const phone = field(fd, "phone", 30);
  const email = field(fd, "email", 120);
  const boatName = field(fd, "boat_name", 80);
  const marinaId = field(fd, "marina_id");
  const slip = field(fd, "slip", 20);
  const berth = field(fd, "berth_type", 20);
  if (!person.first || !person.last) fail("Enter your first and last name.");
  if (!normalizePhone(phone)) fail("Enter a US mobile number with area code.");
  if (!boatName) fail("Enter your boat's name.");
  if (!isUuid(marinaId)) fail("Choose your marina.");
  const recent = await one<{ n: number }>(
    "select count(*)::int as n from customers where source = 'signup' and created_at > now() - interval '1 hour'",
  );
  if ((recent?.n ?? 0) > 20) fail("Too many sign-ups right now. Please try again later or call us.");
  const dockId = field(fd, "dock_id");
  const gateId = field(fd, "gate_id");
  const berthType = ["slip", "end_tie", "side_tie", "mooring", "dry"].includes(berth) ? berth : "slip";
  const problem = await berthProblem({
    marina_id: marinaId,
    dock_id: isUuid(dockId) ? dockId : null,
    gate_id: isUuid(gateId) ? gateId : null,
    slip,
    berth_type: berthType,
  });
  if (problem) fail(problem.replace("Crews need", "Our crews need").replace(" (or set the dock's gate on the marina page)", ""));
  const serviceId = field(fd, "service_id");
  const freq = field(fd, "frequency", 3);
  const weekdayPref = field(fd, "weekday", 12);
  // Text permission needs a real mobile number, and marketing permission only counts alongside it.
  const smsConsent = flag(fd, "sms_consent");
  const promoConsent = smsConsent && flag(fd, "promo_sms_consent");
  if (flag(fd, "promo_sms_consent") && !smsConsent) fail("To get marketing texts, tick the first text box too.");
  const pref = field(fd, "contact_pref", 8) === "email" || !smsConsent ? "email" : "text";
  if (pref === "email" && !normalizeEmail(email)) fail("Add your email address, or tick the box to get texts, so we can reach you.");
  if (email && !normalizeEmail(email)) fail("That email address does not look right.");
  const service = isUuid(serviceId) ? await one<{ name: string }>("select name from services where id = $1", [serviceId]) : null;
  const token = newPublicId();
  const newId = await tx(async (t) => {
    const c = (
      await t<{ id: string }>(
        `insert into customers (name, phone, email, status, portal_token, source, sms_consent, consent_text, consent_at, marketing_consent, requested_plan,
           contact_pref, promo_sms_consent, promo_sms_consent_at, address1, address2, city, state, postal_code)
         values ($1, $2, $3, 'pending', $4, 'signup', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id`,
        [
          name, phone, email, token, smsConsent, smsConsent ? SERVICE_SMS_WORDING : "", smsConsent ? new Date().toISOString() : null, flag(fd, "marketing_consent"),
          `${service?.name ?? "Cleaning"}, every ${freq || "?"} week(s), ${weekdayPref || "any day"}`,
          pref, promoConsent, promoConsent ? new Date().toISOString() : null,
          field(fd, "address1", 120), field(fd, "address2", 120), field(fd, "city", 80), field(fd, "state", 20).toUpperCase(), field(fd, "postal_code", 12),
        ],
      )
    )[0];
    const boat = (
      await t<{ id: string }>(
        `insert into boats (customer_id, name, make_model, length_ft, hull_color, marina_id, dock_id, gate_id, slip, berth_type, access_notes, liveaboard)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [
          c.id, boatName, field(fd, "make_model", 80), /^\d+$/.test(field(fd, "length_ft", 4)) ? Number(field(fd, "length_ft", 4)) : null,
          field(fd, "hull_color", 40), marinaId, isUuid(dockId) ? dockId : null, isUuid(gateId) ? gateId : null, slip,
          berthType, field(fd, "access_notes", 500), flag(fd, "liveaboard"),
        ],
      )
    )[0];
    const interval = /^\d+$/.test(freq) ? Math.min(52, Math.max(1, Number(freq))) : 2;
    // Inactive until a manager activates the customer and picks the first visit and crew.
    await t(
      `insert into plans (boat_id, service_id, anchor_date, interval_weeks, active) values ($1, $2, $3, $4, false)`,
      [boat.id, service ? serviceId : null, todayLA(), interval],
    );
    await saveNameParts(t, "customers", c.id, person);
    const addr = normalizePhone(phone) ?? phone;
    if (smsConsent) await logConsent(t, { customerId: c.id, name, address: addr, channel: "sms", purpose: "service", action: "granted", method: "Ticked the box on the sign-up form", wording: SERVICE_SMS_WORDING, actor: "customer" });
    if (promoConsent) await logConsent(t, { customerId: c.id, name, address: addr, channel: "sms", purpose: "marketing", action: "granted", method: "Ticked the box on the sign-up form", wording: MARKETING_SMS_WORDING, actor: "customer" });
    await audit(t, `customer:${name}`, "signup", "customer", c.id, { boat: boatName });
    return c.id;
  });
  if (smsConsent) {
    await notifySafely("opt_in", { customerId: newId, channel: "sms", dedupeKey: `optin:${newId}` });
    after(() => deliverDue());
  }
  redirect(`/signup/thanks?portal=${token}`);
}
