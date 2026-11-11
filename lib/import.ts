import { audit } from "./audit";
import { one, q, tx } from "./db";
import { newPublicId } from "./ids";
import { normalizeEmail, normalizePhone } from "./messaging/compliance";

// Bulk lead import. The approach follows the common CRM pattern: match columns to fields, find duplicates by a
// unique identifier (here email or phone), then create, fill in or skip each row and report every skip with a reason.
// An import never grants permission to text: that has to come from the person.

export const IMPORT_FIELDS: [string, string][] = [
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["full_name", "Full name (split automatically)"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["address1", "Street address"],
  ["address2", "Apartment, suite or PO box"],
  ["city", "City"],
  ["state", "State"],
  ["postal_code", "ZIP"],
  ["boat_name", "Boat name"],
  ["make_model", "Boat make and model"],
  ["length_ft", "Boat length (ft)"],
  ["marina", "Marina"],
  ["dock", "Dock"],
  ["slip", "Slip"],
  ["interest", "Interested in"],
  ["note", "Note"],
];

export type ImportRow = Record<string, string>;
export type ImportOutcome = { row: number; result: "added" | "updated" | "skipped"; reason?: string; name?: string };
export type ImportSummary = { added: number; updated: number; skipped: number; outcomes: ImportOutcome[] };

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const digits = (v: string) => v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

export async function importLeads(
  rows: ImportRow[],
  opts: { listName: string; stage: "prospect" | "lead"; duplicates: "skip" | "fill"; firstRow: number },
  by: string,
): Promise<ImportSummary> {
  const out: ImportSummary = { added: 0, updated: 0, skipped: 0, outcomes: [] };
  const [marinas, docks] = await Promise.all([
    q<{ id: string; name: string }>("select id, name from marinas"),
    q<{ id: string; name: string; marina_id: string }>("select id, name, marina_id from docks"),
  ]);
  const seen = new Set<string>();
  const skip = (row: number, reason: string, name?: string) => {
    out.skipped++;
    out.outcomes.push({ row, result: "skipped", reason, name });
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = opts.firstRow + i;
    let first = clip(r.first_name, 50);
    let last = clip(r.last_name, 50);
    const full = clip(r.full_name, 100);
    if (!first && full) {
      // "Smith, Dana" and "Dana Smith" are both common in lists.
      if (full.includes(",")) {
        const [l, f] = full.split(",", 2).map((x) => x.trim());
        first = f.slice(0, 50);
        last = last || l.slice(0, 50);
      } else {
        const parts = full.split(" ");
        first = parts[0].slice(0, 50);
        last = last || parts.slice(1).join(" ").slice(0, 50);
      }
    }
    const name = `${first} ${last}`.trim();
    const phoneRaw = clip(r.phone, 30);
    const emailRaw = clip(r.email, 120);
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    const email = emailRaw ? normalizeEmail(emailRaw) : null;
    const address1 = clip(r.address1, 120);
    const boatName = clip(r.boat_name, 80);
    if (!first && !boatName) { skip(rowNo, "No name"); continue; }
    if (phoneRaw && !phone && !email && !address1) { skip(rowNo, `Phone "${phoneRaw}" is not a valid US number and there is no other way to reach them`, name); continue; }
    if (emailRaw && !email && !phone && !address1) { skip(rowNo, `Email "${emailRaw}" is not valid and there is no other way to reach them`, name); continue; }
    if (!phone && !email && !address1) { skip(rowNo, "No phone, email or mailing address", name); continue; }

    // People with only a mailing address are matched on name plus street address.
    const keys = [phone ? `p:${digits(phone)}` : "", email ? `e:${email}` : "", !phone && !email ? `a:${name.toLowerCase()}|${address1.toLowerCase()}` : ""].filter(Boolean);
    if (keys.some((k) => seen.has(k))) { skip(rowNo, "Same phone or email as an earlier row in this file", name); continue; }
    keys.forEach((k) => seen.add(k));

    const existing = !phone && !email
      ? await one<{ id: string; name: string; status: string }>("select id, name, status from customers where lower(name) = lower($1) and lower(address1) = lower($2) limit 1", [name, address1])
      : keys.length
      ? await one<{ id: string; name: string; status: string }>(
          `select id, name, status from customers
           where ($1 <> '' and phone <> '' and regexp_replace(regexp_replace(phone, '[^0-9]', '', 'g'), '^1(?=[0-9]{10}$)', '') = $1) or ($2 <> '' and lower(email) = $2)
           order by status in ('prospect', 'lead') desc limit 1`,
          [phone ? digits(phone) : "", email ?? ""],
        )
      : null;
    const fields = {
      phone: phone ? phoneRaw : "", email: email ?? "", address1, address2: clip(r.address2, 120), city: clip(r.city, 80),
      state: clip(r.state, 20).toUpperCase(), postal_code: clip(r.postal_code, 12), interest: clip(r.interest, 200),
    };
    if (existing) {
      if (existing.status === "dnc") { skip(rowNo, `${existing.name} is on your do-not-contact list`, name); continue; }
      if (!["prospect", "lead"].includes(existing.status)) { skip(rowNo, `${existing.name} is already a customer`, name); continue; }
      if (opts.duplicates === "skip") { skip(rowNo, `Already on file as ${existing.name}`, name); continue; }
      // Fill blanks only: nothing a person typed earlier is overwritten.
      await q(
        `update customers set phone = case when phone = '' then $2 else phone end, email = case when email = '' then $3 else email end,
           address1 = case when address1 = '' then $4 else address1 end, address2 = case when address1 = '' then $5 else address2 end,
           city = case when city = '' then $6 else city end, state = case when state = '' then $7 else state end,
           postal_code = case when postal_code = '' then $8 else postal_code end, interest = case when interest = '' then $9 else interest end,
           list_name = case when list_name = '' then $10 else list_name end where id = $1`,
        [existing.id, fields.phone, fields.email, fields.address1, fields.address2, fields.city, fields.state, fields.postal_code, fields.interest, opts.listName],
      );
      out.updated++;
      out.outcomes.push({ row: rowNo, result: "updated", name: existing.name, reason: "Filled in blank details" });
      continue;
    }

    const marinaText = clip(r.marina, 80);
    const marina = marinaText ? marinas.find((m) => m.name.toLowerCase() === marinaText.toLowerCase()) ?? marinas.find((m) => m.name.toLowerCase().includes(marinaText.toLowerCase()) || marinaText.toLowerCase().includes(m.name.toLowerCase())) : undefined;
    const dockText = clip(r.dock, 40).replace(/^dock\s+/i, "");
    const dock = marina && dockText ? docks.find((d) => d.marina_id === marina.id && d.name.toLowerCase() === dockText.toLowerCase()) : undefined;
    const slip = clip(r.slip, 20);
    const lengthRaw = clip(r.length_ft, 6).replace(/[^\d]/g, "");
    const note = [clip(r.note, 1500), marinaText && !marina ? `Marina on the list: ${marinaText}${dockText ? `, dock ${dockText}` : ""}` : "", marina && dockText && !dock ? `Dock on the list: ${dockText}` : ""].filter(Boolean).join("\n");
    const personFirst = first || "Owner";
    const personLast = first ? last : `of ${boatName}`;
    await tx(async (t) => {
      const c = (
        await t<{ id: string }>(
          `insert into customers (name, first_name, last_name, phone, email, status, portal_token, source, interest, address1, address2, city, state, postal_code,
             contact_pref, list_name, stage_changed_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now()) returning id`,
          [
            `${personFirst} ${personLast}`.trim(), personFirst, personLast, fields.phone, fields.email, opts.stage, newPublicId(), `Imported list (${by})`, fields.interest,
            fields.address1, fields.address2, fields.city, fields.state, fields.postal_code, email ? "email" : "none", opts.listName,
          ],
        )
      )[0];
      if (boatName || slip || clip(r.make_model, 80)) {
        await t(
          "insert into boats (customer_id, name, make_model, length_ft, marina_id, dock_id, slip) values ($1, $2, $3, $4, $5, $6, $7)",
          [c.id, boatName || "Boat (name not known)", clip(r.make_model, 80), lengthRaw ? Math.min(999, Number(lengthRaw)) : null, marina?.id ?? null, dock?.id ?? null, slip],
        );
      }
      if (note) await t("insert into customer_notes (customer_id, body, created_by) values ($1, $2, $3)", [c.id, note, by]);
    });
    out.added++;
    out.outcomes.push({ row: rowNo, result: "added", name });
  }
  await audit(q, by, "import", "leads", null, { list: opts.listName, added: out.added, updated: out.updated, skipped: out.skipped });
  return out;
}
