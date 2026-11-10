import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
process.env.PGLITE_DIR = mkdtempSync(path.join(tmpdir(), "ccmsg-"));
process.env.MESSAGING_FAKE_NOW = "2026-11-10T20:00:00Z"; // noon Pacific
process.env.BUSINESS_ADDRESS = "";
import { q, one } from "../lib/db";
import { newPublicId } from "../lib/ids";
import { finishSms, keywordOf, normalizePhone, quietUntil } from "../lib/messaging/compliance";
import { deliverDue, handleInbound, notify, queueMessage, queueReminders } from "../lib/messaging/send";
import { render, smsSegments } from "../lib/messaging/templates";
import { addDays, todayLA } from "../lib/dates";

let n = 0;
async function person(over: Record<string, unknown> = {}) {
  n++;
  const base: Record<string, unknown> = { name: `Pat Example${n}`, phone: `415555${String(1000 + n)}`, email: `pat${n}@example.com`, status: "active", sms_consent: true, ...over };
  const keys = Object.keys(base);
  const [{ id }] = await q<{ id: string }>(
    `insert into customers (${keys.join(", ")}, portal_token) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}, $${keys.length + 1}) returning id`,
    [...keys.map((k) => base[k]), newPublicId()],
  );
  return id;
}
const last = (customerId: string) =>
  one<{ channel: string; status: string; body: string; block_reason: string; to_addr: string; send_after: string | null }>(
    "select channel, status, body, block_reason, to_addr, send_after from messages where customer_id = $1 and direction = 'out' order by created_at desc, id desc limit 1",
    [customerId],
  );

test("phone numbers, keywords and wording", () => {
  assert.equal(normalizePhone("(415) 555-0111"), "+14155550111");
  assert.equal(normalizePhone("1-415-555-0111"), "+14155550111");
  assert.equal(normalizePhone("555-0111"), null);
  assert.equal(normalizePhone("+44 20 7946 0958"), null);
  for (const w of ["STOP", "stop.", " Unsubscribe ", "please stop texting me", "Remove me", "don't text me again", "STOPALL", "opt out"]) assert.equal(keywordOf(w), "stop", w);
  for (const w of ["Can you stop by Friday instead?", "The boat will stop in Monterey", "sounds good"]) assert.equal(keywordOf(w), null, w);
  assert.equal(keywordOf("Yes"), "yes");
  assert.equal(keywordOf("no"), "no");
  assert.equal(keywordOf("START"), "start");
  assert.equal(keywordOf("help"), "help");
  assert.equal(finishSms("Your boat is done.", { business: "Crisp Clean Marine", purpose: "service", firstToNumber: false }), "Crisp Clean Marine: Your boat is done.");
  assert.match(finishSms("Spring offer.", { business: "Crisp Clean Marine", purpose: "marketing", firstToNumber: false }), /Reply STOP to opt out\.$/);
  assert.match(finishSms("Hi.", { business: "Crisp Clean Marine", purpose: "service", firstToNumber: true }), /STOP/);
  assert.equal(render("{business}: {boat} is done. {message} Photos: {link}", { business: "CCM", boat: "Marlin", message: "", link: "x" }), "CCM: Marlin is done. Photos: x");
  assert.equal(smsSegments("a".repeat(160)), 1);
  assert.equal(smsSegments("a".repeat(161)), 2);
  assert.equal(smsSegments("Done ✅"), 1);
});

test("quiet hours: 9 pm to 8 am Pacific", () => {
  assert.equal(quietUntil(new Date("2026-11-10T20:00:00Z")), null); // noon
  assert.equal(quietUntil(new Date("2026-11-11T04:59:00Z")), null); // 8:59 pm
  assert.equal(quietUntil(new Date("2026-11-11T05:00:00Z")), "2026-11-11T16:00:00.000Z"); // 9 pm -> 8 am PST
  assert.equal(quietUntil(new Date("2026-11-10T15:30:00Z")), "2026-11-10T16:00:00.000Z"); // 7:30 am
  assert.equal(quietUntil(new Date("2026-07-10T06:00:00Z")), "2026-07-10T15:00:00.000Z"); // summer: 8 am PDT
});

