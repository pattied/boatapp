import { TZ } from "../dates";
import { one, q, type Q } from "../db";

// Every rule that decides whether a message may go out lives in this file, so it can be read and audited
// in one place. Messages are checked twice: when they are created and again just before they are sent.
//
// Texts (US rules: TCPA and the FCC's orders, the carriers' CTIA messaging principles):
//   - Service texts (reminders, confirmations, photo links) need the customer's consent to receive texts.
//   - Marketing texts need separate, written consent to marketing texts, recorded with its wording and time.
//   - STOP and similar words, or a plain-language request, end all texts to that number at once.
//     The number goes on a do-not-text list that survives deleting and re-adding the customer.
//   - No texts before 8 am or after 9 pm Pacific. Later ones wait until 8 am.
//   - Every text names the business. The first text to a number and every marketing text say how to opt out.
// Email (CAN-SPAM):
//   - Marketing email carries the business's postal address and a working unsubscribe link, and is refused
//     if no postal address is configured. Unsubscribing takes effect immediately.
//   - Service email about the customer's own visits is allowed without marketing consent.

export type Channel = "sms" | "email";
export type Purpose = "service" | "marketing";

export type Recipient = {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: string;
  contact_pref: string;
  sms_consent: boolean;
  promo_sms_consent: boolean;
  sms_opted_out_at: string | null;
  email_opted_out_at: string | null;
};

export const RECIPIENT_COLS =
  "id, name, phone, email, status, contact_pref, sms_consent, promo_sms_consent, sms_opted_out_at, email_opted_out_at";

// US numbers only, stored as +1XXXXXXXXXX. Anything else is treated as not textable.
export function normalizePhone(raw: string): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10 && /^[2-9]/.test(d)) return `+1${d}`;
  if (d.length === 11 && d[0] === "1" && /^[2-9]/.test(d[1])) return `+${d}`;
  return null;
}

export function normalizeEmail(raw: string): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

export const QUIET_START_HOUR = 21; // 9 pm
export const QUIET_END_HOUR = 8; // 8 am

function hourLA(now: Date) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now));
}

// The current time. Tests can pin it with MESSAGING_FAKE_NOW; the live site ignores that setting.
export function clock(): Date {
  const fake = process.env.VERCEL ? "" : process.env.MESSAGING_FAKE_NOW ?? "";
  return fake ? new Date(fake) : new Date();
}

// Null when texting is allowed now; otherwise the next 8 am Pacific as an ISO time.
export function quietUntil(now = clock()): string | null {
  const h = hourLA(now);
  if (h >= QUIET_END_HOUR && h < QUIET_START_HOUR) return null;
  // Step forward a minute at a time is wasteful; step by hours to the next 8 am, then trim the minutes.
  const t = new Date(now.getTime());
  t.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 14; i++) {
    t.setTime(t.getTime() + 3600000);
    if (hourLA(t) === QUIET_END_HOUR) return t.toISOString();
  }
  return t.toISOString();
}

export type Verdict = { ok: true; to: string } | { ok: false; reason: string };

export async function isSuppressed(channel: Channel, address: string, run: Q = q): Promise<boolean> {
  return (await run("select 1 from suppressions where channel = $1 and address = $2", [channel, address])).length > 0;
}

// Did this customer text us recently? A manager's typed reply to a live conversation is allowed on that basis.
async function recentInbound(customerId: string, minutes: number): Promise<boolean> {
  const r = await one(
    `select 1 from messages where customer_id = $1 and channel = 'sms' and direction = 'in'
       and created_at > now() - ($2 || ' minutes')::interval limit 1`,
    [customerId, String(minutes)],
  );
  return Boolean(r);
}

