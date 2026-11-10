import { audit } from "./audit";
import { addDays, todayLA } from "./dates";
import { one, q, tx } from "./db";
import {
  COMPLETION_MESSAGES,
  ISSUE_CATEGORIES,
  JOB_SELECT,
  jobPhotos,
  locationText,
  ORDER_WALKING,
  PARTIAL_REASONS,
  SKIP_REASONS,
  type JobRow,
} from "./repo";
import { ensureGenerated } from "./schedule";
import { srcFor } from "./storage";

export type CrewPhoto = { clientId: string | null; kind: string; slot: string; src: string };

export type CrewJob = {
  id: string;
  publicId: string;
  date: string;
  status: JobRow["status"];
  boatName: string;
  boatDetails: string;
  boatPhoto: string | null;
  customerFirst: string;
  location: string;
  gateCode: string;
  accessNotes: string;
  liveaboard: boolean;
  knockFirst: boolean;
  service: string;
  shotList: string[];
  notes: string;
  startedAt: string | null;
  completedAt: string | null;
  completionMessage: string;
  skipReason: string;
  photos: CrewPhoto[];
};

export type Snapshot = {
  tech: { id: string; name: string; crewId: string | null; crewName: string | null };
  today: string;
  tomorrow: string;
  jobs: CrewJob[];
  lists: { completion: string[]; skip: string[]; partial: string[]; issue: string[] };
  managerPhone: string;
  serverTime: string;
};

// Everything a technician's phone needs for today and tomorrow, so it can work offline.
export async function buildSnapshot(techId: string): Promise<Snapshot | null> {
  const tech = await one<{ id: string; name: string; crew_id: string | null; crew_name: string | null; active: boolean }>(
    "select t.id, t.name, t.crew_id, c.name as crew_name, t.active from technicians t left join crews c on c.id = t.crew_id where t.id = $1",
    [techId],
  );
  if (!tech || !tech.active) return null;
  await ensureGenerated(q);
  const today = todayLA();
  const tomorrow = addDays(today, 1);
  const rows = tech.crew_id
    ? await q<JobRow>(
        `${JOB_SELECT} where j.crew_id = $1 and j.scheduled_date between $2 and $3 and j.status <> 'cancelled' ${ORDER_WALKING}`,
        [tech.crew_id, today, tomorrow],
      )
    : [];
  const photos = await jobPhotos(rows.map((r) => r.id));
  const boatIds = [...new Set(rows.map((r) => r.boat_id))];
  const refs = boatIds.length
    ? await q<{ boat_id: string; pathname: string }>(
        `select distinct on (j.boat_id) j.boat_id, p.pathname from photos p join jobs j on j.id = p.job_id
         where j.boat_id = any($1::uuid[]) and p.kind = 'after' and not p.replaced and j.scheduled_date < $2
         order by j.boat_id, p.received_at desc`,
        [boatIds, today],
      )
    : [];
  return {
    tech: { id: tech.id, name: tech.name, crewId: tech.crew_id, crewName: tech.crew_name },
    today,
    tomorrow,
    jobs: rows.map((r) => ({
      id: r.id,
      publicId: r.public_id,
      date: r.scheduled_date,
      status: r.status,
      boatName: r.boat_name,
      boatDetails: [r.make_model, r.hull_color ? `${r.hull_color} hull` : ""].filter(Boolean).join(" · "),
      boatPhoto: refs.find((x) => x.boat_id === r.boat_id) ? srcFor(refs.find((x) => x.boat_id === r.boat_id)!.pathname) : null,
      customerFirst: r.customer_name.split(" ")[0],
      location: locationText(r),
      gateCode: r.gate_code,
      accessNotes: r.access_notes,
      liveaboard: r.liveaboard,
      knockFirst: r.knock_first,
      service: r.service_name ?? "Cleaning",
      shotList: r.shot_list.length ? r.shot_list : ["Bow", "Stern", "Cockpit", "Port side"],
      notes: r.manager_notes,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      completionMessage: r.completion_message,
      skipReason: r.skip_reason,
      photos: photos
        .filter((p) => p.job_id === r.id)
        .map((p) => ({ clientId: p.client_id, kind: p.kind, slot: p.slot, src: p.src })),
    })),
    lists: { completion: COMPLETION_MESSAGES, skip: SKIP_REASONS, partial: PARTIAL_REASONS, issue: ISSUE_CATEGORIES },
    managerPhone: process.env.MANAGER_PHONE ?? "",
    serverTime: new Date().toISOString(),
  };
}