test("service text sends with consent; first text carries opt-out wording", async () => {
  const id = await person();
  const r = await queueMessage({ customerId: id, purpose: "service", sms: "Your boat is done.", email: "Your boat is done.", subject: "Done" });
  assert.equal(r.status, "queued");
  assert.equal(r.channel, "sms");
  await deliverDue();
  const m = await last(id);
  assert.equal(m!.status, "sent");
  assert.match(m!.body, /^Crisp Clean Marine: Your boat is done\. Reply STOP to opt out\.$/);
  assert.match(m!.to_addr, /^\+1415555/);
});

test("no consent: falls back to email; no email either: blocked with a reason", async () => {
  const a = await person({ sms_consent: false });
  const r = await queueMessage({ customerId: a, purpose: "service", sms: "Hi", email: "Hi", subject: "Hi" });
  assert.equal(r.channel, "email");
  const b = await person({ sms_consent: false, email: "" });
  const r2 = await queueMessage({ customerId: b, purpose: "service", sms: "Hi", email: "Hi", subject: "Hi" });
  assert.equal(r2.status, "blocked");
  assert.match((await last(b))!.block_reason, /No consent to texts/);
});

test("marketing: texts need written consent; email needs a postal address", async () => {
  const a = await person();
  const r = await queueMessage({ customerId: a, purpose: "marketing", sms: "Offer", email: "Offer", subject: "Offer" });
  assert.equal(r.status, "blocked", "no marketing consent and no postal address");
  process.env.BUSINESS_ADDRESS = "100 Harbor Dr, Sausalito, CA 94965";
  const r2 = await queueMessage({ customerId: a, purpose: "marketing", sms: "Offer", email: "Offer", subject: "Offer" });
  assert.equal(r2.channel, "email", "marketing falls back to email once the address is set");
  const b = await person({ promo_sms_consent: true });
  const r3 = await queueMessage({ customerId: b, purpose: "marketing", sms: "Offer", email: "Offer", subject: "Offer" });
  assert.equal(r3.channel, "sms");
  await deliverDue();
  assert.match((await last(b))!.body, /Reply STOP to opt out\.$/);
});

test("prospect without consent cannot be texted, even by hand", async () => {
  const p = await person({ status: "prospect", sms_consent: false });
  const r = await queueMessage({ customerId: p, purpose: "service", channel: "sms", sms: "Hello", manual: true });
  assert.equal(r.status, "blocked");
});

test("STOP opts out at once, cancels waiting texts, survives delete and re-add; START restores", async () => {
  const id = await person();
  const c = await one<{ phone: string }>("select phone from customers where id = $1", [id]);
  const waiting = await queueMessage({ customerId: id, purpose: "service", sms: "Reminder", needsApproval: true });
  await handleInbound({ channel: "sms", from: c!.phone, to: "", body: "Stop", providerId: "in-1" });
  assert.equal((await one<{ status: string }>("select status from messages where id = $1", [waiting.id]))!.status, "cancelled");
  const confirm = await last(id);
  assert.match(confirm!.body, /unsubscribed/);
  const r = await queueMessage({ customerId: id, purpose: "service", channel: "sms", sms: "Hello again", manual: true });
  assert.equal(r.status, "blocked");
  const log = await q("select 1 from consent_log where customer_id = $1 and action = 'revoked'", [id]);
  assert.equal(log.length, 1);
  // Same number added again as a new record with consent ticked: still blocked.
  const again = await person({ phone: c!.phone });
  assert.equal((await queueMessage({ customerId: again, purpose: "service", channel: "sms", sms: "Hi" })).status, "blocked");
  // A vendor retry of the same STOP is ignored.
  await handleInbound({ channel: "sms", from: c!.phone, to: "", body: "Stop", providerId: "in-1" });
  assert.equal((await q("select 1 from messages where provider_id = 'in-1'")).length, 1);
  await handleInbound({ channel: "sms", from: c!.phone, to: "", body: "START", providerId: "in-2" });
  assert.equal((await queueMessage({ customerId: id, purpose: "service", channel: "sms", sms: "Welcome back" })).status, "queued");
});

