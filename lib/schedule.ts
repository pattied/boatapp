import { addDays, todayLA } from "./dates";
import type { Q } from "./db";
import { newPublicId } from "./ids";

// How far ahead recurring plans are turned into concrete jobs.
export const HORIZON_DAYS = 56;

export type PlanRule = {
  anchor_date: string;
  interval_weeks: number;
  off_interval_weeks: number | null;
  season_start: string; // "MM-DD", empty when the plan has one interval all year
  season_end: string;
  end_date: string | null;
};

// True when the date's month-day falls inside the season. Seasons may wrap the new year.
export function inSeason(date: string, start: string, end: string): boolean {
  if (!start || !end) return true;
  const md = date.slice(5);
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}

export function intervalAt(plan: PlanRule, date: string): number {
  if (!plan.off_interval_weeks || !plan.season_start || !plan.season_end) return plan.interval_weeks;
  return inSeason(date, plan.season_start, plan.season_end) ? plan.interval_weeks : plan.off_interval_weeks;
}

// Visit dates from the anchor forward: each next visit is the last one plus the interval in effect.
export function occurrences(plan: PlanRule, from: string, to: string): string[] {
  const out: string[] = [];
  let d = plan.anchor_date;
  for (let guard = 0; d <= to && guard < 3000; guard++) {
    if (d >= from && (!plan.end_date || d <= plan.end_date)) out.push(d);
    d = addDays(d, 7 * intervalAt(plan, d));
  }
  return out;
}

type PlanRow = PlanRule & {
  id: string;
  boat_id: string;
  service_id: string | null;
  crew_id: string | null;
  boat_status: string;
  paused_until: string | null;
};

const PLAN_SELECT = `
  select p.id, p.boat_id, p.service_id, p.crew_id, p.anchor_date, p.interval_weeks, p.off_interval_weeks,
         p.season_start, p.season_end, p.end_date, b.status as boat_status, b.paused_until
  from plans p
  join boats b on b.id = p.boat_id
  join customers c on c.id = b.customer_id
  where p.active and b.status <> 'sold' and c.status = 'active'`;

function pausedOn(plan: PlanRow, date: string) {
  return plan.boat_status === "paused" && (!plan.paused_until || date <= plan.paused_until);
}

// Creates any missing jobs for the given plans. Existing occurrences (moved, edited, cancelled)
// are never recreated, because jobs are unique on (plan, occurrence date).
export async function generateJobs(q: Q, opts: { planIds?: string[]; boatId?: string; from?: string } = {}) {
  const today = todayLA();
  const from = opts.from && opts.from > today ? opts.from : today;
  const to = addDays(today, HORIZON_DAYS);
  let sql = PLAN_SELECT;
  const params: unknown[] = [];
  if (opts.planIds) {
    params.push(opts.planIds);
    sql += ` and p.id = any($${params.length}::uuid[])`;
  }
  if (opts.boatId) {
    params.push(opts.boatId);
    sql += ` and p.boat_id = $${params.length}`;
  }
  const plans = await q<PlanRow>(sql, params);
  let created = 0;
  for (const plan of plans) {
    for (const date of occurrences(plan, from, to)) {
      if (pausedOn(plan, date)) continue;
      const rows = await q(
        `insert into jobs (public_id, boat_id, plan_id, occurrence_date, scheduled_date, service_id, crew_id, origin)
         values ($1, $2, $3, $4, $4, $5, $6, 'plan')
         on conflict (plan_id, occurrence_date) do nothing
         returning id`,
        [newPublicId(), plan.boat_id, plan.id, date, plan.service_id, plan.crew_id],
      );
      created += rows.length;
    }
  }
  return created;
}

// Runs at most once per day per database, triggered by the first page load of the day.
export async function ensureGenerated(q: Q) {
  const today = todayLA();
  const row = (await q<{ value: string }>("select value from app_meta where key = 'generated_on'"))[0];
  if (row?.value === today) return;
  await endExpiredPauses(q);
  await generateJobs(q);
  await q(
    `insert into app_meta (key, value) values ('generated_on', $1)
     on conflict (key) do update set value = excluded.value`,
    [today],
  );
}

// Future jobs that nobody has touched: safe to delete and regenerate after a plan change.
const UNTOUCHED = `origin = 'plan' and not is_override and status = 'scheduled' and started_at is null
  and not exists (select 1 from photos ph where ph.job_id = jobs.id)`;

// "This and all future visits": drop untouched future jobs from the plan and rebuild them.
export async function regeneratePlan(q: Q, planId: string, fromDate: string) {
  const today = todayLA();
  const from = fromDate > today ? fromDate : today;
  await q(`delete from jobs where plan_id = $1 and scheduled_date >= $2 and ${UNTOUCHED}`, [planId, from]);
  return generateJobs(q, { planIds: [planId], from });
}

export async function pauseBoat(q: Q, boatId: string, until: string | null, reason: string) {
  const today = todayLA();
  await q(`update boats set status = 'paused', paused_until = $2, pause_reason = $3 where id = $1`, [
    boatId,
    until,
    reason,
  ]);
  await q(
    `update jobs set status = 'cancelled', cancel_reason = 'paused', updated_at = now()
     where boat_id = $1 and status = 'scheduled' and scheduled_date >= $2
       and ($3::date is null or scheduled_date <= $3::date)`,
    [boatId, today, until],
  );
}

export async function resumeBoat(q: Q, boatId: string) {
  const today = todayLA();
  await q(`update boats set status = 'active', paused_until = null, pause_reason = '' where id = $1`, [boatId]);
  // Visits cancelled by the pause come back if they are still ahead.
  await q(
    `delete from jobs where boat_id = $1 and status = 'cancelled' and cancel_reason = 'paused'
       and scheduled_date >= $2 and origin = 'plan' and started_at is null`,
    [boatId, today],
  );
  return generateJobs(q, { boatId });
}

// Boats whose pause has ended become active again.
export async function endExpiredPauses(q: Q) {
  const today = todayLA();
  const boats = await q<{ id: string }>(
    `select id from boats where status = 'paused' and paused_until is not null and paused_until < $1`,
    [today],
  );
  for (const b of boats) await resumeBoat(q, b.id);
}

// Natural walking order: marina, gate, dock, then slip with numbers compared as numbers.
export const WALKING_ORDER = `coalesce(j.route_order, 100000), m.name nulls last, g.name nulls last, d.name nulls last,
  regexp_replace(b.slip, '[0-9]+', '', 'g'), coalesce(nullif(regexp_replace(b.slip, '[^0-9]', '', 'g'), '')::bigint, 0), b.name`;