// The single gate. `manual` means a manager typed this message to this one person.
export async function canSend(
  c: Recipient,
  channel: Channel,
  purpose: Purpose,
  opts: { manual?: boolean; postalAddress?: string } = {},
): Promise<Verdict> {
  if (c.status === "declined") return { ok: false, reason: "This sign-up was declined." };
  if (c.contact_pref === "none" && !opts.manual) return { ok: false, reason: "Customer asked for no messages." };

  if (channel === "sms") {
    const to = normalizePhone(c.phone);
    if (!to) return { ok: false, reason: "No valid US mobile number on file." };
    if (c.sms_opted_out_at) return { ok: false, reason: "Customer opted out of texts (replied STOP)." };
    if (await isSuppressed("sms", to)) return { ok: false, reason: "This number is on the do-not-text list." };
    if (purpose === "marketing") {
      if (!c.promo_sms_consent) return { ok: false, reason: "No written consent to marketing texts on record." };
      return { ok: true, to };
    }
    if (c.sms_consent) return { ok: true, to };
    // A typed reply to someone who texted us in the last week is a response to their own message.
    if (opts.manual && (await recentInbound(c.id, 7 * 24 * 60))) return { ok: true, to };
    return { ok: false, reason: "No consent to texts on record." };
  }

  const to = normalizeEmail(c.email);
  if (!to) return { ok: false, reason: "No valid email address on file." };
  if (await isSuppressed("email", to)) {
    return { ok: false, reason: purpose === "marketing" ? "This address unsubscribed." : "Email to this address failed before." };
  }
  if (purpose === "marketing") {
    if (c.email_opted_out_at) return { ok: false, reason: "Customer unsubscribed from marketing email." };
    if (!opts.postalAddress) return { ok: false, reason: "Marketing email needs your postal address. Set BUSINESS_ADDRESS." };
  }
  return { ok: true, to };
}

// Texts sent by a manager during a live exchange may go out during quiet hours; everything else waits.
export async function sendAfter(c: Recipient, channel: Channel, manual: boolean): Promise<string | null> {
  if (channel !== "sms") return null;
  const until = quietUntil();
  if (!until) return null;
  if (manual && (await recentInbound(c.id, 60))) return null;
  return until;
}

// ---------- Words customers text back ----------

