"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { isDate, todayLA } from "@/lib/dates";
import { one, q, tx } from "@/lib/db";
import { field, flag } from "@/lib/http";
import { isPublicId, isUuid, newPublicId } from "@/lib/ids";
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
  const name = field(fd, "name", 100);
  const phone = field(fd, "phone", 30);
  const email = field(fd, "email", 120);
  const boatName = field(fd, "boat_name", 80);
  const marinaId = field(fd, "marina_id");
  const slip = field(fd, "slip", 20);
  const berth = field(fd, "berth_type", 20);
  if (!name) fail("Enter your name.");
  if (phone.replace(/\D/g, "").length < 10) fail("Enter a mobile number with area code.");
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
  const smsConsent = flag(fd, "sms_consent");
  const consentText = smsConsent ? field(fd, "consent_text", 600) : "";
  const service = isUuid(serviceId) ? await one<{ name: string }>("select name from services where id = $1", [serviceId]) : null;
  const token = newPublicId();
  await tx(async (t) => {
    const c = (
      await t<{ id: string }>(
        `insert into customers (name, phone, email, status, portal_token, source, sms_consent, consent_text, consent_at, marketing_consent, requested_plan)
         values ($1, $2, $3, 'pending', $4, 'signup', $5, $6, $7, $8, $9) returning id`,
        [
          name, phone, email, token, smsConsent, consentText, smsConsent ? new Date().toISOString() : null, flag(fd, "marketing_consent"),
          `${service?.name ?? "Cleaning"}, every ${freq || "?"} week(s), ${weekdayPref || "any day"}`,
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
    await audit(t, `customer:${name}`, "signup", "customer", c.id, { boat: boatName });
  });
  redirect(`/signup/thanks?portal=${token}`);
}
