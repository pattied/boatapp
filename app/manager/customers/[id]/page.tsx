import Link from "next/link";
import { notFound } from "next/navigation";
import {
  activateCustomer,
  addBoat,
  addContact,
  addPlan,
  declineCustomer,
  deleteContact,
  endPlan,
  markBoatSold,
  pauseBoatAction,
  resumeBoatAction,
  updateBoat,
  updateCustomer,
  updatePlan,
} from "../../actions";
import { BoatFields, PlanFields } from "@/components/BoatPlanFields";
import CopyButton from "@/components/CopyButton";
import { Badge, Check, Field, JobStatusBadge, Notice, PageHead, Select, Submit } from "@/components/ui";
import { addDays, fmtDay, fmtDateTime, todayLA, WEEKDAYS, weekday } from "@/lib/dates";
import { q, one } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { JOB_SELECT, locationText, lookups, type JobRow } from "@/lib/repo";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

type Customer = {
  id: string; name: string; phone: string; email: string; status: string; notes: string; portal_token: string;
  source: string; marketing_consent: boolean; sms_consent: boolean; consent_text: string; consent_at: string | null;
  requested_plan: string; created_at: string;
};
type Boat = {
  id: string; name: string; make_model: string; length_ft: number | null; hull_color: string; marina_id: string | null;
  gate_id: string | null; dock_id: string | null; slip: string; berth_type: string; gate_code_override: string;
  access_notes: string; liveaboard: boolean; knock_first: boolean; status: string; paused_until: string | null;
  pause_reason: string; marina_name: string | null; gate_name: string | null; dock_name: string | null;
};
type Plan = {
  id: string; boat_id: string; service_id: string | null; crew_id: string | null; anchor_date: string; interval_weeks: number;
  off_interval_weeks: number | null; season_start: string; season_end: string; end_date: string | null; active: boolean;
  service_name: string | null; crew_name: string | null;
};

