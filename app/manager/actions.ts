"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { addDays, isDate, todayLA } from "@/lib/dates";
import { one, q, tx, type Q } from "@/lib/db";
import { field, flag } from "@/lib/http";
import { isUuid, newPublicId } from "@/lib/ids";
import { generateJobs, pauseBoat, regeneratePlan, resumeBoat } from "@/lib/schedule";
import { requireManager } from "@/lib/session";
import { berthProblem } from "@/lib/repo";

const ACTOR = "manager";

// Every action returns to the page it came from (a hidden "back" field), with a short message.
function backTo(fd: FormData, fallback = "/manager") {
  const b = field(fd, "back", 300);
  return b.startsWith("/manager") ? b : fallback;
}
function done(fd: FormData, ok: string, fallback?: string): never {
  const path = backTo(fd, fallback);
  redirect(`${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(ok)}`);
}
function fail(fd: FormData, error: string, fallback?: string): never {
  const path = backTo(fd, fallback);
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);
}
const uuidOrNull = (v: string) => (isUuid(v) ? v : null);
const intOrNull = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);
const mmdd = (v: string) => (/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) ? v : "");

// ---------- Marinas, gates, docks ----------

export async function createMarina(fd: FormData) {
  await requireManager();
  const name = field(fd, "name", 100);
  if (!name) fail(fd, "Enter the marina name.");
  const row = await one<{ id: string }>("insert into marinas (name, address, notes) values ($1, $2, $3) returning id", [
    name,
    field(fd, "address", 200),
    field(fd, "notes", 1000),
  ]);
  await audit(q, ACTOR, "create", "marina", row!.id, { name });
  redirect(`/manager/marinas/${row!.id}?ok=${encodeURIComponent("Marina added. Now add its gates and docks.")}`);
}

export async function updateMarina(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  const name = field(fd, "name", 100);
  if (!isUuid(id) || !name) fail(fd, "Enter the marina name.");
  await q("update marinas set name = $2, address = $3, notes = $4 where id = $1", [
    id,
    name,
    field(fd, "address", 200),
    field(fd, "notes", 1000),
  ]);
  await audit(q, ACTOR, "update", "marina", id, { name });
  done(fd, "Marina saved.");
}

export async function addGate(fd: FormData) {
  await requireManager();
  const marinaId = field(fd, "marina_id");
  const name = field(fd, "name", 60);
  if (!isUuid(marinaId) || !name) fail(fd, "Enter the gate name.");
  const row = await one<{ id: string }>("insert into gates (marina_id, name, code, notes) values ($1, $2, $3, $4) returning id", [
    marinaId,
    name,
    field(fd, "code", 40),
    field(fd, "notes", 300),
  ]);
  await audit(q, ACTOR, "create", "gate", row!.id, { name });
  done(fd, "Gate added.");
}

export async function updateGate(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Gate not found.");
  const before = await one<{ code: string; name: string }>("select code, name from gates where id = $1", [id]);
  if (!before) fail(fd, "Gate not found.");
  const code = field(fd, "code", 40);
  await q("update gates set name = $2, code = $3, notes = $4, updated_at = now() where id = $1", [
    id,
    field(fd, "name", 60) || before.name,
    code,
    field(fd, "notes", 300),
  ]);
  if (code !== before.code) {
    // Gate code history: who changed it, from what, to what.
    await audit(q, ACTOR, "change_code", "gate", id, { from: before.code, to: code, note: field(fd, "change_note", 200) });
  }
  done(fd, code !== before.code ? "Gate code changed. Technicians see it at their next sync." : "Gate saved.");
}

export async function deleteGate(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Gate not found.");
  await q("delete from gates where id = $1", [id]);
  await audit(q, ACTOR, "delete", "gate", id);
  done(fd, "Gate removed.");
}

export async function addDock(fd: FormData) {
  await requireManager();
  const marinaId = field(fd, "marina_id");
  const name = field(fd, "name", 60);
  if (!isUuid(marinaId) || !name) fail(fd, "Enter the dock name.");
  const row = await one<{ id: string }>("insert into docks (marina_id, name, gate_id) values ($1, $2, $3) returning id", [
    marinaId,
    name,
    uuidOrNull(field(fd, "gate_id")),
  ]);
  await audit(q, ACTOR, "create", "dock", row!.id, { name });
  done(fd, "Dock added.");
}

