import { audit } from "./audit";
import { one, q, tx } from "./db";
import { field, flag } from "./http";
import { isUuid, newPublicId } from "./ids";
import { logConsent, MARKETING_SMS_WORDING, normalizeEmail, normalizePhone, SERVICE_SMS_WORDING } from "./messaging/compliance";
import { BERTH_TYPES } from "./repo";

// Sales capture. Two kinds of record:
//   - A spotted boat: seen on a dock, owner not known. Marina, dock, slip, name and what was noticed.
//   - A lead: a person, stored as a prospect with the same details a customer has (contact, address, boat, berth).
// When the owner of a spotted boat becomes known, the boat is linked to the new lead.

export const BOAT_TYPES = ["Sailboat", "Powerboat", "Trawler", "Catamaran", "Houseboat", "Other"];
export const SPOT_STATUS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  owner_added: "Owner added",
  not_interested: "Not interested",
  already_customer: "Already a customer",
};
export const LEAD_SOURCES = ["Phone call", "Dock walk", "Referral", "Boat show", "Website", "Walk-up", "Other"];

export type Spotted = {
  id: string; marina_id: string; dock_id: string | null; marina_name: string; dock_name: string | null; slip: string; boat_name: string;
  make_model: string; length_ft: number | null; boat_type: string; condition: string; status: string; customer_id: string | null;
  customer_name: string | null; spotted_by: string; spotted_at: string;
};

export const SPOTTED_SELECT = `
  select s.id, s.marina_id, s.dock_id, m.name as marina_name, d.name as dock_name, s.slip, s.boat_name, s.make_model, s.length_ft, s.boat_type,
    s.condition, s.status, s.customer_id, c.name as customer_name, s.spotted_by, s.spotted_at
  from spotted_boats s join marinas m on m.id = s.marina_id left join docks d on d.id = s.dock_id left join customers c on c.id = s.customer_id`;

// Slips sort the way a person reads them: A-2 before A-10.
export const SLIP_ORDER = `regexp_replace(s.slip, '[0-9]+.*$', ''), nullif(regexp_replace(s.slip, '[^0-9]', '', 'g'), '')::bigint nulls last, s.slip`;

export type SpotInput = {
  clientId?: string; marinaId: string; dockId?: string | null; slip: string; boatName: string; makeModel?: string; lengthFt?: number | null;
  boatType?: string; condition?: string;
};

