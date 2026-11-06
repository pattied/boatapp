import { q, one } from "./db";
import { WALKING_ORDER } from "./schedule";
import { srcFor } from "./storage";

// Shared read queries used by the manager, technician and customer screens.

export type JobStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "partial"
  | "skipped"
  | "cancelled"
  | "needs_reschedule";

export type JobRow = {
  id: string;
  public_id: string;
  scheduled_date: string;
  status: JobStatus;
  origin: string;
  is_override: boolean;
  plan_id: string | null;
  crew_id: string | null;
  crew_name: string | null;
  service_id: string | null;
  service_name: string | null;
  shot_list: string[];
  boat_id: string;
  boat_name: string;
  make_model: string;
  hull_color: string;
  customer_id: string;
  customer_name: string;
  marina_name: string | null;
  gate_name: string | null;
  gate_code: string;
  dock_name: string | null;
  slip: string;
  berth_type: string;
  access_notes: string;
  liveaboard: boolean;
  knock_first: boolean;
  started_at: string | null;
  completed_at: string | null;
  started_by: string;
  completed_by: string;
  completion_message: string;
  partial_reason: string;
  skip_reason: string;
  cancel_reason: string;
  manager_notes: string;
  needs_review: boolean;
  rescheduled_from: string | null;
  before_count: number;
  after_count: number;
  issue_count: number;
};

export const JOB_SELECT = `
  select j.id, j.public_id, j.scheduled_date, j.status, j.origin, j.is_override, j.plan_id, j.crew_id,
         cr.name as crew_name, j.service_id, s.name as service_name, coalesce(s.shot_list, '{}') as shot_list,
         b.id as boat_id, b.name as boat_name, b.make_model, b.hull_color, c.id as customer_id, c.name as customer_name,
         m.name as marina_name, g.name as gate_name,
         coalesce(nullif(b.gate_code_override, ''), g.code, '') as gate_code,
         d.name as dock_name, b.slip, b.berth_type, b.access_notes, b.liveaboard, b.knock_first,
         j.started_at, j.completed_at, j.started_by, j.completed_by, j.completion_message, j.partial_reason,
         j.skip_reason, j.cancel_reason, j.manager_notes, j.needs_review, j.rescheduled_from,
         (select count(*)::int from photos p where p.job_id = j.id and p.kind = 'before' and not p.replaced) as before_count,
         (select count(*)::int from photos p where p.job_id = j.id and p.kind = 'after' and not p.replaced) as after_count,
         (select count(*)::int from issues i where i.job_id = j.id and i.status in ('open', 'quoted')) as issue_count
  from jobs j
  join boats b on b.id = j.boat_id
  join customers c on c.id = b.customer_id
  left join marinas m on m.id = b.marina_id
  left join docks d on d.id = b.dock_id
  left join gates g on g.id = coalesce(b.gate_id, d.gate_id)
  left join crews cr on cr.id = j.crew_id
  left join services s on s.id = j.service_id`;

export const ORDER_WALKING = `order by ${WALKING_ORDER}`;

export async function getJobById(id: string) {
  return one<JobRow>(`${JOB_SELECT} where j.id = $1`, [id]);
}

export async function getJobByPublicId(publicId: string) {
  return one<JobRow>(`${JOB_SELECT} where j.public_id = $1`, [publicId]);
}

export type PhotoRow = {
  id: string;
  job_id: string;
  kind: string;
  slot: string;
  pathname: string;
  client_id: string | null;
  taken_at: string | null;
  received_at: string;
  taken_by: string;
  src: string;
};

export async function jobPhotos(jobIds: string[], includeReplaced = false): Promise<PhotoRow[]> {
  if (!jobIds.length) return [];
  const rows = await q<Omit<PhotoRow, "src">>(
    `select id, job_id, kind, slot, pathname, client_id, taken_at, received_at, taken_by from photos
     where job_id = any($1::uuid[]) ${includeReplaced ? "" : "and not replaced"}
     order by received_at`,
    [jobIds],
  );
  return rows.map((r) => ({ ...r, src: srcFor(r.pathname) }));
}

export function locationText(j: {
  marina_name: string | null;
  gate_name?: string | null;
  dock_name: string | null;
  slip: string;
  berth_type: string;
}) {
  const berth = j.berth_type === "mooring" ? "Mooring" : j.berth_type === "dry" ? "Dry storage" : "";
  return [j.marina_name, j.gate_name, j.dock_name ? `Dock ${j.dock_name.replace(/^dock\s*/i, "")}` : null, j.slip ? `Slip ${j.slip}` : null, berth || null]
    .filter(Boolean)
    .join(" · ");
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Done",
  partial: "Partial",
  skipped: "Skipped",
  cancelled: "Cancelled",
  needs_reschedule: "Needs reschedule",
};

