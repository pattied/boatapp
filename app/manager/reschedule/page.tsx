import Link from "next/link";
import { rescheduleJob } from "../actions";
import { Empty, JobStatusBadge, Notice, PageHead } from "@/components/ui";
import { addDays, fmtDay, todayLA } from "@/lib/dates";
import { q } from "@/lib/db";
import { JOB_SELECT, locationText, lookups, type JobRow } from "@/lib/repo";

type SP = Promise<{ ok?: string; error?: string }>;

// Visits that need a new date: sent here by a manager, or skipped by a technician.
export default async function Reschedule({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const today = todayLA();
  const [jobs, { crews }] = await Promise.all([
    q<JobRow>(
      `${JOB_SELECT} where j.status = 'needs_reschedule'
         or (j.status = 'skipped' and j.manager_notes not like '%Rescheduled to%' and j.scheduled_date >= $1)
       order by j.scheduled_date`,
      [addDays(today, -21)],
    ),
    lookups(),
  ]);
  return (
    <>
      <PageHead title="Reschedule queue" sub={`${jobs.length} visit(s) need a new date`} />
      <Notice ok={sp.ok} error={sp.error} />
      {jobs.length === 0 && <Empty>Nothing to reschedule.</Empty>}
      <div className="stack">
        {jobs.map((j) => (
          <form key={j.id} action={rescheduleJob} className="card row wrap">
            <input type="hidden" name="id" value={j.id} />
            <input type="hidden" name="back" value="/manager/reschedule" />
            <div className="grow">
              <Link href={`/manager/jobs/${j.id}`}><strong>{j.boat_name}</strong></Link> · {j.customer_name}{" "}
              <JobStatusBadge status={j.status} />
              <div className="muted small">
                Was {fmtDay(j.scheduled_date)} · {locationText(j)} · {j.skip_reason || "Needs a new date"}
              </div>
            </div>
            <input type="date" name="date" defaultValue={addDays(today, 1)} required aria-label="New date" />
            <select name="crew_id" defaultValue={j.crew_id ?? ""} aria-label="Crew">
              <option value="">Keep crew</option>
              {crews.filter((c) => c.active).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="btn primary small-btn">Reschedule</button>
          </form>
        ))}
      </div>
    </>
  );
}
