import Link from "next/link";
import { updateIssue } from "../actions";
import { Badge, Empty, Notice, PageHead, Submit } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { q } from "@/lib/db";
import { srcFor } from "@/lib/storage";
import { requireManager } from "@/lib/session";

type SP = Promise<{ status?: string; open?: string; ok?: string; error?: string }>;

const TABS = [
  ["open", "Open"],
  ["quoted", "Quoted"],
  ["resolved", "Resolved"],
  ["dismissed", "Dismissed"],
] as const;

export default async function Issues({ searchParams }: { searchParams: SP }) {
  await requireManager();
  const sp = await searchParams;
  const status = TABS.some(([k]) => k === sp.status) ? sp.status! : "open";
  const [issues, counts] = await Promise.all([
    q<{
      id: string; category: string; severity: string; found: string; visibility: string; status: string; note: string;
      manager_note: string; quote_text: string; reported_by: string; created_at: string; boat_name: string;
      customer_id: string; customer_name: string; job_id: string | null; photo: string | null;
    }>(
      `select i.*, b.name as boat_name, c.id as customer_id, c.name as customer_name,
         (select p.pathname from photos p where p.client_id = i.photo_client_id) as photo
       from issues i join boats b on b.id = i.boat_id join customers c on c.id = b.customer_id
       where i.status = $1 order by i.severity = 'urgent' desc, i.created_at desc`,
      [status],
    ),
    q<{ status: string; n: number }>("select status, count(*)::int as n from issues group by status"),
  ]);
  const n = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const back = `/manager/issues?status=${status}`;
  return (
    <>
      <PageHead title="Flagged issues" sub="Issues marked for the portal appear on the customer's portal page; they are never texted." />
      <Notice ok={sp.ok} error={sp.error} />
      <div className="pills">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/manager/issues?status=${k}`} className={`pill ${k === status ? "on" : ""}`}>
            {label} ({n[k] ?? 0})
          </Link>
        ))}
      </div>
      {issues.length === 0 && <Empty>No {status} issues.</Empty>}
      {issues.map((i) => (
        <form key={i.id} action={updateIssue} className={`card issue ${sp.open === i.id ? "focus" : ""}`} id={i.id}>
          <input type="hidden" name="id" value={i.id} />
          <input type="hidden" name="back" value={back} />
          {i.photo && (
            <a href={srcFor(i.photo)} target="_blank" rel="noreferrer" className="issue-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={srcFor(i.photo)} alt={i.category} />
            </a>
          )}
          <div className="stack grow">
            <div className="job-head">
              <strong>{i.category}</strong>
              <span className="row">
                {i.severity === "urgent" && <Badge tone="bad">Urgent</Badge>}
                <Badge tone={i.visibility === "internal" ? "idle" : "good"}>{i.visibility === "internal" ? "Internal only" : "On portal"}</Badge>
              </span>
            </div>
            <div className="small">
              <Link href={`/manager/customers/${i.customer_id}`}>{i.boat_name} · {i.customer_name}</Link> · reported by {i.reported_by || "manager"} ·{" "}
              {fmtDateTime(i.created_at)} · found {i.found === "before" ? "before work" : "during or after work"}
              {i.job_id && <> · <Link href={`/manager/jobs/${i.job_id}`}>visit</Link></>}
            </div>
            {i.note && <div className="small">Technician: {i.note}</div>}
            <label className="field wide"><span>Note to customer</span><textarea name="manager_note" defaultValue={i.manager_note} rows={2} /></label>
            <label className="field wide"><span>Quote (shown on the portal)</span><input name="quote_text" defaultValue={i.quote_text} placeholder="Replace stanchion base: $240, or referral to a rigger" /></label>
            <div className="row wrap">
              <select name="visibility" defaultValue={i.visibility} aria-label="Visibility">
                <option value="portal">Show on customer portal</option>
                <option value="internal">Internal only</option>
              </select>
              <select name="status" defaultValue={i.status} aria-label="Status">
                <option value="open">Open</option>
                <option value="quoted">Quoted</option>
                <option value="resolved">Resolved</option>
                <option value="dismissed">Dismissed</option>
              </select>
              <Submit>Save</Submit>
            </div>
          </div>
        </form>
      ))}
    </>
  );
}