test("a message approved earlier is re-checked at send time", async () => {
  const id = await person();
  const r = await queueMessage({ customerId: id, purpose: "service", sms: "Later" });
  await q("update customers set sms_consent = false where id = $1", [id]);
  await deliverDue();
  assert.equal((await one<{ status: string }>("select status from messages where id = $1", [r.id]))!.status, "blocked");
});

test("texts created during quiet hours wait until 8 am", async () => {
  process.env.MESSAGING_FAKE_NOW = "2026-11-11T06:00:00Z"; // 10 pm Pacific
  const id = await person();
  const r = await queueMessage({ customerId: id, purpose: "service", sms: "Late", email: "Late", subject: "Late" });
  await deliverDue();
  const m = await one<{ status: string; send_after: string }>("select status, send_after from messages where id = $1", [r.id]);
  assert.equal(m!.status, "queued");
  assert.equal(new Date(m!.send_after).toISOString(), "2026-11-11T16:00:00.000Z");
  // Email is not held.
  const e = await person({ contact_pref: "email" });
  await queueMessage({ customerId: e, purpose: "service", sms: "Late", email: "Late", subject: "Late" });
  await deliverDue();
  assert.equal((await last(e))!.status, "sent");
  process.env.MESSAGING_FAKE_NOW = "2026-11-10T20:00:00Z";
});

test("reminder, then YES confirms and NO sends the visit to the reschedule queue", async () => {
  const [{ id: marina }] = await q<{ id: string }>("insert into marinas (name) values ('Test Marina') returning id");
  const mk = async () => {
    const id = await person();
    const [{ id: boat }] = await q<{ id: string }>("insert into boats (customer_id, name, marina_id, slip) values ($1, 'Osprey', $2, 'A-1') returning id", [id, marina]);
    const [{ id: job }] = await q<{ id: string }>("insert into jobs (public_id, boat_id, scheduled_date) values ($1, $2, $3) returning id", [newPublicId(), boat, addDays(todayLA(new Date(process.env.MESSAGING_FAKE_NOW!)), 1)]);
    return { id, job, phone: (await one<{ phone: string }>("select phone from customers where id = $1", [id]))!.phone };
  };
  const a = await mk();
  const b = await mk();
  // The reminder run uses the real calendar date; create the jobs on the real "tomorrow".
  await q("update jobs set scheduled_date = $1 where id = any($2::uuid[])", [addDays(todayLA(), 1), [a.job, b.job]]);
  assert.ok((await queueReminders()) >= 2);
  assert.equal(await queueReminders(), 0, "a second run sends nothing new");
  await deliverDue();
  assert.match((await last(a.id))!.body, /Osprey is scheduled for cleaning tomorrow/);
  await handleInbound({ channel: "sms", from: a.phone, to: "", body: "yes", providerId: "y-1" });
  assert.ok((await one<{ customer_confirmed_at: string | null }>("select customer_confirmed_at from jobs where id = $1", [a.job]))!.customer_confirmed_at);
  await handleInbound({ channel: "sms", from: b.phone, to: "", body: "No", providerId: "n-1" });
  assert.equal((await one<{ status: string }>("select status from jobs where id = $1", [b.job]))!.status, "needs_reschedule");
  assert.match((await last(b.id))!.body, /pick a new day/);
});

test("a template that is turned off sends nothing; one set to approval waits", async () => {
  const id = await person();
  await q("update message_templates set active = false where key = 'visit_skipped'");
  assert.equal((await notify("visit_skipped", { customerId: id })).status, "skipped");
  await q("update message_templates set auto_send = false where key = 'request_approved'");
  assert.equal((await notify("request_approved", { customerId: id, vars: { service: "Full Detail", date: "Friday" } })).status, "pending_approval");
});

test("unknown numbers are kept for the manager", async () => {
  await handleInbound({ channel: "sms", from: "+14155559999", to: "", body: "Do you clean powerboats?", providerId: "u-1" });
  const m = await one<{ customer_id: string | null; read_at: string | null }>("select customer_id, read_at from messages where provider_id = 'u-1'");
  assert.equal(m!.customer_id, null);
  assert.equal(m!.read_at, null);
});