export async function updateDock(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Dock not found.");
  await q("update docks set name = coalesce(nullif($2, ''), name), gate_id = $3 where id = $1", [
    id,
    field(fd, "name", 60),
    uuidOrNull(field(fd, "gate_id")),
  ]);
  await audit(q, ACTOR, "update", "dock", id);
  done(fd, "Dock saved.");
}

export async function deleteDock(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Dock not found.");
  await q("delete from docks where id = $1", [id]);
  await audit(q, ACTOR, "delete", "dock", id);
  done(fd, "Dock removed.");
}

// ---------- Crews and technicians ----------

export async function createCrew(fd: FormData) {
  await requireManager();
  const name = field(fd, "name", 60);
  if (!name) fail(fd, "Enter the crew name.");
  const row = await one<{ id: string }>("insert into crews (name) values ($1) returning id", [name]);
  await audit(q, ACTOR, "create", "crew", row!.id, { name });
  done(fd, "Crew added.");
}

export async function updateCrew(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Crew not found.");
  await q("update crews set name = coalesce(nullif($2, ''), name), active = $3 where id = $1", [
    id,
    field(fd, "name", 60),
    flag(fd, "active"),
  ]);
  await audit(q, ACTOR, "update", "crew", id, { active: flag(fd, "active") });
  done(fd, "Crew saved.");
}

export async function createTechnician(fd: FormData) {
  await requireManager();
  const name = field(fd, "name", 60);
  if (!name) fail(fd, "Enter the technician's name.");
  const row = await one<{ id: string }>("insert into technicians (name, crew_id) values ($1, $2) returning id", [
    name,
    uuidOrNull(field(fd, "crew_id")),
  ]);
  await audit(q, ACTOR, "create", "technician", row!.id, { name });
  done(fd, "Technician added.");
}

export async function updateTechnician(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Technician not found.");
  await q("update technicians set name = coalesce(nullif($2, ''), name), crew_id = $3, active = $4 where id = $1", [
    id,
    field(fd, "name", 60),
    uuidOrNull(field(fd, "crew_id")),
    flag(fd, "active"),
  ]);
  await audit(q, ACTOR, "update", "technician", id, { crew: field(fd, "crew_id"), active: flag(fd, "active") });
  done(fd, "Technician saved.");
}

// ---------- Services ----------

