"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { one, q } from "@/lib/db";
import { field, personName, saveNameParts } from "@/lib/http";
import { isUuid } from "@/lib/ids";
import { normalizeEmail, normalizePhone } from "@/lib/messaging/compliance";
import { IMPORT_FIELDS, importLeads, type ImportRow, type ImportSummary } from "@/lib/import";
import { createLead, saveSpotted, SPOT_STATUS } from "@/lib/sales";
import { requireSales } from "@/lib/session";
import { isLeadStage } from "@/lib/stages";

function go(path: string, key: "ok" | "error", msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
}
function backPath(fd: FormData, fallback: string) {
  const b = field(fd, "back", 300);
  return b.startsWith("/sales") ? b : fallback;
}

// A marina or dock the app does not know yet. Sales people add names only; the manager adds gates and codes later.
export async function addPlace(fd: FormData) {
  const user = await requireSales();
  const marinaName = field(fd, "marina_name", 80);
  let marinaId = field(fd, "marina_id");
  if (marinaName) {
    const existing = await one<{ id: string }>("select id from marinas where lower(name) = lower($1)", [marinaName]);
    marinaId = existing?.id ?? (await one<{ id: string }>("insert into marinas (name) values ($1) returning id", [marinaName]))!.id;
    if (!existing) await audit(q, user.name, "create", "marina", marinaId, { name: marinaName, by: "sales" });
  }
  if (!isUuid(marinaId)) go("/sales/walk", "error", "Choose a marina or type a new one.");
  const dockName = field(fd, "dock_name", 40);
  let dockId = field(fd, "dock_id");
  if (dockName) {
    const existing = await one<{ id: string }>("select id from docks where marina_id = $1 and lower(name) = lower($2)", [marinaId, dockName]);
    dockId = existing?.id ?? (await one<{ id: string }>("insert into docks (marina_id, name) values ($1, $2) returning id", [marinaId, dockName]))!.id;
    if (!existing) await audit(q, user.name, "create", "dock", dockId, { name: dockName, by: "sales" });
  }
  redirect(`/sales/walk?marina=${marinaId}${isUuid(dockId) ? `&dock=${dockId}` : ""}`);
}

// Used when the phone has no JavaScript queue (the form's plain fallback) and for edits.
export async function saveSpottedForm(fd: FormData) {
  const user = await requireSales();
  const back = backPath(fd, "/sales/walk");
  const len = field(fd, "length_ft", 4);
  const r = await saveSpotted(
    {
      clientId: field(fd, "client_id", 60), marinaId: field(fd, "marina_id"), dockId: field(fd, "dock_id"), slip: field(fd, "slip", 20), boatName: field(fd, "boat_name", 80),
      makeModel: field(fd, "make_model", 80), lengthFt: /^\d+$/.test(len) ? Number(len) : null, boatType: field(fd, "boat_type", 20), condition: field(fd, "condition", 500),
    },
    user.name,
  );
  if ("error" in r) go(back, "error", r.error);
  go(back, "ok", r.duplicateOf ? "That slip was already logged. Updated it." : "Boat saved.");
}

export async function updateSpotted(fd: FormData) {
  const user = await requireSales();
  const id = field(fd, "id");
  if (!isUuid(id)) go("/sales", "error", "Boat not found.");
  const back = `/sales/boats/${id}`;
  const status = field(fd, "status", 20);
  const len = field(fd, "length_ft", 4);
  await q(
    `update spotted_boats set slip = $2, boat_name = $3, make_model = $4, length_ft = $5, boat_type = $6, condition = $7,
       status = case when $8 = any($9::text[]) and status <> 'owner_added' then $8 else status end, updated_at = now() where id = $1`,
    [id, field(fd, "slip", 20), field(fd, "boat_name", 80), field(fd, "make_model", 80), /^\d+$/.test(len) ? Number(len) : null, field(fd, "boat_type", 20), field(fd, "condition", 500), status, Object.keys(SPOT_STATUS).filter((s) => s !== "owner_added")],
  );
  await audit(q, user.name, "update", "spotted_boat", id, { status });
  go(back, "ok", "Saved.");
}

export async function deleteSpotted(fd: FormData) {
  const user = await requireSales();
  const id = field(fd, "id");
  if (!isUuid(id)) go("/sales", "error", "Boat not found.");
  // Sales people can remove boats they logged; managers can remove any.
  const rows = await q<{ marina_id: string; dock_id: string | null }>(
    "delete from spotted_boats where id = $1 and ($2 or spotted_by = $3) returning marina_id, dock_id",
    [id, user.manager, user.name],
  );
  if (!rows.length) go(`/sales/boats/${id}`, "error", "Only a manager or the person who logged this boat can delete it.");
  await audit(q, user.name, "delete", "spotted_boat", id);
  go(`/sales/walk?marina=${rows[0].marina_id}${rows[0].dock_id ? `&dock=${rows[0].dock_id}` : ""}`, "ok", "Boat removed.");
}

export async function newLead(fd: FormData) {
  const user = await requireSales();
  const r = await createLead(fd, user.name);
  if ("error" in r) return { error: r.error };
  redirect(`/sales/leads/${r.id}?ok=${encodeURIComponent("Lead saved.")}`);
}

