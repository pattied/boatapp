import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, diffDays, startOfWeek, weekday, todayLA } from "../lib/dates";
import { inSeason, intervalAt, occurrences } from "../lib/schedule";

const plan = (over = {}) => ({
  anchor_date: "2026-11-07", interval_weeks: 2, off_interval_weeks: null as number | null,
  season_start: "", season_end: "", end_date: null as string | null, ...over,
});

test("date helpers", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(diffDays("2026-03-09", "2026-03-07"), 2);
  assert.equal(weekday("2026-11-07"), 6); // Saturday
  assert.equal(startOfWeek("2026-11-08"), "2026-11-02"); // Sunday belongs to the week starting Monday
  assert.equal(startOfWeek("2026-11-02"), "2026-11-02");
  // 11 pm Pacific on Nov 6 is already Nov 7 in UTC; the business day is still Nov 6.
  assert.equal(todayLA(new Date("2026-11-07T07:00:00Z")), "2026-11-06");
});

test("daylight saving does not shift visit dates", () => {
  // DST ends Nov 1 2026 and starts Mar 8 2026 in the US.
  const dates = occurrences(plan({ anchor_date: "2026-10-24", interval_weeks: 1 }), "2026-10-24", "2026-11-14");
  assert.deepEqual(dates, ["2026-10-24", "2026-10-31", "2026-11-07", "2026-11-14"]);
  assert.ok(dates.every((d) => weekday(d) === 6));
});

test("every two weeks from the anchor, inside the window only", () => {
  assert.deepEqual(occurrences(plan(), "2026-11-10", "2026-12-31"), ["2026-11-21", "2026-12-05", "2026-12-19"]);
});

test("end date stops visits", () => {
  assert.deepEqual(occurrences(plan({ end_date: "2026-11-30" }), "2026-11-01", "2026-12-31"), ["2026-11-07", "2026-11-21"]);
});

test("seasons, including a season that wraps the new year", () => {
  assert.equal(inSeason("2026-07-01", "04-01", "10-31"), true);
  assert.equal(inSeason("2026-11-15", "04-01", "10-31"), false);
  assert.equal(inSeason("2027-01-10", "11-01", "02-28"), true);
  assert.equal(inSeason("2026-06-10", "11-01", "02-28"), false);
  const p = plan({ season_start: "04-01", season_end: "10-31", off_interval_weeks: 4 });
  assert.equal(intervalAt(p, "2026-10-15"), 2);
  assert.equal(intervalAt(p, "2026-11-15"), 4);
});

test("seasonal plan switches cadence at the boundary and keeps the weekday", () => {
  const p = plan({ anchor_date: "2026-10-17", season_start: "04-01", season_end: "10-31", off_interval_weeks: 4 });
  const dates = occurrences(p, "2026-10-17", "2027-01-31");
  // Oct 31 is in season, so the next visit is 2 weeks later; from Nov 14 on, every 4 weeks.
  assert.deepEqual(dates, ["2026-10-17", "2026-10-31", "2026-11-14", "2026-12-12", "2027-01-09"]);
  assert.ok(dates.every((d) => weekday(d) === 6));
});

test("anchor years in the past still lands on the right cadence", () => {
  const dates = occurrences(plan({ anchor_date: "2020-01-04", interval_weeks: 3 }), "2026-11-01", "2026-11-30");
  for (const d of dates) assert.equal(diffDays(d, "2020-01-04") % 21, 0);
  assert.ok(dates.length >= 1);
});
