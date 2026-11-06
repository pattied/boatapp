import Link from "next/link";
import { notFound } from "next/navigation";
import { setJobStatus, updateJob } from "../../actions";
import CopyButton from "@/components/CopyButton";
import { Badge, JobStatusBadge, Notice, PageHead, Select, Submit } from "@/components/ui";
import { fmtDateTime, fmtDay } from "@/lib/dates";
import { q } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { getJobById, jobPhotos, locationText, lookups } from "@/lib/repo";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function JobDetail({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const job = await getJobById(id);
  if (!job) notFound();
  const [photos, issues, events, { crews, services }] = await Promise.all([
    jobPhotos([id]),
    q<{ id: string; category: string; severity: string; status: string; note: string; found: string }>(
      "select id, category, severity, status, note, found from issues where job_id = $1 order by created_at",
      [id],
    ),
    q<{ type: string; at: string; by_name: string }>("select type, at, by_name from crew_events where job_id = $1 order by at", [id]),
    lookups(),
  ]);
  const back = `/manager/jobs/${id}`;
  const kinds = ["before", "after", "issue", "skip", "share"] as const;
  const editable = ["scheduled", "needs_reschedule", "in_progress"].includes(job.status);

  return (
    <>
      <PageHead title={job.boat_name} sub={<>{job.customer_name} · {fmtDay(job.scheduled_date, { weekday: "long", month: "long", day: "numeric" })} · <JobStatusBadge status={job.status} /></>}>
        <Link className="btn" href={`/manager/customers/${job.customer_id}`}>Customer</Link>
        <Link className="btn" href={`/manager/schedule?date=${job.scheduled_date}`}>Back to schedule</Link>
      </PageHead>
      <Notice ok={sp.ok} error={sp.error} />

      {job.needs_review && (
        <form action={setJobStatus} className="notice warn row">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="op" value="reviewed" />
          <input type="hidden" name="back" value={back} />
          <span>Work arrived for this visit after it was changed or cancelled. Check the photos and status.</span>
          <Submit tone="plain">Mark reviewed</Submit>
        </form>
      )}

      <div className="two-col">
        <section className="card stack">
          <h2>Visit</h2>
          <dl className="facts">
            <dt>Location</dt><dd>{locationText(job) || "No location"}</dd>
            <dt>Gate code</dt><dd>{job.gate_code || "None"}</dd>
            <dt>Access notes</dt><dd>{job.access_notes || "None"}</dd>
            <dt>Origin</dt><dd>{job.origin === "plan" ? `Recurring plan${job.is_override ? " (edited for this visit)" : ""}` : job.origin === "request" ? "Customer request" : "One-off"}</dd>
            {job.rescheduled_from && (<><dt>Moved from</dt><dd>{fmtDay(job.rescheduled_from)}</dd></>)}
            <dt>Started</dt><dd>{job.started_at ? `${fmtDateTime(job.started_at)} by ${job.started_by}` : "Not started"}</dd>
            <dt>Finished</dt><dd>{job.completed_at ? `${fmtDateTime(job.completed_at)} by ${job.completed_by}` : "Not finished"}</dd>
            {job.completion_message && (<><dt>Message chosen</dt><dd>{job.completion_message}</dd></>)}
            {job.partial_reason && (<><dt>Partial because</dt><dd>{job.partial_reason}</dd></>)}
            {job.skip_reason && (<><dt>Skipped because</dt><dd>{job.skip_reason}</dd></>)}
            {job.cancel_reason && (<><dt>Cancelled because</dt><dd>{job.cancel_reason}</dd></>)}
          </dl>
          {["completed", "partial"].includes(job.status) && (
            <div className="btn-row tight">
              <a className="btn small-btn" href={`/j/${job.public_id}`} target="_blank" rel="noreferrer">Customer photo page</a>
              <CopyButton text={`/j/${job.public_id}`} absolute label="Copy customer link" />
            </div>
          )}
        </section>

        <section className="card stack">
          <h2>Change this visit only</h2>
          <form action={updateJob} className="form-grid">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="back" value={back} />
            <label className="field">
              <span>Date *</span>
              <input type="date" name="date" defaultValue={job.scheduled_date} required />
            </label>
            <Select label="Crew" name="crew_id" defaultValue={job.crew_id} blank="No crew" options={crews.map((c) => ({ value: c.id, label: c.name + (c.active ? "" : " (inactive)") }))} />
            <Select label="Service" name="service_id" defaultValue={job.service_id} blank="None" options={services.map((s) => ({ value: s.id, label: s.name }))} />
            <label className="field wide">
              <span>Notes for this visit</span>
              <textarea name="notes" defaultValue={job.manager_notes} rows={2} />
            </label>
            <div className="wide btn-row tight">
              <Submit>Save visit</Submit>
            </div>
          </form>
          {job.plan_id && (
            <p className="muted small">
              To change every future visit, edit the plan on the <Link href={`/manager/customers/${job.customer_id}`}>customer page</Link>.
            </p>
          )}
          <form action={setJobStatus} className="btn-row tight">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="back" value={back} />
            {editable && <Submit tone="plain" name="op" value="reschedule">Send to reschedule queue</Submit>}
            {editable && (
              <>
                <input name="reason" placeholder="Cancel reason" />
                <Submit tone="danger" name="op" value="cancel">Cancel visit</Submit>
              </>
            )}
            {!editable && <Submit tone="plain" name="op" value="reopen">Reopen visit</Submit>}
          </form>
        </section>
      </div>

      {issues.length > 0 && (
        <section className="card stack">
          <h2>Issues flagged on this visit</h2>
          {issues.map((i) => (
            <div key={i.id} className="row">
              <Badge tone={i.severity === "urgent" ? "bad" : "warn"}>{i.severity === "urgent" ? "Urgent" : i.status}</Badge>
              <span>{i.category}{i.note ? `: ${i.note}` : ""} <span className="muted small">(found {i.found === "before" ? "before work" : "during or after work"})</span></span>
              <Link href={`/manager/issues?open=${i.id}`} className="small">Open</Link>
            </div>
          ))}
        </section>
      )}

      {kinds.map((k) => {
        const list = photos.filter((p) => p.kind === k);
        if (!list.length) return null;
        return (
          <section key={k} className="stack">
            <h2>{k === "share" ? "Share image" : `${k[0].toUpperCase()}${k.slice(1)} photos`} ({list.length})</h2>
            <div className="grid wide-grid">
              {list.map((p) => (
                <a key={p.id} href={p.src} target="_blank" rel="noreferrer" className="tile">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.src} alt={`${k} ${p.slot}`} loading="lazy" />
                  {p.slot && <span className="tile-tag">{p.slot}</span>}
                </a>
              ))}
            </div>
          </section>
        );
      })}

      {events.length > 0 && (
        <section className="stack">
          <h2>Technician activity</h2>
          <ul className="plain-list small">
            {events.map((e, i) => (
              <li key={i}>{fmtDateTime(e.at)} · {e.by_name} · {e.type.replace("_", " ")}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
