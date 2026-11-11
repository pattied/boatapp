import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
process.env.PGLITE_DIR = mkdtempSync(path.join(tmpdir(), "ccimp-"));
import { q, one } from "../lib/db";
import { importLeads } from "../lib/import";
import { newPublicId } from "../lib/ids";
import { canSend, RECIPIENT_COLS, type Recipient } from "../lib/messaging/compliance";

test("list import: adds, splits names, skips with reasons, never grants text permission", async () => {
  const [{ id: marina }] = await q<{ id: string }>("insert into marinas (name) values ('Clipper Yacht Harbor') returning id");
  await q("insert into docks (marina_id, name) values ($1, 'C')", [marina]);
  await q("insert into customers (name, first_name, last_name, phone, status, portal_token) values ('Existing Customer', 'Existing', 'Customer', '(415) 555-0101', 'active', $1)", [newPublicId()]);
  await q("insert into customers (name, first_name, last_name, email, status, portal_token) values ('Noah Stop', 'Noah', 'Stop', 'noah@example.com', 'dnc', $1)", [newPublicId()]);
  await q("insert into customers (name, first_name, last_name, phone, status, portal_token) values ('Lee Lead', 'Lee', 'Lead', '4155550103', 'prospect', $1)", [newPublicId()]);
  const rows: Record<string, string>[] = [
    { first_name: "Dana", last_name: "Whitfield", phone: "415-555-0111", email: "DANA@Example.com", boat_name: "Sea Breeze", marina: "clipper yacht harbor", dock: "Dock C", slip: "C-14", city: "sausalito", state: "ca" },
    { full_name: "Ortega, Luis", email: "luis@example.com", marina: "Unknown Marina", boat_name: "Marlin" },
    { full_name: "Mary Ann Smith", address1: "1 Bridgeway", postal_code: "94965" },
    { first_name: "Bad", phone: "555-12" },
    { first_name: "Nobody" },
    { first_name: "Dup", email: "dana@example.com" },
    { first_name: "Cust", phone: "1 (415) 555-0101" },
    { first_name: "Stopper", email: "noah@example.com" },
    { first_name: "Lee", phone: "415.555.0103", email: "lee@example.com" },
    { boat_name: "Kestrel", email: "kestrel-owner@example.com" },
  ];
  const r = await importLeads(rows, { listName: "Boat show", stage: "prospect", duplicates: "fill", firstRow: 2 }, "Robin Vega");
  assert.deepEqual([r.added, r.updated, r.skipped], [4, 1, 5]);
  const why = Object.fromEntries(r.outcomes.filter((o) => o.result === "skipped").map((o) => [o.row, o.reason ?? ""]));
  assert.match(why[5], /not a valid US number/);
  assert.match(why[6], /No phone, email or mailing address/);
  assert.match(why[7], /earlier row/);
  assert.match(why[8], /already a customer/);
  assert.match(why[9], /do-not-contact/);
  const dana = await one<Recipient & { first_name: string; last_name: string; list_name: string; state: string }>(`select ${RECIPIENT_COLS}, first_name, last_name, list_name, state from customers where email = 'dana@example.com'`);
  assert.deepEqual([dana!.first_name, dana!.last_name, dana!.status, dana!.list_name, dana!.state, dana!.sms_consent], ["Dana", "Whitfield", "prospect", "Boat show", "CA", false]);
  assert.equal((await canSend(dana!, "sms", "marketing")).ok, false, "an imported person cannot be texted");
  const boat = await one<{ marina_id: string; dock: string | null; slip: string }>("select b.marina_id, d.name as dock, b.slip from boats b left join docks d on d.id = b.dock_id where b.name = 'Sea Breeze'");
  assert.deepEqual([boat!.marina_id, boat!.dock, boat!.slip], [marina, "C", "C-14"]);
  const luis = await one<{ id: string; first_name: string; last_name: string }>("select id, first_name, last_name from customers where email = 'luis@example.com'");
  assert.deepEqual([luis!.first_name, luis!.last_name], ["Luis", "Ortega"]);
  assert.match((await one<{ body: string }>("select body from customer_notes where customer_id = $1", [luis!.id]))!.body, /Marina on the list: Unknown Marina/);
  const mary = await one<{ first_name: string; last_name: string }>("select first_name, last_name from customers where address1 = '1 Bridgeway'");
  assert.deepEqual([mary!.first_name, mary!.last_name], ["Mary", "Ann Smith"]);
  const lee = await one<{ email: string; phone: string }>("select email, phone from customers where name = 'Lee Lead'");
  assert.deepEqual([lee!.email, lee!.phone], ["lee@example.com", "4155550103"], "blank email filled, existing phone kept");
  assert.equal((await one<{ name: string }>("select name from customers where email = 'kestrel-owner@example.com'"))!.name, "Owner of Kestrel");
  // Importing the same file again adds nobody.
  const again = await importLeads(rows, { listName: "Boat show", stage: "prospect", duplicates: "skip", firstRow: 2 }, "Robin Vega");
  assert.equal(again.added, 0);
});

test("do not contact blocks every channel, typed messages included", async () => {
  const [{ id }] = await q<{ id: string }>("insert into customers (name, phone, email, status, sms_consent, promo_sms_consent, portal_token) values ('Pat', '4155550199', 'pat@example.com', 'dnc', true, true, $1) returning id", [newPublicId()]);
  const c = (await one<Recipient>(`select ${RECIPIENT_COLS} from customers where id = $1`, [id]))!;
  for (const ch of ["sms", "email"] as const) for (const p of ["service", "marketing"] as const) assert.equal((await canSend(c, ch, p, { manual: true, postalAddress: "x" })).ok, false);
});
