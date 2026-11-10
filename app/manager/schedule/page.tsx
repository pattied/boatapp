import Link from "next/link";
import { bulkJobs, weatherDay } from "../actions";
import { Empty, JobStatusBadge, Notice, PageHead } from "@/components/ui";
import { addDays, fmtDay, isDate, startOfWeek, todayLA } from "@/lib/dates";
import { q } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { JOB_SELECT, locationText, lookups, ORDER_WALKING, type JobRow } from "@/lib/repo";
import { requireManager } from "@/lib/session";

type SP = Promise<{ date?: string; view?: string; crew?: string; marina?: string; ok?: string; error?: string }>;

export default async function Schedule({ searchParams }: { searchParams: SP }) {
  await requireManager();
  const sp = await searchParams;
  const today = todayLA();
  const date = isDate(sp.date) ? sp.date : today;
  const view = sp.view === "week" ? "week" : "day";
  const from = view === "week" ? startOfWeek(date) : date;
  const to = view === "week" ? addDays(from, 6) : date;
  const { crews, marinas } = await lookups();

  const params: unknown[] = [from, to];
  let where = "where j.scheduled_date between $1 and $2";
  if (sp.crew === "none") where += " and j.crew_id is null";
  else if (isUuid(sp.crew)) {
    params.push(sp.crew);
    where += ` and j.crew_id = $${params.length}`;
  }
  if (isUuid(sp.marina)) {
    params.push(sp.marina);
    where += ` and b.marina_id = $${params.length}`;
  }
  const jobs = await q<JobRow>(`${JOB_SELECT} ${where} ${ORDER_WALKING}`, params);

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ date, view, ...(sp.crew ? { crew: sp.crew } : {}), ...(sp.marina ? { marina: sp.marina } : {}), ...over });
    return `/manager/schedule?${p}`;
  };
  const back = qs({});
  const step = view === "week" ? 7 : 1;
  const crewGroups = [{ id: null as string | null, name: "No crew assigned" }, ...crews.map((c) => ({ id: c.id as string | null, name: c.name }))];
  const active = jobs.filter((j) => j.status !== "cancelled");

  return (
    <>
      <PageHead
        title={view === "week" ? `Week of ${fmtDay(from, { month: "long", day: "numeric" })}` : fmtDay(date, { weekday: "long", month: "long", day: "numeric" })}
        sub={`${active.length} visit(s)${jobs.length - active.length ? ` · ${jobs.length - active.length} cancelled` : ""}`}
      >
        <Link className="btn" href={qs({ date: addDays(date, -step) })}>‹ Prev</Link>
        <Link className="btn" href={qs({ date: today })}>Today</Link>
        <Link className="btn" href={qs({ date: addDays(date, step) })}>Next ›</Link>
        <Link className="btn" href={qs({ view: view === "week" ? "day" : "week" })}>{view === "week" ? "Day view" : "Week view"}</Link>
        <Link className="btn primary" href="/manager/jobs/new">New one-off job</Link>
      </PageHead>
      <Notice ok={sp.ok} error={sp.error} />

      <form className="toolbar" method="get">
        <input type="hidden" name="view" value={view} />
        <input type="date" name="date" defaultValue={date} className="search narrow" />
        <select name="crew" defaultValue={sp.crew ?? ""} className="search narrow">
          <option value="">All crews</option>
          <option value="none">No crew assigned</option>
          {crews.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select name="marina" defaultValue={sp.marina ?? ""} className="search narrow">
          <option value="">All marinas</option>
          {marinas.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <button className="btn">Filter</button>
      </form>

      <form id="bulk" action={bulkJobs} className="bulk-bar">
        <input type="hidden" name="back" value={back} />
        <strong>Selected visits:</strong>
        <select name="bulk_crew_id" defaultValue="">
          <option value="">No crew</option>
          {crews.filter((c) => c.active).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="btn small-btn" name="op" value="assign">Assign crew</button>
        <input type="date" name="bulk_date" defaultValue={addDays(date, 1)} />
        <button className="btn small-btn" name="op" value="move">Move to date</button>
        <input name="bulk_reason" placeholder="Cancel reason" />
        <button className="btn small-btn danger" name="op" value="cancel">Cancel</button>
      </form>

      {view === "day" ? (
        <>
          {jobs.length === 0 && <Empty>No visits on this day.</Empty>}
          {crewGroups.map((g) => {
            const list = jobs.filter((j) => j.crew_id === g.id);
            if (!list.length) return null;
            return (
              <section key={g.id ?? "none"} className="crew-group">
                <h2>
                  {g.name} <span className="muted small">{list.filter((j) => j.status !== "cancelled").length} visit(s)</span>
                </h2>
                <div className="job-table">
                  {list.map((j, i) => (
                    <JobLine key={j.id} j={j} n={i + 1} />
                  ))}
                </div>
              </section>
            );
          })}
          {active.some((j) => j.status === "scheduled") && (
            <form action={weatherDay} className="card stack weather">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="date" value={date} />
              <h2>Weather day</h2>
              <p className="muted small">Applies to every visit on {fmtDay(date)} that hasn&apos;t started.</p>
              <label className="check">
                <input type="radio" name="mode" value="move" defaultChecked /> <span>Move them to</span>
                <input type="date" name="to_date" defaultValue={addDays(date, 1)} />
              </label>
              <label className="check">
                <input type="radio" name="mode" value="skip" /> <span>Skip to each boat&apos;s next regular visit</span>
              </label>
              <button className="btn danger">Apply weather day</button>
            </form>
          )}
        </>
      ) : (
        <div className="week">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => {
            const list = jobs.filter((j) => j.scheduled_date === d);
            const counts = crewGroups
              .map((g) => [g.name, list.filter((j) => j.crew_id === g.id && j.status !== "cancelled").length] as const)
              .filter(([, n]) => n);
            return (
              <section key={d} className={`week-day ${d === today ? "today" : ""}`}>
                <Link href={qs({ date: d, view: "day" })} className="week-head">
                  {fmtDay(d)}
                </Link>
                <div className="muted small">{counts.map(([n, c]) => `${n}: ${c}`).join(" · ") || "No visits"}</div>
                {list.map((j) => (
                  <label key={j.id} className={`week-job ${j.status}`}>
                    <input type="checkbox" name="ids" value={j.id} form="bulk" />
                    <span>
                      <Link href={`/manager/jobs/${j.id}`}>{j.boat_name}</Link>
                      <span className="muted small"> · {j.crew_name ?? "No crew"}</span>
                    </span>
                  </label>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function JobLine({ j, n }: { j: JobRow; n: number }) {
  return (
    <div className={`job-line ${j.status}`}>
      <input type="checkbox" name="ids" value={j.id} form="bulk" aria-label={`Select ${j.boat_name}`} />
      <span className="muted">{n}</span>
      <div className="grow">
        <Link href={`/manager/jobs/${j.id}`}>
          <strong>{j.boat_name}</strong>
        </Link>{" "}
        <span className="muted">· {j.customer_name}</span>
        <div className="muted small">
          {locationText(j)} · {j.service_name ?? "No service"}
          {j.origin === "request" ? " · Customer request" : ""}
          {j.is_override && j.origin === "plan" ? " · Edited" : ""}
        </div>
      </div>
      <div className="job-meta">
        <span className="small muted">
          {j.before_count}/{j.after_count} photos{j.issue_count ? ` · ${j.issue_count} issue` : ""}
        </span>
        <JobStatusBadge status={j.status} />
      </div>
    </div>
  );
}
