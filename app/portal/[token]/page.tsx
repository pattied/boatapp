import Link from "next/link";
import { notFound } from "next/navigation";
import { requestPause, requestService, savePreferences } from "../actions";
import PortalRemember from "@/components/PortalRemember";
import { Badge, Notice } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { addDays, fmtDay, fmtDateTime, todayLA } from "@/lib/dates";
import { one, q } from "@/lib/db";
import { isPublicId } from "@/lib/ids";
import { MARKETING_SMS_WORDING, SERVICE_SMS_WORDING } from "@/lib/messaging/compliance";
import { JOB_SELECT, locationText, type JobRow } from "@/lib/repo";
import { srcFor } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your boat", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

const ISSUE_TONE: Record<string, string> = { open: "warn", quoted: "warn", resolved: "good", dismissed: "idle" };
const ISSUE_TEXT: Record<string, string> = { open: "Open", quoted: "Quote ready", resolved: "Resolved", dismissed: "Closed" };

// The customer's portal: their boats, schedule, history and flagged issues. The private link is the key.
export default async function Portal({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  if (!isPublicId(token)) notFound();
  const c = await one<{ id: string; name: string; status: string; phone: string; email: string; contact_pref: string; sms_consent: boolean; promo_sms_consent: boolean; sms_opted_out_at: string | null; email_opted_out_at: string | null }>(
    "select id, name, status, phone, email, contact_pref, sms_consent, promo_sms_consent, sms_opted_out_at, email_opted_out_at from customers where portal_token = $1",
    [token],
  );
  if (!c || c.status === "declined") notFound();
  const today = todayLA();
  const { businessName } = getConfig();
  const [boats, upcoming, history, issues, addOns, requests] = await Promise.all([
    q<{ id: string; name: string; status: string; paused_until: string | null; marina_name: string | null; dock_name: string | null; slip: string; berth_type: string }>(
      `select b.id, b.name, b.status, b.paused_until, m.name as marina_name, d.name as dock_name, b.slip, b.berth_type
       from boats b left join marinas m on m.id = b.marina_id left join docks d on d.id = b.dock_id
       where b.customer_id = $1 and b.status <> 'sold' order by b.name`,
      [c.id],
    ),
    q<JobRow>(`${JOB_SELECT} where c.id = $1 and j.scheduled_date >= $2 and j.status in ('scheduled', 'in_progress', 'needs_reschedule')
       order by j.scheduled_date limit 8`, [c.id, today]),
    q<JobRow>(`${JOB_SELECT} where c.id = $1 and j.status in ('completed', 'partial', 'skipped') order by j.scheduled_date desc limit 20`, [c.id]),
    q<{ id: string; category: string; status: string; manager_note: string; quote_text: string; created_at: string; boat_name: string; photo: string | null }>(
      `select i.id, i.category, i.status, i.manager_note, i.quote_text, i.created_at, b.name as boat_name,
         (select p.pathname from photos p where p.client_id = i.photo_client_id) as photo
       from issues i join boats b on b.id = i.boat_id
       where b.customer_id = $1 and i.visibility = 'portal' and i.status <> 'dismissed' order by i.created_at desc`,
      [c.id],
    ),
    q<{ id: string; name: string; description: string; price_text: string }>(
      "select id, name, description, price_text from services where active and is_add_on order by sort, name",
    ),
    q<{ id: string; kind: string; status: string; created_at: string; decline_reason: string }>(
      "select id, kind, status, created_at, decline_reason from requests where customer_id = $1 order by created_at desc limit 5",
      [c.id],
    ),
  ]);

  return (
    <main className="page portal">
      <PortalRemember token={token} name={c.name} />
      <header className="top">
        <div className="eyebrow">{businessName} · Customer</div>
        <h1>Hi {c.name.split(" ")[0]}</h1>
        {c.status === "pending" && <p className="notice warn">Thanks for signing up. We&apos;re reviewing your details and will confirm your first cleaning.</p>}
      </header>
      <Notice ok={sp.ok} error={sp.error} />

      <section className="stack">
        <h2>Your boats</h2>
        {boats.map((b) => (
          <div key={b.id} className="card row">
            <div className="grow">
              <strong>{b.name}</strong>
              <div className="muted small">{locationText({ ...b, gate_name: null })}</div>
            </div>
            {b.status === "paused" && <Badge tone="warn">Paused{b.paused_until ? ` until ${fmtDay(b.paused_until)}` : ""}</Badge>}
          </div>
        ))}
      </section>

      <section className="stack">
        <h2>Flagged issues</h2>
        {issues.length === 0 ? (
          <p className="muted small">Our crews haven&apos;t flagged anything on your boat.</p>
        ) : (
          issues.map((i) => (
            <div key={i.id} className="card issue">
              {i.photo && (
                <a href={srcFor(i.photo)} target="_blank" rel="noreferrer" className="issue-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={srcFor(i.photo)} alt={i.category} />
                </a>
              )}
              <div className="stack grow">
                <div className="job-head">
                  <strong>{i.category}</strong>
                  <Badge tone={ISSUE_TONE[i.status]}>{ISSUE_TEXT[i.status]}</Badge>
                </div>
                <div className="muted small">{i.boat_name} · noted {fmtDateTime(i.created_at)}</div>
                {i.manager_note && <div className="small">{i.manager_note}</div>}
                {i.quote_text && <div className="small"><strong>Quote:</strong> {i.quote_text}</div>}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="stack">
        <h2>Upcoming cleanings</h2>
        {upcoming.length === 0 ? (
          <p className="muted small">Nothing scheduled right now.</p>
        ) : (
          upcoming.map((j) => (
            <div key={j.id} className="row-link static">
              <span><strong>{fmtDay(j.scheduled_date, { weekday: "long", month: "long", day: "numeric" })}</strong> · {j.boat_name}</span>
              <span className="muted small">{j.service_name ?? ""}</span>
            </div>
          ))
        )}
      </section>

      <section className="stack">
        <h2>Past cleanings</h2>
        {history.length === 0 ? (
          <p className="muted small">Your before and after photos will appear here.</p>
        ) : (
          history.map((j) => (
            j.status === "skipped" ? (
              <div key={j.id} className="row-link static">
                <span>{fmtDay(j.scheduled_date)} · {j.boat_name}</span>
                <span className="muted small">Not cleaned: {j.skip_reason}</span>
              </div>
            ) : (
              <Link key={j.id} href={`/j/${j.public_id}`} className="row-link">
                <span><strong>{fmtDay(j.scheduled_date)}</strong> · {j.boat_name}</span>
                <span className="small">{j.after_count} photo(s) ›</span>
              </Link>
            )
          ))
        )}
      </section>

      {c.status === "active" && boats.length > 0 && (
        <section className="stack" id="requests">
          <h2>Order extra services</h2>
          <form action={requestService} className="card stack">
            <input type="hidden" name="token" value={token} />
            {boats.length > 1 ? (
              <label className="field">
                <span>Boat</span>
                <select name="boat_id">{boats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              </label>
            ) : (
              <input type="hidden" name="boat_id" value={boats[0].id} />
            )}
            {addOns.map((s) => (
              <label key={s.id} className="option">
                <input type="checkbox" name="service_ids" value={s.id} />
                <span>
                  <strong>{s.name}</strong>{s.price_text ? ` · ${s.price_text}` : ""}
                  {s.description && <span className="muted small block">{s.description}</span>}
                </span>
              </label>
            ))}
            <label className="field">
              <span>Preferred date</span>
              <input type="date" name="preferred_date" min={today} defaultValue={addDays(today, 1)} />
            </label>
            <label className="field">
              <span>Anything we should know?</span>
              <textarea name="note" rows={2} placeholder="Taking friends out Saturday" />
            </label>
            <button className="btn primary">Send request</button>
            <p className="muted small">We confirm the date before booking it.</p>
          </form>

          <h2>Pause cleanings</h2>
          <form action={requestPause} className="card stack">
            <input type="hidden" name="token" value={token} />
            {boats.length > 1 ? (
              <label className="field">
                <span>Boat</span>
                <select name="boat_id">{boats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              </label>
            ) : (
              <input type="hidden" name="boat_id" value={boats[0].id} />
            )}
            <label className="field">
              <span>Pause until (leave blank if you&apos;re not sure)</span>
              <input type="date" name="until_date" min={today} />
            </label>
            <label className="field">
              <span>Reason</span>
              <input name="note" placeholder="Haul-out, cruising, away" />
            </label>
            <button className="btn">Request a pause</button>
          </form>

          {requests.length > 0 && (
            <ul className="plain-list small">
              {requests.map((r) => (
                <li key={r.id}>
                  {r.kind === "pause" ? "Pause" : "Service"} request · {fmtDateTime(r.created_at)} · {r.status === "pending" ? "waiting for confirmation" : r.status}
                  {r.decline_reason ? ` (${r.decline_reason})` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="stack" id="contact">
        <h2>How we contact you</h2>
        <form action={savePreferences} className="card stack">
          <input type="hidden" name="token" value={token} />
          <p className="muted small">On file: {c.phone || "no mobile number"} · {c.email || "no email"}. To change these, reply to any of our messages.</p>
          <label className="field">
            <span>Reminders, confirmations and photo links</span>
            <select name="contact_pref" defaultValue={c.contact_pref === "email" ? "email" : "text"}>
              <option value="text">Text me</option>
              <option value="email">Email me</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" name="sms_consent" defaultChecked={c.sms_consent && !c.sms_opted_out_at} />
            <span className="small">{SERVICE_SMS_WORDING}</span>
          </label>
          <label className="check">
            <input type="checkbox" name="promo_sms_consent" defaultChecked={c.promo_sms_consent && !c.sms_opted_out_at} />
            <span className="small">{MARKETING_SMS_WORDING}</span>
          </label>
          <label className="check">
            <input type="checkbox" name="email_news" defaultChecked={!c.email_opted_out_at} />
            <span className="small">Email me occasional offers and news. Untick to unsubscribe.</span>
          </label>
          <button className="btn">Save</button>
          <p className="muted small">You can also reply STOP to any text. <Link href="/sms-terms">Text messaging terms and privacy</Link>.</p>
        </form>
      </section>
      <Link href="/" className="manager-link">Switch role</Link>
    </main>
  );
}