export default async function CustomerDetail({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const c = await one<Customer>("select * from customers where id = $1", [id]);
  if (!c) notFound();
  const today = todayLA();
  const [l, contacts, boats, plans, upcoming, history, issues, requests] = await Promise.all([
    lookups(),
    q<{ id: string; name: string; role: string; phone: string; email: string }>("select * from contacts where customer_id = $1 order by name", [id]),
    q<Boat>(
      `select b.*, m.name as marina_name, g.name as gate_name, d.name as dock_name from boats b
       left join marinas m on m.id = b.marina_id left join docks d on d.id = b.dock_id
       left join gates g on g.id = coalesce(b.gate_id, d.gate_id)
       where b.customer_id = $1 order by b.status = 'sold', b.name`,
      [id],
    ),
    q<Plan>(
      `select p.*, s.name as service_name, cr.name as crew_name from plans p
       left join services s on s.id = p.service_id left join crews cr on cr.id = p.crew_id
       where p.boat_id in (select id from boats where customer_id = $1) order by p.active desc, p.created_at`,
      [id],
    ),
    q<JobRow>(`${JOB_SELECT} where c.id = $1 and j.scheduled_date >= $2 and j.status not in ('completed', 'partial')
       order by j.scheduled_date limit 12`, [id, today]),
    q<JobRow>(`${JOB_SELECT} where c.id = $1 and (j.scheduled_date < $2 or j.status in ('completed', 'partial'))
       order by j.scheduled_date desc limit 20`, [id, today]),
    q<{ id: string; category: string; status: string; severity: string; boat_name: string; created_at: string }>(
      `select i.id, i.category, i.status, i.severity, b.name as boat_name, i.created_at from issues i join boats b on b.id = i.boat_id
       where b.customer_id = $1 order by i.created_at desc limit 20`,
      [id],
    ),
    q<{ id: string; kind: string; status: string; created_at: string; note: string }>(
      "select id, kind, status, created_at, note from requests where customer_id = $1 order by created_at desc limit 10",
      [id],
    ),
  ]);
  const back = `/manager/customers/${id}`;
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;

  return (
    <>
      <PageHead title={c.name} sub={<>{c.phone || "No phone"} · {c.email || "No email"} · <Badge tone={c.status === "active" ? "good" : c.status === "pending" ? "warn" : "idle"}>{c.status}</Badge></>}>
        <CopyButton text={`/portal/${c.portal_token}`} absolute label="Copy customer portal link" />
        <a className="btn small-btn" href={`/portal/${c.portal_token}`} target="_blank" rel="noreferrer">Open portal</a>
        <Link className="btn small-btn" href={`/manager/jobs/new?boat=${boats[0]?.id ?? ""}`}>New one-off job</Link>
      </PageHead>
      <Notice ok={sp.ok} error={sp.error} />

      {c.status === "pending" && (
        <section className="card stack attn warn">
          <h2>Sign-up waiting for review</h2>
          <p className="small">
            Signed up {fmtDateTime(c.created_at)}. Requested: {c.requested_plan || "not stated"}.
            {c.sms_consent ? ` Agreed to texts on ${fmtDateTime(c.consent_at)}.` : " Did not agree to texts."}
          </p>
          <p className="muted small">Check the boat&apos;s marina, gate, dock and slip below before activating.</p>
          <form action={activateCustomer} className="row wrap">
            {hidden("id", id)}
            {hidden("back", back)}
            <label className="field">
              <span>First visit *</span>
              <input type="date" name="first_date" defaultValue={addDays(today, 1)} required />
            </label>
            <label className="field">
              <span>Crew</span>
              <select name="crew_id" defaultValue="">
                <option value="">Keep plan&apos;s crew</option>
                {l.crews.filter((x) => x.active).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </label>
            <Submit>Activate and schedule</Submit>
            <Submit tone="danger" formAction={declineCustomer}>Decline</Submit>
          </form>
        </section>
      )}

      <div className="two-col">
        <details className="card">
          <summary><h2>Customer details</h2></summary>
          <form action={updateCustomer} className="form-grid">
            {hidden("id", id)}
            {hidden("back", back)}
            <Field label="Name" name="name" defaultValue={c.name} required />
            <Field label="Mobile phone" name="phone" defaultValue={c.phone} />
            <Field label="Email" name="email" defaultValue={c.email} />
            {c.status !== "pending" && (
              <Select label="Status" name="status" defaultValue={c.status === "inactive" ? "inactive" : "active"} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive (no new visits)" }]} />
            )}
            <label className="field wide"><span>Internal notes</span><textarea name="notes" defaultValue={c.notes} rows={2} /></label>
            <div className="wide checks"><Check label="Agreed to marketing use of photos" name="marketing_consent" defaultChecked={c.marketing_consent} /></div>
            <div className="wide"><Submit>Save</Submit></div>
          </form>
        </details>

        <section className="card stack">
          <h2>Contacts</h2>
          {contacts.length === 0 && <p className="muted small">Only the customer above. Add a co-owner, captain or manager.</p>}
          {contacts.map((x) => (
            <form key={x.id} action={deleteContact} className="row">
              {hidden("id", x.id)}
              {hidden("back", back)}
              <span className="grow"><strong>{x.name}</strong> · {x.role} · {x.phone || x.email || "no contact info"}</span>
              <Submit tone="quiet">Remove</Submit>
            </form>
          ))}
          <details>
            <summary className="small">Add a contact</summary>
            <form action={addContact} className="form-grid">
              {hidden("customer_id", id)}
              {hidden("back", back)}
              <Field label="Name" name="name" required />
              <Select label="Role" name="role" options={["owner", "co-owner", "captain", "manager"].map((r) => ({ value: r, label: r }))} />
              <Field label="Phone" name="phone" />
              <Field label="Email" name="email" />
              <div className="wide"><Submit>Add contact</Submit></div>
            </form>
          </details>
        </section>
      </div>

      {boats.map((b) => {
        const bPlans = plans.filter((p) => p.boat_id === b.id);
        return (
          <section key={b.id} className="card stack">
            <div className="job-head">
              <h2>{b.name} <span className="muted small">{b.make_model}{b.length_ft ? ` · ${b.length_ft} ft` : ""}{b.hull_color ? ` · ${b.hull_color} hull` : ""}</span></h2>
              <Badge tone={b.status === "active" ? "good" : b.status === "paused" ? "warn" : "idle"}>
                {b.status === "paused" ? `Paused${b.paused_until ? ` until ${fmtDay(b.paused_until)}` : ""}${b.pause_reason ? ` · ${b.pause_reason}` : ""}` : b.status}
              </Badge>
            </div>
            <div className="small">
              {locationText(b) || "No location"}
              {b.gate_code_override ? ` · boat gate code ${b.gate_code_override}` : ""}
              {b.liveaboard ? " · Liveaboard" : ""}{b.knock_first ? " · Knock first" : ""}
            </div>
            {b.access_notes && <div className="muted small">Access: {b.access_notes}</div>}

            <div className="stack">
              {bPlans.map((p) => (
                <details key={p.id} className="plan">
                  <summary>
                    <strong>{p.active ? "Plan" : "Ended plan"}:</strong> {p.service_name ?? "No service"} · every {p.interval_weeks} week(s)
                    {p.off_interval_weeks ? `, every ${p.off_interval_weeks} outside ${p.season_start} to ${p.season_end}` : ""} · {WEEKDAYS[weekday(p.anchor_date)]}s · {p.crew_name ?? "no crew"}
                    {p.end_date ? ` · ended ${fmtDay(p.end_date)}` : ""}
                  </summary>
                  {p.active && (
                    <>
                      <form action={updatePlan} className="form-grid">
                        {hidden("plan_id", p.id)}
                        {hidden("back", back)}
                        <PlanFields l={l} p={p} />
                        <label className="field">
                          <span>Apply to visits from</span>
                          <input type="date" name="apply_from" defaultValue={today} />
                        </label>
                        <p className="wide muted small">This changes this and all future visits. Visits you changed one by one are kept.</p>
                        <div className="wide"><Submit>Save plan for all future visits</Submit></div>
                      </form>
                      <form action={endPlan}>
                        {hidden("plan_id", p.id)}
                        {hidden("back", back)}
                        <Submit tone="danger">End this plan</Submit>
                      </form>
                    </>
                  )}
                </details>
              ))}
              {b.status !== "sold" && (
                <details>
                  <summary className="small">Add a recurring plan</summary>
                  <form action={addPlan} className="form-grid">
                    {hidden("boat_id", b.id)}
                    {hidden("back", back)}
                    <PlanFields l={l} p={{ anchor_date: addDays(today, 1) }} />
                    <div className="wide"><Submit>Add plan</Submit></div>
                  </form>
                </details>
              )}
            </div>

            <details>
              <summary className="small">Edit boat and location</summary>
              <form action={updateBoat} className="form-grid">
                {hidden("boat_id", b.id)}
                {hidden("back", back)}
                <BoatFields l={l} b={b} />
                <div className="wide"><Submit>Save boat</Submit></div>
              </form>
            </details>

            {b.status !== "sold" && (
              <div className="row wrap">
                {b.status === "active" ? (
                  <form action={pauseBoatAction} className="row wrap">
                    {hidden("boat_id", b.id)}
                    {hidden("back", back)}
                    <select name="reason" defaultValue="Haul-out" aria-label="Pause reason">
                      {["Haul-out", "Owner away cruising", "Winter", "Owner request", "Other"].map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                    <input type="date" name="until" aria-label="Pause until" />
                    <Submit tone="plain">Pause visits</Submit>
                  </form>
                ) : (
                  <form action={resumeBoatAction}>
                    {hidden("boat_id", b.id)}
                    {hidden("back", back)}
                    <Submit tone="plain">Resume visits</Submit>
                  </form>
                )}
                <form action={markBoatSold}>
                  {hidden("boat_id", b.id)}
                  {hidden("back", back)}
                  <Submit tone="quiet">Mark sold</Submit>
                </form>
              </div>
            )}
          </section>
        );
      })}

      <details className="card">
        <summary><h2>Add another boat</h2></summary>
        <form action={addBoat} className="form-grid">
          {hidden("customer_id", id)}
          {hidden("back", back)}
          <BoatFields l={l} />
          <h3 className="wide">Cleaning plan (optional)</h3>
          <PlanFields l={l} optional />
          <div className="wide"><Submit>Add boat</Submit></div>
        </form>
      </details>

      <div className="two-col">
        <section className="stack">
          <h2>Upcoming visits</h2>
          {upcoming.length === 0 && <p className="muted small">None scheduled.</p>}
          {upcoming.map((j) => (
            <Link key={j.id} href={`/manager/jobs/${j.id}`} className="row-link">
              <span><strong>{fmtDay(j.scheduled_date)}</strong> · {j.boat_name} · {j.crew_name ?? "No crew"}</span>
              <JobStatusBadge status={j.status} />
            </Link>
          ))}
        </section>
        <section className="stack">
          <h2>History</h2>
          {history.length === 0 && <p className="muted small">No past visits.</p>}
          {history.map((j) => (
            <Link key={j.id} href={`/manager/jobs/${j.id}`} className="row-link">
              <span><strong>{fmtDay(j.scheduled_date)}</strong> · {j.boat_name} · {j.after_count} after photo(s)</span>
              <JobStatusBadge status={j.status} />
            </Link>
          ))}
        </section>
      </div>

      {(issues.length > 0 || requests.length > 0) && (
        <div className="two-col">
          <section className="stack">
            <h2>Issues</h2>
            {issues.map((i) => (
              <Link key={i.id} href={`/manager/issues?open=${i.id}`} className="row-link">
                <span>{i.boat_name} · {i.category}</span>
                <Badge tone={i.severity === "urgent" ? "bad" : i.status === "resolved" ? "good" : "warn"}>{i.status}</Badge>
              </Link>
            ))}
          </section>
          <section className="stack">
            <h2>Requests</h2>
            {requests.map((r) => (
              <Link key={r.id} href="/manager/requests" className="row-link">
                <span>{r.kind === "pause" ? "Pause" : "Service"} · {fmtDateTime(r.created_at)}</span>
                <Badge tone={r.status === "pending" ? "warn" : "idle"}>{r.status}</Badge>
              </Link>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