// Sales people can correct a lead's contact details. Once the person is a customer, only a manager can.
export async function updateLead(fd: FormData) {
  const user = await requireSales();
  const id = field(fd, "id");
  if (!isUuid(id)) go("/sales/leads", "error", "Lead not found.");
  const back = `/sales/leads/${id}`;
  const c = await one<{ status: string; phone: string }>("select status, phone from customers where id = $1", [id]);
  if (!c || !isLeadStage(c.status)) go("/sales/leads", "error", "That person is a customer now. Ask a manager to change their details.");
  const person = personName(fd);
  const name = person.name;
  const phone = field(fd, "phone", 30);
  const email = field(fd, "email", 120);
  if (!person.first) go(back, "error", "Enter the first name.");
  await saveNameParts(q, "customers", id, person);
  if (phone && !normalizePhone(phone)) go(back, "error", "That phone number is not a valid US number.");
  if (email && !normalizeEmail(email)) go(back, "error", "That email address does not look right.");
  const digits = (v: string) => v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const phoneChanged = digits(c.phone) !== digits(phone);
  await q(
    `update customers set name = $2, phone = $3, email = $4, interest = $5, address1 = $6, address2 = $7, city = $8, state = $9, postal_code = $10 where id = $1`,
    [id, name, phone, email, field(fd, "interest", 200), field(fd, "address1", 120), field(fd, "address2", 120), field(fd, "city", 80), field(fd, "state", 20).toUpperCase(), field(fd, "postal_code", 12)],
  );
  // Permission to text belongs to the number it was given for.
  if (phoneChanged) {
    const had = await q("update customers set sms_consent = false, promo_sms_consent = false, promo_sms_consent_at = null, sms_opted_out_at = null where id = $1 and (sms_consent or promo_sms_consent) returning id", [id]);
    if (had.length) {
      await q(
        `insert into consent_log (customer_id, customer_name, address, channel, purpose, action, method, actor)
         values ($1, $2, $3, 'sms', 'all', 'revoked', 'Phone number changed; permission must be given again for the new number', $4)`,
        [id, name, c.phone, user.name],
      );
    }
  }
  await audit(q, user.name, "update", "lead", id);
  go(back, "ok", phoneChanged ? "Saved. The phone number changed, so text permission was cleared." : "Saved.");
}

// ---------- Marinas ----------

export async function addMarina(fd: FormData) {
  const user = await requireSales();
  const name = field(fd, "name", 80);
  if (!name) go("/sales/marinas", "error", "Enter the marina's name.");
  const existing = await one<{ id: string }>("select id from marinas where lower(name) = lower($1)", [name]);
  if (existing) go("/sales/marinas", "error", `${name} is already listed.`);
  const m = (await one<{ id: string }>("insert into marinas (name, address, notes) values ($1, $2, $3) returning id", [name, field(fd, "address", 200), field(fd, "notes", 500)]))!;
  // Docks typed as "A, B, C" are added in one go.
  const docks = [...new Set(field(fd, "docks", 300).split(/[,;\n]/).map((d) => d.trim().replace(/^dock\s+/i, "").slice(0, 40)).filter(Boolean))].slice(0, 40);
  for (const d of docks) await q("insert into docks (marina_id, name) values ($1, $2)", [m.id, d]);
  await audit(q, user.name, "create", "marina", m.id, { name, docks: docks.length, by: "sales" });
  go("/sales/marinas", "ok", `${name} added${docks.length ? ` with ${docks.length} dock(s)` : ""}. A manager adds gates and gate codes.`);
}

export async function addDocks(fd: FormData) {
  const user = await requireSales();
  const marinaId = field(fd, "marina_id");
  if (!isUuid(marinaId) || !(await one("select 1 from marinas where id = $1", [marinaId]))) go("/sales/marinas", "error", "Marina not found.");
  const names = [...new Set(field(fd, "docks", 300).split(/[,;\n]/).map((d) => d.trim().replace(/^dock\s+/i, "").slice(0, 40)).filter(Boolean))].slice(0, 40);
  if (!names.length) go("/sales/marinas", "error", "Type at least one dock name.");
  let added = 0;
  for (const d of names) {
    const r = await q("insert into docks (marina_id, name) select $1, $2 where not exists (select 1 from docks where marina_id = $1 and lower(name) = lower($2)) returning id", [marinaId, d]);
    added += r.length;
  }
  await audit(q, user.name, "create", "dock", marinaId, { added, by: "sales" });
  go("/sales/marinas", "ok", added ? `${added} dock(s) added.` : "Those docks were already listed.");
}

// ---------- List import ----------

export async function runImport(payload: string): Promise<ImportSummary | { error: string }> {
  const user = await requireSales();
  let data: { rows?: unknown; listName?: unknown; stage?: unknown; duplicates?: unknown; firstRow?: unknown };
  try {
    data = JSON.parse(payload);
  } catch {
    return { error: "The list could not be read. Try again." };
  }
  if (!Array.isArray(data.rows) || !data.rows.length) return { error: "The list has no rows." };
  if (data.rows.length > 500) return { error: "Send at most 500 rows at a time." };
  const allowed = new Set(IMPORT_FIELDS.map(([k]) => k));
  const rows: ImportRow[] = data.rows.map((r) => {
    const o: ImportRow = {};
    if (r && typeof r === "object") for (const [k, v] of Object.entries(r as Record<string, unknown>)) if (allowed.has(k) && typeof v === "string") o[k] = v.slice(0, 2000);
    return o;
  });
  const listName = (typeof data.listName === "string" ? data.listName : "").trim().slice(0, 80) || `List ${new Date().toISOString().slice(0, 10)}`;
  return importLeads(
    rows,
    { listName, stage: data.stage === "lead" ? "lead" : "prospect", duplicates: data.duplicates === "fill" ? "fill" : "skip", firstRow: Number.isInteger(data.firstRow) ? (data.firstRow as number) : 2 },
    user.name,
  );
}
