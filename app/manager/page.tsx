import Link from "next/link";
import { Badge, Empty, JobStatusBadge, Notice, PageHead } from "@/components/ui";
import { addDays, fmtDateTime, fmtDay, todayLA } from "@/lib/dates";
import { q } from "@/lib/db";
import { JOB_SELECT, locationText, type JobRow } from "@/lib/repo";
import { requireManager } from "@/lib/session";
import { coverage, notesDue } from "@/lib/notes";
import { isLeadStage } from "@/lib/stages";

type SP = Promise<{ ok?: string; error?: string }>;

// Everything waiting on the manager, most urgent first.
export default async function NeedsAttention({ searchParams }: { searchParams: SP }) {
  await requireManager();
  const sp = await searchParams;
  const today = todayLA();
  const [urgent, review, resched, unassigned, signups, requests, openIssues, todayJobs, photosMissing] = await Promise.all([
    q<{ id: string; category: string; boat_name: string; created_at: string; reported_by: string; note: string }>(
      `select i.id, i.category, b.name as boat_name, i.created_at, i.reported_by, i.note from issues i
       join boats b on b.id = i.boat_id where i.severity = 'urgent' and i.status in ('open', 'quoted') order by i.created_at desc`,
    ),
    q<JobRow>(`${JOB_SELECT} where j.needs_review order by j.scheduled_date desc`),
    q<JobRow>(`${JOB_SELECT} where j.status in ('needs_reschedule')
       or (j.status = 'skipped' and j.manager_notes not like '%Rescheduled to%' and j.scheduled_date >= $1)
       order by j.scheduled_date`, [addDays(today, -21)]),
    q<JobRow>(`${JOB_SELECT} where j.crew_id is null and j.status = 'scheduled' and j.scheduled_date between $1 and $2
       order by j.scheduled_date`, [today, addDays(today, 7)]),
    q<{ id: string; name: string; created_at: string }>(
      "select id, name, created_at from customers where status = 'pending' order by created_at",
    ),
    q<{ n: number }>("select count(*)::int as n from requests where status = 'pending'"),
    q<{ n: number }>("select count(*)::int as n from issues where status in ('open', 'quoted') and severity = 'normal'"),
    q<{ status: string; n: number }>(
      "select status, count(*)::int as n from jobs where scheduled_date = $1 group by status",
      [today],
    ),
    q<JobRow>(`${JOB_SELECT} where j.status in ('completed', 'partial') and j.completed_at < now() - interval '2 hours'
       and j.scheduled_date >= $1 and not exists (select 1 from photos p where p.job_id = j.id and p.kind = 'after')
       order by j.completed_at desc`, [addDays(today, -7)]),
  ]);
  const [msg] = await q<{ unread: number; approval: number }>(
    `select (select count(*)::int from messages where direction = 'in' and read_at is null) as unread,
            (select count(*)::int from messages where status = 'pending_approval') as approval`,
  );
  const due = (await notesDue(today, 14)).filter((n) => !isLeadStage(n.customer_status));
  const [spot] = await q<{ n: number }>("select count(*)::int as n from spotted_boats where status = 'new'");
  const newFromSales = await q<{ id: string; name: string; converted_by: string; converted_at: string }>(
    `select c.id, c.name, c.converted_by, c.converted_at from customers c
     where c.status = 'active' and c.converted_at is not null
       and not exists (select 1 from plans p join boats b on b.id = p.boat_id where b.customer_id = c.id)
     order by c.converted_at desc limit 20`,
  );
  const t = Object.fromEntries(todayJobs.map((r) => [r.status, r.n]));
  const total = todayJobs.reduce((s, r) => s + r.n, 0);
  const nothing =
    !urgent.length && !review.length && !resched.length && !unassigned.length && !signups.length && !requests[0].n && !photosMissing.length && !due.length && !newFromSales.length;

  return (
    <>
      <PageHead
        title="Needs attention"
        sub={`Today, ${fmtDay(today, { weekday: "long", month: "long", day: "numeric" })}: ${total} visits · ${(t.completed ?? 0) + (t.partial ?? 0)} done · ${t.in_progress ?? 0} in progress · ${t.skipped ?? 0} skipped`}
      >
        <Link className="btn" href="/manager/schedule">Open schedule</Link>
        <Link className="btn primary" href="/manager/customers/new">New customer</Link>
      </PageHead>
      <Notice ok={sp.ok} error={sp.error} />

      {nothing && <Empty>Nothing is waiting on you.</Empty>}

      {newFromSales.length > 0 && (
        <section className="attn warn">
          <h2>New customers without a cleaning plan ({newFromSales.length})</h2>
          {newFromSales.map((c) => (
            <Link key={c.id} href={`/manager/customers/${c.id}`} className="attn-row">
              <strong>{c.name}</strong>
              <span className="muted"> · made a customer by {c.converted_by || "staff"} · {fmtDateTime(c.converted_at)}</span>
            </Link>
          ))}
        </section>
      )}

      {due.length > 0 && (
        <section className="attn warn">
          <h2>Customer dates coming up ({due.length})</h2>
          {due.map((n) => {
            const cov = coverage(n, today, (d) => fmtDay(d, { weekday: "short", month: "short", day: "numeric" }));
            return (
              <Link key={n.id} href={`/manager/customers/${n.customer_id}#notes`} className="attn-row">
                <strong>{n.customer_name}</strong>{n.boat_name ? ` · ${n.boat_name}` : ""} · clean by {fmtDay(n.needed_by!, { weekday: "short", month: "short", day: "numeric" })}
                <div className="small">{n.body}</div>
                {cov && <div className={`small ${cov.tone === "good" ? "good-text" : "warn-text"}`}>{cov.text}</div>}
              </Link>
            );
          })}
        </section>
      )}

      {urgent.length > 0 && (
        <section className="attn bad">
          <h2>Urgent flags ({urgent.length})</h2>
          {urgent.map((i) => (
            <Link key={i.id} href={`/manager/issues?open=${i.id}`} className="attn-row">
              <strong>{i.boat_name}</strong> · {i.category}
              <span className="muted"> · {i.reported_by} · {fmtDateTime(i.created_at)}</span>
              {i.note && <div className="muted small">{i.note}</div>}
            </Link>
          ))}
        </section>
      )}

      {review.length > 0 && (
        <section className="attn warn">
          <h2>Needs review ({review.length})</h2>
          <p className="muted small">Work arrived for visits you had changed or cancelled while the technician was offline.</p>
          {review.map((j) => (
            <Link key={j.id} href={`/manager/jobs/${j.id}`} className="attn-row">
              <strong>{j.boat_name}</strong> · {fmtDay(j.scheduled_date)} <JobStatusBadge status={j.status} />
            </Link>
          ))}
        </section>
      )}

      {resched.length > 0 && (
        <section className="attn warn">
          <h2>
            Reschedule queue ({resched.length}) <Link href="/manager/reschedule" className="small">Open queue</Link>
          </h2>
          {resched.slice(0, 6).map((j) => (
            <div key={j.id} className="attn-row">
              <strong>{j.boat_name}</strong> · {fmtDay(j.scheduled_date)} · {j.skip_reason || "Needs a new date"}
            </div>
          ))}
        </section>
      )}

      {photosMissing.length > 0 && (
        <section className="attn warn">
          <h2>Completed but no after photos ({photosMissing.length})</h2>
          <p className="muted small">The technician's phone may still be holding them. Ask them to open the app with signal.</p>
          {photosMissing.map((j) => (
            <Link key={j.id} href={`/manager/jobs/${j.id}`} className="attn-row">
              <strong>{j.boat_name}</strong> · {j.crew_name ?? "No crew"} · finished {fmtDateTime(j.completed_at)}
            </Link>
          ))}
        </section>
      )}

      {unassigned.length > 0 && (
        <section className="attn">
          <h2>No crew assigned, next 7 days ({unassigned.length})</h2>
          {unassigned.map((j) => (
            <Link key={j.id} href={`/manager/schedule?date=${j.scheduled_date}`} className="attn-row">
              <strong>{j.boat_name}</strong> · {fmtDay(j.scheduled_date)} · {locationText(j)}
            </Link>
          ))}
        </section>
      )}

      <div className="tiles">
        <Link href="/sales" className="tile-link">
          <span className="big">{spot.n}</span> dock-walk boat(s) to follow up
        </Link>
        <Link href="/manager/messages" className="tile-link">
          <span className="big">{msg.unread}</span> new message(s) from customers
        </Link>
        <Link href="/manager/messages?tab=approval" className="tile-link">
          <span className="big">{msg.approval}</span> message(s) waiting for approval
        </Link>
        <Link href="/manager/requests" className="tile-link">
          <span className="big">{signups.length}</span> sign-ups to review
        </Link>
        <Link href="/manager/requests" className="tile-link">
          <span className="big">{requests[0].n}</span> customer requests
        </Link>
        <Link href="/manager/issues" className="tile-link">
          <span className="big">{openIssues[0].n}</span> open issues
        </Link>
        <Link href="/manager/schedule" className="tile-link">
          <span className="big">{t.scheduled ?? 0}</span> visits not started today
        </Link>
      </div>
      {signups.length > 0 && (
        <p className="muted small">
          Waiting sign-ups: {signups.map((s) => s.name).join(", ")}. <Badge tone="warn">Review in Requests</Badge>
        </p>
      )}
    </>
  );
}