const clean = (body: string) => body.trim().toUpperCase().replace(/[^A-Z0-9 ']/g, "").replace(/\s+/g, " ");

const STOP_WORDS = ["STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "OPT OUT"];
const START_WORDS = ["START", "UNSTOP", "SUBSCRIBE", "OPTIN", "OPT IN"];
const HELP_WORDS = ["HELP", "INFO"];
// Plain-language requests count too. Bare "stop" inside a sentence ("can you stop by Friday") does not.
const STOP_PHRASES =
  /\b(UNSUBSCRIBE|OPT ?OUT|REMOVE ME|TAKE ME OFF|DO NOT (TEXT|MESSAGE|CONTACT)|DONT (TEXT|MESSAGE|CONTACT)|DON'T (TEXT|MESSAGE|CONTACT)|STOP (TEXTING|MESSAGING|SENDING|CONTACTING)|NO MORE (TEXTS|MESSAGES))\b/;

export type Keyword = "stop" | "start" | "help" | "yes" | "no" | null;

export function keywordOf(body: string): Keyword {
  const t = clean(body);
  if (STOP_WORDS.includes(t) || STOP_PHRASES.test(t)) return "stop";
  if (START_WORDS.includes(t)) return "start";
  if (HELP_WORDS.includes(t)) return "help";
  if (["YES", "Y", "YEP", "YEAH", "CONFIRM", "CONFIRMED", "OK", "OKAY"].includes(t)) return "yes";
  if (["NO", "N", "NOPE"].includes(t)) return "no";
  return null;
}

// ---------- Required wording ----------

export const OPT_OUT_LINE = "Reply STOP to opt out.";

// Adds the business name and, where required, the opt-out line. Never duplicates what the text already has.
export function finishSms(body: string, o: { business: string; purpose: Purpose; firstToNumber: boolean }): string {
  let out = body.trim();
  if (!out.toLowerCase().includes(o.business.toLowerCase())) out = `${o.business}: ${out}`;
  if ((o.purpose === "marketing" || o.firstToNumber) && !/\bSTOP\b/.test(out)) out = `${out} ${OPT_OUT_LINE}`;
  return out;
}

export function stopReply(business: string) {
  return `${business}: you're unsubscribed and will get no more texts from us. Reply START to resubscribe.`;
}
export function startReply(business: string) {
  return `${business}: you're resubscribed to texts about your boat cleanings. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;
}
export function helpReply(business: string, contact: string) {
  return `${business}: texts about your boat cleanings. Message frequency varies. Msg & data rates may apply.${contact ? ` Help: ${contact}.` : ""} Reply STOP to opt out.`;
}

// ---------- Recording consent ----------

export const SERVICE_SMS_WORDING =
  "I agree to receive text messages from Crisp Clean Marine about my boat cleanings (reminders, confirmations and photo links). Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.";
export const MARKETING_SMS_WORDING =
  "I also agree to receive marketing text messages from Crisp Clean Marine, such as offers and seasonal reminders, at the number I provided. These may be sent using automated technology. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Consent is not a condition of purchase.";

export async function logConsent(
  run: Q,
  e: { customerId: string | null; name: string; address: string; channel: Channel; purpose: Purpose | "all"; action: "granted" | "revoked"; method: string; wording?: string; actor: string },
) {
  await run(
    `insert into consent_log (customer_id, customer_name, address, channel, purpose, action, method, wording, actor)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [e.customerId, e.name, e.address, e.channel, e.purpose, e.action, e.method, e.wording ?? "", e.actor],
  );
}

// Opts a phone number out of all texts: every customer record with that number, plus the do-not-text list.
export async function optOutPhone(run: Q, phone: string, method: string, actor: string) {
  await run("insert into suppressions (channel, address, reason) values ('sms', $1, $2) on conflict do nothing", [phone, method]);
  const rows = await run<{ id: string; name: string }>(
    `update customers set sms_opted_out_at = coalesce(sms_opted_out_at, now())
     where regexp_replace(phone, '[^0-9]', '', 'g') in ($1, $2) returning id, name`,
    [phone.slice(1), phone.slice(2)],
  );
  for (const r of rows.length ? rows : [{ id: null as string | null, name: "" }]) {
    await logConsent(run, { customerId: r.id, name: r.name, address: phone, channel: "sms", purpose: "all", action: "revoked", method, actor });
  }
  // Anything still waiting to go to that number is cancelled.
  await run(
    `update messages set status = 'cancelled', block_reason = 'Customer opted out of texts.'
     where channel = 'sms' and direction = 'out' and to_addr = $1 and status in ('queued', 'pending_approval')`,
    [phone],
  );
}

export async function optInPhone(run: Q, phone: string, method: string, actor: string) {
  await run("delete from suppressions where channel = 'sms' and address = $1", [phone]);
  const rows = await run<{ id: string; name: string }>(
    `update customers set sms_opted_out_at = null, sms_consent = true, consent_at = coalesce(consent_at, now())
     where regexp_replace(phone, '[^0-9]', '', 'g') in ($1, $2) returning id, name`,
    [phone.slice(1), phone.slice(2)],
  );
  for (const r of rows) {
    await logConsent(run, { customerId: r.id, name: r.name, address: phone, channel: "sms", purpose: "service", action: "granted", method, actor });
  }
}

export async function optOutEmail(run: Q, customerId: string, method: string, actor: string) {
  const rows = await run<{ id: string; name: string; email: string }>(
    "update customers set email_opted_out_at = coalesce(email_opted_out_at, now()) where id = $1 returning id, name, email",
    [customerId],
  );
  for (const r of rows) {
    await logConsent(run, { customerId: r.id, name: r.name, address: r.email, channel: "email", purpose: "marketing", action: "revoked", method, actor });
    await run(
      `update messages set status = 'cancelled', block_reason = 'Customer unsubscribed.'
       where customer_id = $1 and channel = 'email' and purpose = 'marketing' and status in ('queued', 'pending_approval')`,
      [r.id],
    );
  }
}
