import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
process.env.PGLITE_DIR = mkdtempSync(path.join(tmpdir(), "ccdb-"));
import { q, tx, one } from "../lib/db";
import { generateJobs, regeneratePlan, pauseBoat, resumeBoat } from "../lib/schedule";
import { addDays, todayLA, weekday } from "../lib/dates";
import { newPublicId } from "../lib/ids";

async function setup() {
  const [{ id: marina }] = await q<{ id: string }>("insert into marinas (name) values ('Clipper') returning id");
  const [{ id: cust }] = await q<{ id: string }>("insert into customers (name, portal_token) values ('Dana', $1) returning id", [newPublicId()]);
  const [{ id: boat }] = await q<{ id: string }>("insert into boats (customer_id, name, marina_id, slip) values ($1, 'Blue Heron', $2, 'A-22') returning id", [cust, marina]);
  const [{ id: crew }] = await q<{ id: string }>("insert into crews (name) values ('Crew 1') returning id");
  const [{ id: service }] = await q<{ id: string }>("select id from services order by sort limit 1");
  const anchor = addDays(todayLA(), 1);
  const [{ id: plan }] = await q<{ id: string }>(
    "insert into plans (boat_id, service_id, crew_id, anchor_date, interval_weeks) values ($1, $2, $3, $4, 2) returning id",
    [boat, service, crew, anchor]);
  return { boat, plan, crew, anchor };
}

test("schema migrates and seeds services", async () => {
  const rows = await q<{ name: string }>("select name from services");
  assert.ok(rows.length >= 5);
});

test("generation, edits, pause and resume", async () => {
  const { boat, plan, anchor } = await setup();
  const created = await generateJobs(q);
  assert.equal(created, 4); // 56-day horizon, every 2 weeks from tomorrow
  assert.equal(await generateJobs(q), 0, "second run creates nothing");

  // Move one visit (this visit only): regeneration must not recreate it on the old date.
  const first = await one<{ id: string; scheduled_date: string }>("select id, scheduled_date from jobs where plan_id = $1 order by scheduled_date limit 1", [plan]);
  await q("update jobs set scheduled_date = $2, is_override = true where id = $1", [first!.id, addDays(first!.scheduled_date, 1)]);
  await generateJobs(q);
  const count = await one<{ n: number }>("select count(*)::int n from jobs where plan_id = $1", [plan]);
  assert.equal(count!.n, 4, "moved visit is not duplicated");

  // All future visits: change to weekly. Edited visit is kept, untouched ones rebuilt.
  await q("update plans set interval_weeks = 1 where id = $1", [plan]);
  await regeneratePlan(q, plan, todayLA());
  const after = await q<{ scheduled_date: string; is_override: boolean }>("select scheduled_date, is_override from jobs where plan_id = $1 order by scheduled_date", [plan]);
  assert.ok(after.some((j) => j.is_override), "override kept");
  assert.equal(after.filter((j) => !j.is_override).length, 7, "weekly visits rebuilt (8 in horizon minus the moved one)");
  assert.ok(after.filter((j) => !j.is_override).every((j) => weekday(j.scheduled_date) === weekday(anchor)));

  // Pause cancels scheduled visits; resume brings them back.
  await pauseBoat(q, boat, null, "Haul-out");
  const live = await one<{ n: number }>("select count(*)::int n from jobs where boat_id = $1 and status = 'scheduled'", [boat]);
  assert.equal(live!.n, 0);
  assert.equal(await generateJobs(q), 0, "paused boat gets no new visits");
  await resumeBoat(q, boat);
  const back = await one<{ n: number }>("select count(*)::int n from jobs where boat_id = $1 and status = 'scheduled'", [boat]);
  assert.equal(back!.n, 8, "all 8 weekly visits in the horizon return; the moved one goes back to its regular date");
});

test("transactions roll back", async () => {
  await assert.rejects(tx(async (t) => {
    await t("insert into crews (name) values ('Ghost')");
    throw new Error("boom");
  }));
  const ghost = await one("select 1 from crews where name = 'Ghost'");
  assert.equal(ghost, null);
});

test("existing single-field names split into first and last", async () => {
  const { ONE_TIME } = await import("../lib/schema");
  const { newPublicId } = await import("../lib/ids");
  const names = ["Cher", "Mary Ann Smith", "  Luis   Ortega ", "Jean-Luc de la Cruz"];
  const ids: string[] = [];
  for (const n of names) ids.push((await q<{ id: string }>("insert into customers (name, portal_token) values ($1, $2) returning id", [n, newPublicId()]))[0].id);
  const already = (await q<{ id: string }>("insert into customers (name, first_name, last_name, portal_token) values ('Ana Maria Diaz', 'Ana Maria', 'Diaz', $1) returning id", [newPublicId()]))[0].id;
  for (const stmt of ONE_TIME.find((m) => m.key === "split_names")!.statements) await q(stmt);
  const rows = await q<{ first_name: string; last_name: string }>("select first_name, last_name from customers where id = any($1::uuid[]) order by array_position($1::uuid[], id)", [ids]);
  assert.deepEqual(rows.map((r) => [r.first_name, r.last_name]), [["Cher", ""], ["Mary", "Ann Smith"], ["Luis", "Ortega"], ["Jean-Luc", "de la Cruz"]]);
  // A name already entered in two parts is left alone.
  const kept = await q<{ first_name: string; last_name: string }>("select first_name, last_name from customers where id = $1", [already]);
  assert.deepEqual([kept[0].first_name, kept[0].last_name], ["Ana Maria", "Diaz"]);
});