export const STATUS_TONE: Record<JobStatus, string> = {
  scheduled: "idle",
  in_progress: "warn",
  completed: "good",
  partial: "warn",
  skipped: "bad",
  cancelled: "idle",
  needs_reschedule: "bad",
};

// Lookup lists for forms.
export type Option = { id: string; name: string };
export type MarinaOpt = Option;
export type GateOpt = Option & { marina_id: string; code: string };
export type DockOpt = Option & { marina_id: string; gate_id: string | null };
export type ServiceOpt = Option & { is_add_on: boolean; price_text: string; description: string; shot_list: string[] };
export type CrewOpt = Option & { active: boolean };

export async function lookups() {
  const [marinas, gates, docks, services, crews] = await Promise.all([
    q<MarinaOpt>("select id, name from marinas order by name"),
    q<GateOpt>("select id, name, marina_id, code from gates order by name"),
    q<DockOpt>("select id, name, marina_id, gate_id from docks order by name"),
    q<ServiceOpt>(
      "select id, name, is_add_on, price_text, description, shot_list from services where active order by sort, name",
    ),
    q<CrewOpt>("select id, name, active from crews order by active desc, name"),
  ]);
  return { marinas, gates, docks, services, crews };
}

export type Lookups = Awaited<ReturnType<typeof lookups>>;

export const BERTH_TYPES = [
  ["slip", "Slip"],
  ["end_tie", "End tie"],
  ["side_tie", "Side tie"],
  ["mooring", "Mooring"],
  ["dry", "Dry storage"],
] as const;

export const SKIP_REASONS = [
  "Boat not in slip",
  "Boat covered or locked",
  "Owner aboard or declined",
  "Liveaboard asked us to come later",
  "Weather or unsafe",
  "Gate or access failed",
  "Ran out of time",
];

export const PARTIAL_REASONS = ["Ran out of time", "Weather turned", "Access to part of the boat blocked", "Other"];

export const ISSUE_CATEGORIES = [
  "Broken or loose rail or stanchion",
  "Gelcoat or fiberglass crack",
  "Taking on water or bilge running",
  "Lines or fenders worn",
  "Canvas or cushion damage",
  "Other",
];

export const COMPLETION_MESSAGES = [
  "Your boat is clean and ready to go!",
  "Cleaned today. Fresh wax applied.",
  "Cleaned today. We noted an item for your review.",
];

// Crews must be able to find every boat. For a boat in a slip: the dock is required when the marina has docks,
// and a gate (on the boat, on its dock, or a boat-only code) is required when the marina has gates.
export async function berthProblem(b: {
  marina_id: string | null;
  dock_id: string | null;
  gate_id: string | null;
  slip: string;
  berth_type: string;
  gate_code_override?: string;
}): Promise<string | null> {
  if (!b.marina_id) return "Choose the marina.";
  const afloat = !["mooring", "dry"].includes(b.berth_type);
  if (afloat && !b.slip) return "Enter the slip.";
  const m = await one<{ docks: number; gates: number }>(
    `select (select count(*)::int from docks where marina_id = $1) as docks,
            (select count(*)::int from gates where marina_id = $1) as gates`,
    [b.marina_id],
  );
  if (!m) return "Choose the marina.";
  let dockGate: string | null = null;
  if (b.dock_id) {
    const d = await one<{ marina_id: string; gate_id: string | null }>("select marina_id, gate_id from docks where id = $1", [b.dock_id]);
    if (d?.marina_id !== b.marina_id) return "That dock is not at the chosen marina.";
    dockGate = d.gate_id;
  }
  if (b.gate_id) {
    const g = await one<{ marina_id: string }>("select marina_id from gates where id = $1", [b.gate_id]);
    if (g?.marina_id !== b.marina_id) return "That gate is not at the chosen marina.";
  }
  if (afloat && m.docks > 0 && !b.dock_id) return "Choose the dock. Crews need the marina, dock and slip to find the boat.";
  if (afloat && m.gates > 0 && !b.gate_id && !dockGate && !b.gate_code_override)
    return "Choose the gate (or set the dock's gate on the marina page) so crews get the gate code.";
  return null;
}