export type CrewEvent = {
  clientId: string;
  jobId: string;
  type: "start" | "complete" | "skip" | "flag";
  at: string;
  data?: Record<string, unknown>;
};

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Applies one event from a technician's phone. Safe to receive twice: the client id is the key.
// Schedule fields belong to the manager; work facts belong to the technician. If work arrives for a
// visit the manager cancelled or moved away, the work still counts and the visit is flagged for review.
export async function applyEvent(tech: { techId: string; name: string }, ev: CrewEvent): Promise<"applied" | "duplicate" | "missing"> {
  const at = Number.isNaN(Date.parse(ev.at)) ? new Date().toISOString() : new Date(ev.at).toISOString();
  return tx(async (t) => {
    const job = (await t<{ id: string; status: string; boat_id: string }>("select id, status, boat_id from jobs where id = $1 for update", [ev.jobId]))[0];
    if (!job) return "missing";
    const inserted = await t(
      "insert into crew_events (client_id, job_id, type, at, by_name) values ($1, $2, $3, $4, $5) on conflict do nothing returning client_id",
      [ev.clientId, ev.jobId, ev.type, at, tech.name],
    );
    if (!inserted.length) return "duplicate";
    const conflict = job.status === "cancelled";
    const d = ev.data ?? {};
    if (ev.type === "start") {
      await t(
        `update jobs set status = case when status in ('scheduled', 'needs_reschedule', 'cancelled') then 'in_progress' else status end,
           started_at = coalesce(started_at, $2), started_by = case when started_by = '' then $3 else started_by end,
           needs_review = needs_review or $4, manager_notes = case when $5 <> '' then trim(manager_notes || ' Started without all before photos: ' || $5) else manager_notes end,
           updated_at = now() where id = $1`,
        [ev.jobId, at, tech.name, conflict, str(d.missingReason, 120)],
      );
    } else if (ev.type === "complete") {
      const partial = d.partial === true;
      await t(
        `update jobs set status = $2, completed_at = $3, completed_by = $4, completion_message = $5, partial_reason = $6,
           started_at = coalesce(started_at, $3), started_by = case when started_by = '' then $4 else started_by end,
           needs_review = needs_review or $7, updated_at = now() where id = $1`,
        [ev.jobId, partial ? "partial" : "completed", at, tech.name, str(d.message, 200), partial ? str(d.reason, 120) : "", conflict],
      );
    } else if (ev.type === "skip") {
      await t(
        `update jobs set status = 'skipped', skip_reason = $2, needs_review = needs_review or $3, updated_at = now()
         where id = $1 and status not in ('completed', 'partial')`,
        [ev.jobId, str(d.reason, 120) || "Skipped", conflict],
      );
    } else if (ev.type === "flag") {
      const category = str(d.category, 80) || "Other";
      const internal = /incident/i.test(category) || d.internal === true;
      await t(
        `insert into issues (boat_id, job_id, photo_client_id, category, severity, found, visibility, note, reported_by, client_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (client_id) do nothing`,
        [
          job.boat_id,
          ev.jobId,
          str(d.photoClientId, 80) || null,
          category,
          d.severity === "urgent" ? "urgent" : "normal",
          d.found === "after" ? "after" : "before",
          internal ? "internal" : "portal",
          str(d.note, 1000),
          tech.name,
          ev.clientId,
        ],
      );
    }
    await audit(t, `tech:${tech.name}`, ev.type, "job", ev.jobId, { at, ...(ev.type === "skip" ? { reason: d.reason } : {}) });
    return "applied";
  });
}

// Who may post work to a job.
// "own": the job belongs to the technician's crew.
// "review": another crew's job from the last two days through tomorrow. This happens when a manager reassigns a
//   visit while the technician is working offline, so the work is kept and the visit is marked for manager review.
// "deny": any other job. "inactive": the technician was removed or deactivated.
export async function crewAccess(techId: string, jobId: string): Promise<"own" | "review" | "deny" | "inactive" | "missing"> {
  const tech = await one<{ crew_id: string | null; active: boolean }>("select crew_id, active from technicians where id = $1", [techId]);
  if (!tech || !tech.active) return "inactive";
  const job = await one<{ crew_id: string | null; scheduled_date: string }>("select crew_id, scheduled_date from jobs where id = $1", [jobId]);
  if (!job) return "missing";
  if (tech.crew_id && job.crew_id === tech.crew_id) return "own";
  const today = todayLA();
  if (job.scheduled_date >= addDays(today, -2) && job.scheduled_date <= addDays(today, 1)) return "review";
  return "deny";
}

export async function markOtherCrewWork(jobId: string, techName: string) {
  await q(
    `update jobs set needs_review = true,
       manager_notes = case when manager_notes like '%from another crew%' then manager_notes
         else trim(manager_notes || ' Work posted by ' || $2 || ' from another crew.') end
     where id = $1`,
    [jobId, techName],
  );
}
