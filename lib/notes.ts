import { q } from "./db";

// Customer notes: things a customer tells us that matter for service ("racing on the 21st", "family in town").
// A note can carry a "boat must be clean by" date. Open notes with a date are checked against the schedule.

export type Note = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_status: string;
  boat_id: string | null;
  boat_name: string | null;
  body: string;
  needed_by: string | null;
  created_by: string;
  created_at: string;
  done_at: string | null;
  done_by: string;
  // The last visit on the calendar from today through the needed-by date, if any.
  covering_visit: string | null;
  covering_job_id: string | null;
};

const SELECT = `
  select n.id, n.customer_id, c.name as customer_name, c.status as customer_status, n.boat_id, b.name as boat_name, n.body, n.needed_by,
    n.created_by, n.created_at, n.done_at, n.done_by, v.scheduled_date as covering_visit, v.id as covering_job_id
  from customer_notes n
  join customers c on c.id = n.customer_id
  left join boats b on b.id = n.boat_id
  left join lateral (
    select j.id, j.scheduled_date from jobs j join boats jb on jb.id = j.boat_id
    where n.needed_by is not null and jb.customer_id = n.customer_id and (n.boat_id is null or j.boat_id = n.boat_id)
      and j.scheduled_date <= n.needed_by and j.scheduled_date >= (n.created_at at time zone 'America/Los_Angeles')::date
      and j.status in ('scheduled', 'in_progress', 'completed', 'partial')
    order by j.scheduled_date desc limit 1
  ) v on true`;

export const notesFor = (customerId: string) =>
  q<Note>(`${SELECT} where n.customer_id = $1 order by n.done_at is not null, n.needed_by nulls last, n.created_at desc limit 100`, [customerId]);

// Open notes whose date falls within the next `days` days, or has passed.
export const notesDue = (today: string, days: number) =>
  q<Note>(
    `${SELECT} where n.done_at is null and n.needed_by is not null and n.needed_by <= ($1::date + $2::int) order by n.needed_by, n.created_at limit 100`,
    [today, days],
  );

export type Coverage = { tone: "good" | "warn" | "bad"; text: string };

// Plain-language answer to "will the boat be clean in time?"
export function coverage(n: Note, today: string, fmt: (d: string) => string): Coverage | null {
  if (!n.needed_by || n.done_at) return null;
  if (n.customer_status === "prospect") return { tone: "warn", text: `Wanted by ${fmt(n.needed_by)}. Not a customer yet.` };
  if (n.covering_visit) {
    const gap = Math.round((Date.parse(n.needed_by) - Date.parse(n.covering_visit)) / 86400000);
    if (gap > 7) return { tone: "warn", text: `Last cleaning before then is ${fmt(n.covering_visit)}, ${gap} days ahead. Consider one closer to ${fmt(n.needed_by)}.` };
    return { tone: "good", text: `Cleaning on the calendar for ${fmt(n.covering_visit)}.` };
  }
  if (n.needed_by < today) return { tone: "bad", text: `Was needed by ${fmt(n.needed_by)} and no cleaning happened in time.` };
  return { tone: "bad", text: `No cleaning is scheduled before ${fmt(n.needed_by)}.` };
}