// Idempotent on clientId, so a phone that retries after losing signal never creates a second record.
export async function saveSpotted(i: SpotInput, by: string): Promise<{ id: string; duplicateOf?: string } | { error: string }> {
  if (!isUuid(i.marinaId) || !(await one("select 1 from marinas where id = $1", [i.marinaId]))) return { error: "Choose the marina." };
  const dockId = i.dockId && isUuid(i.dockId) && (await one("select 1 from docks where id = $1 and marina_id = $2", [i.dockId, i.marinaId])) ? i.dockId : null;
  const slip = (i.slip ?? "").trim().slice(0, 20);
  const boatName = (i.boatName ?? "").trim().slice(0, 80);
  if (!slip && !boatName) return { error: "Enter the slip, the boat name, or both." };
  const clientId = (i.clientId ?? "").slice(0, 60) || null;
  if (clientId) {
    const seen = await one<{ id: string }>("select id from spotted_boats where client_id = $1", [clientId]);
    if (seen) return { id: seen.id };
  }
  // Same slip on the same dock was already logged: update that record rather than adding a second one.
  if (slip) {
    const same = await one<{ id: string }>(
      "select id from spotted_boats where marina_id = $1 and dock_id is not distinct from $2 and lower(slip) = lower($3) and status <> 'owner_added' limit 1",
      [i.marinaId, dockId, slip],
    );
    if (same) {
      await q(
        `update spotted_boats set boat_name = case when $2 <> '' then $2 else boat_name end, make_model = case when $3 <> '' then $3 else make_model end,
           length_ft = coalesce($4, length_ft), boat_type = case when $5 <> '' then $5 else boat_type end,
           condition = case when $6 <> '' then $6 else condition end, updated_at = now() where id = $1`,
        [same.id, boatName, (i.makeModel ?? "").trim().slice(0, 80), i.lengthFt ?? null, (i.boatType ?? "").slice(0, 20), (i.condition ?? "").trim().slice(0, 500)],
      );
      return { id: same.id, duplicateOf: same.id };
    }
  }
  const row = await one<{ id: string }>(
    `insert into spotted_boats (client_id, marina_id, dock_id, slip, boat_name, make_model, length_ft, boat_type, condition, spotted_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [clientId, i.marinaId, dockId, slip, boatName, (i.makeModel ?? "").trim().slice(0, 80), i.lengthFt ?? null, (i.boatType ?? "").slice(0, 20), (i.condition ?? "").trim().slice(0, 500), by],
  );
  await audit(q, by, "create", "spotted_boat", row!.id, { slip, boat: boatName });
  return { id: row!.id };
}

// Creates a lead (a prospect) with the same details as a customer. Consent rules match the manager's prospect form.
export async function createLead(fd: FormData, by: string): Promise<{ id: string } | { error: string }> {
  const name = field(fd, "name", 100);
  const phone = field(fd, "phone", 30);
  const email = field(fd, "email", 120);
  if (!name) return { error: "Enter the person's name." };
  if (phone && !normalizePhone(phone)) return { error: "That phone number is not a valid US number." };
  if (email && !normalizeEmail(email)) return { error: "That email address does not look right." };
  if (!phone && !email && !field(fd, "address1", 120)) return { error: "Add at least one way to reach them: phone, email or mailing address." };
  const dup = await one<{ id: string; name: string; status: string }>(
    `select id, name, status from customers where ($1 <> '' and regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g') and phone <> '')
       or ($2 <> '' and lower(email) = lower($2)) limit 1`,
    [phone, email],
  );
  if (dup && !flag(fd, "allow_duplicate")) {
    return { error: `${dup.name} is already on file${dup.status === "prospect" ? " as a lead" : " as a customer"} with that phone or email. Tick “Add anyway” if this is a different person.` };
  }
  const sms = flag(fd, "sms_consent");
  const promo = flag(fd, "promo_sms_consent");
  const how = field(fd, "consent_method", 200);
  if ((sms || promo) && !normalizePhone(phone)) return { error: "Text permission needs a mobile number." };
  if ((sms || promo) && !how) return { error: "Say how this person agreed to texts (for example: asked on the phone to get reminders by text)." };
  if (promo && !flag(fd, "promo_written")) return { error: "Marketing texts need consent in writing. Tick the box confirming you have it, or leave marketing texts unticked." };

  // Boat details are optional, but a boat needs its marina.
  const boatName = field(fd, "boat_name", 80);
  const slip = field(fd, "slip", 20);
  const marinaId = field(fd, "marina_id");
  const dockId = field(fd, "dock_id");
  const hasBoat = Boolean(boatName || slip || field(fd, "make_model", 80));
  if (hasBoat && !isUuid(marinaId)) return { error: "Choose the marina for the boat, or clear the boat details." };
  if (hasBoat && isUuid(dockId) && !(await one("select 1 from docks where id = $1 and marina_id = $2", [dockId, marinaId]))) return { error: "That dock is not at the chosen marina." };
  const berth = field(fd, "berth_type", 20);
  const lengthRaw = field(fd, "length_ft", 4);
  const spottedId = field(fd, "spotted_id");
  const note = (() => {
    const v = fd.get("note");
    return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, 2000) : "";
  })();
  const neededBy = field(fd, "needed_by", 10);

  const id = await tx(async (t) => {
    const c = (
      await t<{ id: string }>(
        `insert into customers (name, phone, email, status, notes, portal_token, source, interest, address1, address2, city, state, postal_code,
           contact_pref, sms_consent, consent_at, consent_text, promo_sms_consent, promo_sms_consent_at, marketing_consent)
         values ($1, $2, $3, 'prospect', '', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, false) returning id`,
        [
          name, phone, email, newPublicId(), `${field(fd, "source", 60) || "Sales"} (${by})`, field(fd, "interest", 200),
          field(fd, "address1", 120), field(fd, "address2", 120), field(fd, "city", 80), field(fd, "state", 20).toUpperCase(), field(fd, "postal_code", 12),
          sms ? "text" : email ? "email" : "none", sms, sms ? new Date().toISOString() : null, sms ? SERVICE_SMS_WORDING : "", promo, promo ? new Date().toISOString() : null,
        ],
      )
    )[0];
    if (hasBoat) {
      await t(
        `insert into boats (customer_id, name, make_model, length_ft, hull_color, marina_id, dock_id, slip, berth_type, access_notes, liveaboard)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          c.id, boatName || "Boat (name not known)", field(fd, "make_model", 80), /^\d+$/.test(lengthRaw) ? Number(lengthRaw) : null, field(fd, "hull_color", 40),
          marinaId, isUuid(dockId) ? dockId : null, slip, BERTH_TYPES.some(([v]) => v === berth) ? berth : "slip", field(fd, "access_notes", 500), flag(fd, "liveaboard"),
        ],
      );
    }
    const addr = normalizePhone(phone) ?? phone;
    if (sms) await logConsent(t, { customerId: c.id, name, address: addr, channel: "sms", purpose: "service", action: "granted", method: `Recorded by ${by}: ${how}`, wording: SERVICE_SMS_WORDING, actor: by });
    if (promo) await logConsent(t, { customerId: c.id, name, address: addr, channel: "sms", purpose: "marketing", action: "granted", method: `Recorded by ${by}: ${how}`, wording: MARKETING_SMS_WORDING, actor: by });
    if (note) await t("insert into customer_notes (customer_id, body, needed_by, created_by) values ($1, $2, $3, $4)", [c.id, note, /^\d{4}-\d{2}-\d{2}$/.test(neededBy) ? neededBy : null, by]);
    if (isUuid(spottedId)) await t("update spotted_boats set status = 'owner_added', customer_id = $2, updated_at = now() where id = $1", [spottedId, c.id]);
    await audit(t, by, "create", "lead", c.id, { name, boat: boatName || null });
    return c.id;
  });
  return { id };
}

// Marinas and docks for pickers. Gate codes are never included: sales people do not need them.
export async function places() {
  const [marinas, docks] = await Promise.all([
    q<{ id: string; name: string }>("select id, name from marinas order by name"),
    q<{ id: string; name: string; marina_id: string; marina: string }>("select d.id, d.name, d.marina_id, m.name as marina from docks d join marinas m on m.id = d.marina_id order by m.name, d.name"),
  ]);
  return { marinas, docks };
}
