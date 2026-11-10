import Link from "next/link";
import { approveRequest, declineRequest } from "../actions";
import { Badge, Empty, Notice, PageHead, Submit } from "@/components/ui";
import { addDays, fmtDateTime, fmtDay, todayLA } from "@/lib/dates";
import { q } from "@/lib/db";
import { lookups } from "@/lib/repo";
import { requireManager } from "@/lib/session";

type SP = Promise<{ ok?: string; error?: string }>;

export default async function Requests({ searchParams }: { searchParams: SP }) {
  await requireManager();
  const sp = await searchParams;
  const today = todayLA();
  const [signups, pending, recent, { crews }] = await Promise.all([
    q<{ id: string; name: string; phone: string; requested_plan: string; created_at: string; boats: string | null }>(
      `select c.id, c.name, c.phone, c.requested_plan, c.created_at,
         (select string_agg(b.name || coalesce(' · ' || m.name, '') || ' ' || b.slip, ', ') from boats b
            left join marinas m on m.id = b.marina_id where b.customer_id = c.id) as boats
       from customers c where c.status = 'pending' order by c.created_at`,
    ),
    q<{
      id: string; kind: string; note: string; preferred_date: string | null; until_date: string | null; created_at: string;
      customer_id: string; customer_name: string; boat_name: string | null; services: string | null;
    }>(
      `select r.id, r.kind, r.note, r.preferred_date, r.until_date, r.created_at, c.id as customer_id, c.name as customer_name,
         b.name as boat_name,
         (select string_agg(s.name, ', ') from services s where s.id = any(r.service_ids)) as services
       from requests r join customers c on c.id = r.customer_id left join boats b on b.id = r.boat_id
       where r.status = 'pending' order by r.created_at`,
    ),
    q<{ id: string; kind: string; status: string; customer_name: string; created_at: string; job_id: string | null }>(
      `select r.id, r.kind, r.status, c.name as customer_name, r.created_at, r.job_id from requests r
       join customers c on c.id = r.customer_id where r.status <> 'pending' order by r.created_at desc limit 15`,
    ),
    lookups(),
  ]);
  const back = "/manager/requests";
  return (
    <>
      <PageHead title="Requests and sign-ups" sub="Customers order extra services or ask to pause from their portal. New customers sign up from the sign-up page." />
      <Notice ok={sp.ok} error={sp.error} />

      <section className="stack">
        <h2>New customer sign-ups ({signups.length})</h2>
        {signups.length === 0 && <Empty>No sign-ups waiting.</Empty>}
        {signups.map((s) => (
          <Link key={s.id} href={`/manager/customers/${s.id}`} className="row-link">
            <span>
              <strong>{s.name}</strong> · {s.phone} · {s.boats ?? "no boat"}
              <div className="muted small">Wants: {s.requested_plan || "not stated"} · signed up {fmtDateTime(s.created_at)}</div>
            </span>
            <Badge tone="warn">Review and activate</Badge>
          </Link>
        ))}
      </section>

      <section className="stack">
        <h2>Customer requests ({pending.length})</h2>
        {pending.length === 0 && <Empty>No requests waiting.</Empty>}
        {pending.map((r) => (
          <form key={r.id} action={approveRequest} className="card stack">
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="back" value={back} />
            <div className="job-head">
              <span>
                <Link href={`/manager/customers/${r.customer_id}`}><strong>{r.customer_name}</strong></Link> · {r.boat_name ?? "No boat"}
              </span>
              <Badge tone="warn">{r.kind === "pause" ? "Pause request" : "Service request"}</Badge>
            </div>
            {r.kind === "service" ? (
              <div className="small">
                Wants {r.services ?? "a service"}{r.preferred_date ? `, preferably ${fmtDay(r.preferred_date)}` : ""}.
                {r.note && <> Note: {r.note}</>}
              </div>
            ) : (
              <div className="small">
                Pause visits {r.until_date ? `until ${fmtDay(r.until_date)}` : "until further notice"}.{r.note && <> Note: {r.note}</>}
              </div>
            )}
            <div className="row wrap">
              {r.kind === "service" && (
                <>
                  <input type="date" name="date" defaultValue={r.preferred_date && r.preferred_date >= today ? r.preferred_date : addDays(today, 1)} aria-label="Date" />
                  <select name="crew_id" defaultValue="" aria-label="Crew">
                    <option value="">No crew yet</option>
                    {crews.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </>
              )}
              <Submit>{r.kind === "service" ? "Approve and schedule" : "Approve pause"}</Submit>
              <input name="reason" placeholder="Reason for declining" aria-label="Decline reason" />
              <Submit tone="danger" formAction={declineRequest}>Decline</Submit>
            </div>
          </form>
        ))}
      </section>

      {recent.length > 0 && (
        <section className="stack">
          <h2>Recently handled</h2>
          <ul className="plain-list small">
            {recent.map((r) => (
              <li key={r.id}>
                {fmtDateTime(r.created_at)} · {r.customer_name} · {r.kind} · {r.status}
                {r.job_id && <> · <Link href={`/manager/jobs/${r.job_id}`}>visit</Link></>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