function shotList(fd: FormData) {
  return field(fd, "shot_list", 400)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export async function createService(fd: FormData) {
  await requireManager();
  const name = field(fd, "name", 80);
  if (!name) fail(fd, "Enter the service name.");
  const shots = shotList(fd);
  const row = await one<{ id: string }>(
    `insert into services (name, description, is_add_on, price_text, shot_list, sort)
     values ($1, $2, $3, $4, $5, coalesce((select max(sort) + 1 from services), 1)) returning id`,
    [name, field(fd, "description", 300), flag(fd, "is_add_on"), field(fd, "price_text", 60), shots.length ? shots : ["Bow", "Stern", "Cockpit", "Port side"]],
  );
  await audit(q, ACTOR, "create", "service", row!.id, { name });
  done(fd, "Service added.");
}

export async function updateService(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Service not found.");
  const shots = shotList(fd);
  await q(
    `update services set name = coalesce(nullif($2, ''), name), description = $3, is_add_on = $4, price_text = $5,
       shot_list = $6, active = $7 where id = $1`,
    [id, field(fd, "name", 80), field(fd, "description", 300), flag(fd, "is_add_on"), field(fd, "price_text", 60), shots.length ? shots : ["Bow", "Stern", "Cockpit", "Port side"], flag(fd, "active")],
  );
  await audit(q, ACTOR, "update", "service", id);
  done(fd, "Service saved.");
}

// ---------- Customers, contacts, boats, plans ----------

type BoatInput = {
  name: string;
  make_model: string;
  length_ft: number | null;
  hull_color: string;
  marina_id: string | null;
  gate_id: string | null;
  dock_id: string | null;
  slip: string;
  berth_type: string;
  gate_code_override: string;
  access_notes: string;
  liveaboard: boolean;
  knock_first: boolean;
};

function boatInput(fd: FormData): BoatInput {
  const berth = field(fd, "berth_type", 20);
  return {
    name: field(fd, "boat_name", 80),
    make_model: field(fd, "make_model", 80),
    length_ft: intOrNull(field(fd, "length_ft", 4)),
    hull_color: field(fd, "hull_color", 40),
    marina_id: uuidOrNull(field(fd, "marina_id")),
    gate_id: uuidOrNull(field(fd, "gate_id")),
    dock_id: uuidOrNull(field(fd, "dock_id")),
    slip: field(fd, "slip", 20),
    berth_type: ["slip", "end_tie", "side_tie", "mooring", "dry"].includes(berth) ? berth : "slip",
    gate_code_override: field(fd, "gate_code_override", 40),
    access_notes: field(fd, "access_notes", 500),
    liveaboard: flag(fd, "liveaboard"),
    knock_first: flag(fd, "knock_first"),
  };
}

// Location is required: marina, plus slip (or a mooring or dry storage); gate and dock must belong to that marina.
async function checkBoat(b: BoatInput): Promise<string | null> {
  if (!b.name) return "Enter the boat name.";
  return berthProblem(b);
}

async function insertBoat(t: Q, customerId: string, b: BoatInput) {
  const row = (
    await t<{ id: string }>(
      `insert into boats (customer_id, name, make_model, length_ft, hull_color, marina_id, gate_id, dock_id, slip,
         berth_type, gate_code_override, access_notes, liveaboard, knock_first)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
      [customerId, b.name, b.make_model, b.length_ft, b.hull_color, b.marina_id, b.gate_id, b.dock_id, b.slip, b.berth_type, b.gate_code_override, b.access_notes, b.liveaboard, b.knock_first],
    )
  )[0];
  return row.id;
}

type PlanInput = {
  service_id: string | null;
  crew_id: string | null;
  anchor_date: string;
  interval_weeks: number;
  off_interval_weeks: number | null;
  season_start: string;
  season_end: string;
};

function planInput(fd: FormData): PlanInput | string | null {
  const first = field(fd, "first_date", 10);
  const interval = intOrNull(field(fd, "interval_weeks", 2));
  if (!first && !interval) return null; // no plan given
  if (!isDate(first)) return "Choose the first visit date.";
  if (!interval || interval < 1 || interval > 52) return "Choose how often to clean.";
  const seasonal = flag(fd, "seasonal");
  const off = seasonal ? intOrNull(field(fd, "off_interval_weeks", 2)) : null;
  const ss = seasonal ? mmdd(field(fd, "season_start", 5)) : "";
  const se = seasonal ? mmdd(field(fd, "season_end", 5)) : "";
  if (seasonal && (!off || !ss || !se)) return "For a seasonal plan, enter the off-season frequency and the season dates (MM-DD).";
  return {
    service_id: uuidOrNull(field(fd, "service_id")),
    crew_id: uuidOrNull(field(fd, "crew_id")),
    anchor_date: first,
    interval_weeks: interval,
    off_interval_weeks: off,
    season_start: ss,
    season_end: se,
  };
}

async function insertPlan(t: Q, boatId: string, p: PlanInput, active = true) {
  return (
    await t<{ id: string }>(
      `insert into plans (boat_id, service_id, crew_id, anchor_date, interval_weeks, off_interval_weeks, season_start, season_end, active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [boatId, p.service_id, p.crew_id, p.anchor_date, p.interval_weeks, p.off_interval_weeks, p.season_start, p.season_end, active],
    )
  )[0].id;
}

export async function createCustomer(fd: FormData) {
  await requireManager();
  const name = field(fd, "name", 100);
  if (!name) fail(fd, "Enter the customer's name.", "/manager/customers/new");
  const boat = boatInput(fd);
  const boatErr = await checkBoat(boat);
  if (boatErr) fail(fd, boatErr, "/manager/customers/new");
  const plan = planInput(fd);
  if (typeof plan === "string") fail(fd, plan, "/manager/customers/new");
  const phone = field(fd, "phone", 30);
  const dup = phone
    ? await one<{ id: string; name: string }>("select id, name from customers where regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g') and phone <> ''", [phone])
    : null;
  if (dup && !flag(fd, "allow_duplicate")) {
    fail(fd, `${dup.name} already has that phone number. Tick "Create anyway" if this is a different customer.`, "/manager/customers/new");
  }
  const id = await tx(async (t) => {
    const c = (
      await t<{ id: string }>(
        `insert into customers (name, phone, email, notes, portal_token, source, marketing_consent)
         values ($1, $2, $3, $4, $5, 'manager', $6) returning id`,
        [name, phone, field(fd, "email", 120), field(fd, "notes", 1000), newPublicId(), flag(fd, "marketing_consent")],
      )
    )[0].id;
    const boatId = await insertBoat(t, c, boat);
    if (plan) await insertPlan(t, boatId, plan);
    await audit(t, ACTOR, "create", "customer", c, { name, boat: boat.name });
    if (plan) await generateJobs(t, { boatId });
    return c;
  });
  redirect(`/manager/customers/${id}?ok=${encodeURIComponent(plan ? "Customer added and visits scheduled." : "Customer added.")}`);
}

export async function updateCustomer(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  const name = field(fd, "name", 100);
  if (!isUuid(id) || !name) fail(fd, "Enter the customer's name.");
  const status = field(fd, "status", 20);
  await q(
    `update customers set name = $2, phone = $3, email = $4, notes = $5, marketing_consent = $6,
       status = case when $7 in ('active', 'inactive') then $7 else status end where id = $1`,
    [id, name, field(fd, "phone", 30), field(fd, "email", 120), field(fd, "notes", 1000), flag(fd, "marketing_consent"), status],
  );
  await audit(q, ACTOR, "update", "customer", id, { status });
  if (status === "active") await generateJobs(q);
  done(fd, "Customer saved.");
}

export async function activateCustomer(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Customer not found.");
  const crew = uuidOrNull(field(fd, "crew_id"));
  const first = field(fd, "first_date", 10);
  if (!isDate(first)) fail(fd, "Choose the first visit date.");
  await tx(async (t) => {
    await t("update customers set status = 'active' where id = $1", [id]);
    await t(
      `update plans set active = true, crew_id = coalesce($2, crew_id), anchor_date = $3
       where boat_id in (select id from boats where customer_id = $1)`,
      [id, crew, first],
    );
    await audit(t, ACTOR, "activate", "customer", id, { first, crew });
    await generateJobs(t);
  });
  done(fd, "Customer activated and visits scheduled.");
}

export async function declineCustomer(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Customer not found.");
  await q("update customers set status = 'declined' where id = $1 and status = 'pending'", [id]);
  await audit(q, ACTOR, "decline", "customer", id);
  done(fd, "Sign-up declined.");
}

export async function addContact(fd: FormData) {
  await requireManager();
  const customerId = field(fd, "customer_id");
  const name = field(fd, "name", 100);
  if (!isUuid(customerId) || !name) fail(fd, "Enter the contact's name.");
  await q("insert into contacts (customer_id, name, role, phone, email) values ($1, $2, $3, $4, $5)", [
    customerId,
    name,
    field(fd, "role", 30) || "owner",
    field(fd, "phone", 30),
    field(fd, "email", 120),
  ]);
  await audit(q, ACTOR, "create", "contact", customerId, { name });
  done(fd, "Contact added.");
}

export async function deleteContact(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Contact not found.");
  await q("delete from contacts where id = $1", [id]);
  done(fd, "Contact removed.");
}

export async function addBoat(fd: FormData) {
  await requireManager();
  const customerId = field(fd, "customer_id");
  if (!isUuid(customerId)) fail(fd, "Customer not found.");
  const boat = boatInput(fd);
  const err = await checkBoat(boat);
  if (err) fail(fd, err);
  const plan = planInput(fd);
  if (typeof plan === "string") fail(fd, plan);
  await tx(async (t) => {
    const boatId = await insertBoat(t, customerId, boat);
    if (plan) await insertPlan(t, boatId, plan);
    await audit(t, ACTOR, "create", "boat", boatId, { name: boat.name });
    if (plan) await generateJobs(t, { boatId });
  });
  done(fd, "Boat added.");
}

export async function updateBoat(fd: FormData) {
  await requireManager();
  const id = field(fd, "boat_id");
  if (!isUuid(id)) fail(fd, "Boat not found.");
  const b = boatInput(fd);
  const err = await checkBoat(b);
  if (err) fail(fd, err);
  await q(
    `update boats set name = $2, make_model = $3, length_ft = $4, hull_color = $5, marina_id = $6, gate_id = $7, dock_id = $8,
       slip = $9, berth_type = $10, gate_code_override = $11, access_notes = $12, liveaboard = $13, knock_first = $14 where id = $1`,
    [id, b.name, b.make_model, b.length_ft, b.hull_color, b.marina_id, b.gate_id, b.dock_id, b.slip, b.berth_type, b.gate_code_override, b.access_notes, b.liveaboard, b.knock_first],
  );
  await audit(q, ACTOR, "update", "boat", id, { name: b.name, slip: b.slip });
  done(fd, "Boat saved. Future visits use the new location.");
}

export async function pauseBoatAction(fd: FormData) {
  await requireManager();
  const id = field(fd, "boat_id");
  if (!isUuid(id)) fail(fd, "Boat not found.");
  const until = field(fd, "until", 10);
  const reason = field(fd, "reason", 60) || "Paused";
  await tx(async (t) => {
    await pauseBoat(t, id, isDate(until) ? until : null, reason);
    await audit(t, ACTOR, "pause", "boat", id, { until, reason });
  });
  done(fd, isDate(until) ? `Paused until ${until}.` : "Paused until you resume it.");
}

export async function resumeBoatAction(fd: FormData) {
  await requireManager();
  const id = field(fd, "boat_id");
  if (!isUuid(id)) fail(fd, "Boat not found.");
  await tx(async (t) => {
    await resumeBoat(t, id);
    await audit(t, ACTOR, "resume", "boat", id);
  });
  done(fd, "Resumed. Upcoming visits are back on the schedule.");
}

export async function markBoatSold(fd: FormData) {
  await requireManager();
  const id = field(fd, "boat_id");
  if (!isUuid(id)) fail(fd, "Boat not found.");
  await tx(async (t) => {
    await t("update boats set status = 'sold' where id = $1", [id]);
    await t("update plans set active = false where boat_id = $1", [id]);
    await t(
      `update jobs set status = 'cancelled', cancel_reason = 'Boat sold', updated_at = now()
       where boat_id = $1 and status = 'scheduled' and scheduled_date >= $2`,
      [id, todayLA()],
    );
    await audit(t, ACTOR, "sold", "boat", id);
  });
  done(fd, "Boat marked sold. Its upcoming visits are cancelled.");
}

export async function addPlan(fd: FormData) {
  await requireManager();
  const boatId = field(fd, "boat_id");
  if (!isUuid(boatId)) fail(fd, "Boat not found.");
  const plan = planInput(fd);
  if (!plan) fail(fd, "Choose the first visit date and frequency.");
  if (typeof plan === "string") fail(fd, plan);
  await tx(async (t) => {
    const id = await insertPlan(t, boatId, plan);
    await audit(t, ACTOR, "create", "plan", id, { boatId });
    await generateJobs(t, { planIds: [id] });
  });
  done(fd, "Plan added and visits scheduled.");
}

// "This and all future visits": update the plan, then rebuild untouched future jobs from the chosen date.
export async function updatePlan(fd: FormData) {
  await requireManager();
  const id = field(fd, "plan_id");
  if (!isUuid(id)) fail(fd, "Plan not found.");
  const plan = planInput(fd);
  if (!plan) fail(fd, "Choose the first visit date and frequency.");
  if (typeof plan === "string") fail(fd, plan);
  const from = field(fd, "apply_from", 10);
  await tx(async (t) => {
    await t(
      `update plans set service_id = $2, crew_id = $3, anchor_date = $4, interval_weeks = $5, off_interval_weeks = $6,
         season_start = $7, season_end = $8 where id = $1`,
      [id, plan.service_id, plan.crew_id, plan.anchor_date, plan.interval_weeks, plan.off_interval_weeks, plan.season_start, plan.season_end],
    );
    // Crew and service changes also apply to future visits that were otherwise left alone.
    await regeneratePlan(t, id, isDate(from) ? from : todayLA());
    await audit(t, ACTOR, "update", "plan", id, { ...plan, from });
  });
  done(fd, "Plan saved. Future visits were rebuilt; visits you edited one by one were kept.");
}

export async function endPlan(fd: FormData) {
  await requireManager();
  const id = field(fd, "plan_id");
  if (!isUuid(id)) fail(fd, "Plan not found.");
  await tx(async (t) => {
    await t("update plans set active = false, end_date = $2 where id = $1", [id, addDays(todayLA(), -1)]);
    await t(
      `delete from jobs where plan_id = $1 and scheduled_date >= $2 and origin = 'plan' and not is_override
         and status = 'scheduled' and started_at is null
         and not exists (select 1 from photos ph where ph.job_id = jobs.id)`,
      [id, todayLA()],
    );
    await audit(t, ACTOR, "end", "plan", id);
  });
  done(fd, "Plan ended. Its upcoming visits were removed.");
}

// ---------- Jobs ----------

export async function createJob(fd: FormData) {
  await requireManager();
  const boatId = field(fd, "boat_id");
  const date = field(fd, "date", 10);
  if (!isUuid(boatId)) fail(fd, "Choose the boat.", "/manager/jobs/new");
  if (!isDate(date)) fail(fd, "Choose the date.", "/manager/jobs/new");
  const row = await one<{ id: string }>(
    `insert into jobs (public_id, boat_id, service_id, crew_id, scheduled_date, origin, manager_notes)
     values ($1, $2, $3, $4, $5, 'manual', $6) returning id`,
    [newPublicId(), boatId, uuidOrNull(field(fd, "service_id")), uuidOrNull(field(fd, "crew_id")), date, field(fd, "notes", 500)],
  );
  await audit(q, ACTOR, "create", "job", row!.id, { date });
  redirect(`/manager/jobs/${row!.id}?ok=${encodeURIComponent("Job created.")}`);
}

// "This visit only": changes one job and protects it from plan rebuilds.
export async function updateJob(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  const date = field(fd, "date", 10);
  if (!isUuid(id) || !isDate(date)) fail(fd, "Choose a valid date.");
  const before = await one<{ scheduled_date: string; crew_id: string | null }>("select scheduled_date, crew_id from jobs where id = $1", [id]);
  if (!before) fail(fd, "Job not found.");
  await q(
    `update jobs set scheduled_date = $2, crew_id = $3, service_id = $4, manager_notes = $5, is_override = true,
       rescheduled_from = case when $2::date <> scheduled_date then coalesce(rescheduled_from, scheduled_date) else rescheduled_from end,
       status = case when status = 'needs_reschedule' and $2::date <> scheduled_date then 'scheduled' else status end,
       updated_at = now()
     where id = $1`,
    [id, date, uuidOrNull(field(fd, "crew_id")), uuidOrNull(field(fd, "service_id")), field(fd, "notes", 1000)],
  );
  await audit(q, ACTOR, "update", "job", id, { date, crew: field(fd, "crew_id"), was: before });
  done(fd, "Visit saved.");
}

export async function setJobStatus(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  const op = field(fd, "op", 20);
  if (!isUuid(id)) fail(fd, "Job not found.");
  if (op === "cancel") {
    await q("update jobs set status = 'cancelled', cancel_reason = $2, is_override = true, updated_at = now() where id = $1", [
      id,
      field(fd, "reason", 120) || "Cancelled by manager",
    ]);
  } else if (op === "reschedule") {
    await q("update jobs set status = 'needs_reschedule', is_override = true, updated_at = now() where id = $1", [id]);
  } else if (op === "reopen") {
    await q(
      `update jobs set status = case when started_at is null then 'scheduled' else 'in_progress' end,
         cancel_reason = '', skip_reason = '', completed_at = null, is_override = true, updated_at = now() where id = $1`,
      [id],
    );
  } else if (op === "reviewed") {
    await q("update jobs set needs_review = false, updated_at = now() where id = $1", [id]);
  } else {
    fail(fd, "Unknown action.");
  }
  await audit(q, ACTOR, op, "job", id, { reason: field(fd, "reason", 120) });
  done(fd, op === "reviewed" ? "Marked reviewed." : "Visit updated.");
}

// From the reschedule queue: new date (and crew) for a skipped or declined visit.
export async function rescheduleJob(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  const date = field(fd, "date", 10);
  if (!isUuid(id) || !isDate(date)) fail(fd, "Choose the new date.");
  const job = await one<{ status: string; scheduled_date: string }>("select status, scheduled_date from jobs where id = $1", [id]);
  if (!job) fail(fd, "Job not found.");
  if (job.status === "skipped") {
    // Keep the skipped visit as history and book a new one.
    const src = await one<{ boat_id: string; service_id: string | null; crew_id: string | null }>(
      "select boat_id, service_id, crew_id from jobs where id = $1",
      [id],
    );
    await tx(async (t) => {
      await t(
        `insert into jobs (public_id, boat_id, service_id, crew_id, scheduled_date, origin, rescheduled_from, manager_notes)
         values ($1, $2, $3, $4, $5, 'manual', $6, 'Rescheduled after a skip')`,
        [newPublicId(), src!.boat_id, src!.service_id, uuidOrNull(field(fd, "crew_id")) ?? src!.crew_id, date, job.scheduled_date],
      );
      await t("update jobs set manager_notes = trim(manager_notes || ' Rescheduled to ' || $2) where id = $1", [id, date]);
      await audit(t, ACTOR, "reschedule", "job", id, { to: date });
    });
  } else {
    await q(
      `update jobs set scheduled_date = $2, crew_id = coalesce($3, crew_id), status = 'scheduled', is_override = true,
         rescheduled_from = coalesce(rescheduled_from, scheduled_date), updated_at = now() where id = $1`,
      [id, date, uuidOrNull(field(fd, "crew_id"))],
    );
    await audit(q, ACTOR, "reschedule", "job", id, { to: date });
  }
  done(fd, `Rescheduled to ${date}.`);
}

// Bulk actions from the schedule board.
export async function bulkJobs(fd: FormData) {
  await requireManager();
  const ids = fd.getAll("ids").map(String).filter(isUuid);
  const op = field(fd, "op", 20);
  if (!ids.length) fail(fd, "Select at least one visit.");
  let msg = "";
  if (op === "assign") {
    const crew = uuidOrNull(field(fd, "bulk_crew_id"));
    await q("update jobs set crew_id = $2, is_override = true, updated_at = now() where id = any($1::uuid[])", [ids, crew]);
    msg = crew ? `Assigned ${ids.length} visit(s).` : `Unassigned ${ids.length} visit(s).`;
  } else if (op === "move") {
    const date = field(fd, "bulk_date", 10);
    if (!isDate(date)) fail(fd, "Choose the date to move to.");
    await q(
      `update jobs set scheduled_date = $2, is_override = true, rescheduled_from = coalesce(rescheduled_from, scheduled_date),
         status = case when status = 'needs_reschedule' then 'scheduled' else status end, updated_at = now()
       where id = any($1::uuid[]) and status in ('scheduled', 'needs_reschedule')`,
      [ids, date],
    );
    msg = `Moved to ${date}.`;
  } else if (op === "cancel") {
    await q(
      `update jobs set status = 'cancelled', cancel_reason = $2, is_override = true, updated_at = now()
       where id = any($1::uuid[]) and status in ('scheduled', 'needs_reschedule')`,
      [ids, field(fd, "bulk_reason", 120) || "Cancelled by manager"],
    );
    msg = `Cancelled ${ids.length} visit(s).`;
  } else {
    fail(fd, "Choose what to do with the selected visits.");
  }
  await audit(q, ACTOR, `bulk_${op}`, "job", null, { ids });
  done(fd, msg);
}

// Weather day: every visit on the date that hasn't started either moves or is skipped to the next regular visit.
export async function weatherDay(fd: FormData) {
  await requireManager();
  const date = field(fd, "date", 10);
  const mode = field(fd, "mode", 10);
  const to = field(fd, "to_date", 10);
  if (!isDate(date)) fail(fd, "Choose the day.");
  let n = 0;
  if (mode === "move") {
    if (!isDate(to) || to <= date) fail(fd, "Choose a later date to move the visits to.");
    const rows = await q(
      `update jobs set scheduled_date = $2, is_override = true, rescheduled_from = coalesce(rescheduled_from, scheduled_date),
         manager_notes = trim(manager_notes || ' Moved for weather.'), updated_at = now()
       where scheduled_date = $1 and status = 'scheduled' and started_at is null returning id`,
      [date, to],
    );
    n = rows.length;
  } else {
    const rows = await q(
      `update jobs set status = 'cancelled', cancel_reason = 'Weather', is_override = true, updated_at = now()
       where scheduled_date = $1 and status = 'scheduled' and started_at is null returning id`,
      [date],
    );
    n = rows.length;
  }
  await audit(q, ACTOR, "weather_day", "job", null, { date, mode, to, count: n });
  done(fd, mode === "move" ? `Weather day: ${n} visit(s) moved to ${to}.` : `Weather day: ${n} visit(s) skipped to their next regular visit.`);
}

// ---------- Issues ----------

export async function updateIssue(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Issue not found.");
  const status = field(fd, "status", 20);
  const visibility = field(fd, "visibility", 20);
  const quote = field(fd, "quote_text", 300);
  await q(
    `update issues set manager_note = $2, quote_text = $3,
       status = case when $4 in ('open', 'quoted', 'resolved', 'dismissed') then $4 when $3 <> '' and status = 'open' then 'quoted' else status end,
       visibility = case when $5 in ('portal', 'internal') then $5 else visibility end,
       updated_at = now() where id = $1`,
    [id, field(fd, "manager_note", 1000), quote, status, visibility],
  );
  await audit(q, ACTOR, "update", "issue", id, { status, visibility });
  done(fd, "Issue saved.");
}

// ---------- Requests from customers ----------

export async function approveRequest(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Request not found.");
  const r = await one<{ kind: string; boat_id: string | null; service_ids: string[]; until_date: string | null; note: string; status: string }>(
    "select kind, boat_id, service_ids, until_date, note, status from requests where id = $1",
    [id],
  );
  if (!r || r.status !== "pending") fail(fd, "That request was already handled.");
  if (r.kind === "pause") {
    if (!r.boat_id) fail(fd, "The request has no boat.");
    await tx(async (t) => {
      await pauseBoat(t, r.boat_id!, r.until_date, "Customer request");
      await t("update requests set status = 'approved' where id = $1", [id]);
      await audit(t, ACTOR, "approve", "request", id, { kind: "pause" });
    });
    done(fd, "Pause approved. Visits in that window are cancelled.");
  }
  const date = field(fd, "date", 10);
  if (!isDate(date)) fail(fd, "Choose the date for this service.");
  if (!r.boat_id) fail(fd, "The request has no boat.");
  const names = await q<{ name: string }>("select name from services where id = any($1::uuid[]) order by sort", [r.service_ids]);
  await tx(async (t) => {
    const job = (
      await t<{ id: string }>(
        `insert into jobs (public_id, boat_id, service_id, crew_id, scheduled_date, origin, manager_notes)
         values ($1, $2, $3, $4, $5, 'request', $6) returning id`,
        [
          newPublicId(),
          r.boat_id,
          r.service_ids[0] ?? null,
          uuidOrNull(field(fd, "crew_id")),
          date,
          `Customer request: ${names.map((n) => n.name).join(", ")}${r.note ? `. Note: ${r.note}` : ""}`,
        ],
      )
    )[0];
    await t("update requests set status = 'approved', job_id = $2 where id = $1", [id, job.id]);
    await audit(t, ACTOR, "approve", "request", id, { job: job.id, date });
  });
  done(fd, `Approved and scheduled for ${date}.`);
}

export async function declineRequest(fd: FormData) {
  await requireManager();
  const id = field(fd, "id");
  if (!isUuid(id)) fail(fd, "Request not found.");
  await q("update requests set status = 'declined', decline_reason = $2 where id = $1 and status = 'pending'", [
    id,
    field(fd, "reason", 200),
  ]);
  await audit(q, ACTOR, "decline", "request", id);
  done(fd, "Request declined.");
}
