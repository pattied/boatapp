import Link from "next/link";
import { setStage } from "@/app/actions/stage";
import { Badge, Empty, Notice } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { q } from "@/lib/db";
import { requireSales } from "@/lib/session";
import { isLeadStage, MOVE_TARGETS, STAGE_HELP, STAGE_LABEL, STAGE_TONE } from "@/lib/stages";

type SP = Promise<{ q?: string; stage?: string; list?: string; ok?: string; error?: string }>;

// Everyone who is not a customer yet, by category, with bulk moves between categories.
export default async function Leads({ searchParams }: { searchParams: SP }) {
  const user = await requireSales();
  const sp = await searchParams;
  const term = (sp.q ?? "").trim().slice(0, 60);
  const list = (sp.list ?? "").trim().slice(0, 80);
  const stage = isLeadStage(sp.stage) ? sp.stage : sp.stage === "all" || list || term ? "all" : "prospect";
  const [counts, lists, rows] = await Promise.all([
    q<{ status: string; n: number }>("select status, count(*)::int as n from customers where status in ('prospect', 'lead', 'dnc') group by status"),
    q<{ list_name: string; n: number }>("select list_name, count(*)::int as n from customers where list_name <> '' and status in ('prospect', 'lead', 'dnc') group by list_name order by max(created_at) desc limit 30"),
    q<{ id: string; name: string; status: string; phone: string; email: string; interest: string; source: string; list_name: string; created_at: string; boats: string | null; open_notes: number }>(
      `select c.id, c.name, c.status, c.phone, c.email, c.interest, c.source, c.list_name, c.created_at,
         (select string_agg(b.name || coalesce(' (' || nullif(b.slip, '') || ')', ''), ', ') from boats b where b.customer_id = c.id) as boats,
         (select count(*)::int from customer_notes n where n.customer_id = c.id and n.done_at is null) as open_notes
       from customers c
       where (case when $2 = 'all' then c.status in ('prospect', 'lead', 'dnc') else c.status = $2 end)
         and ($3 = '' or c.list_name = $3)
         and ($1 = '' or c.name ilike '%' || $1 || '%' or c.phone ilike '%' || $1 || '%' or c.email ilike '%' || $1 || '%'
           or exists (select 1 from boats b where b.customer_id = c.id and (b.name ilike '%' || $1 || '%' or b.slip ilike '%' || $1 || '%')))
       order by c.last_name, c.first_name, c.name limit 300`,
      [term, stage, list],
    ),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const href = (o: { stage?: string; list?: string }) => {
    const p = new URLSearchParams();
    const st = o.stage ?? stage;
    const li = o.list ?? list;
    if (st !== "prospect") p.set("stage", st);
    if (li) p.set("list", li);
    if (term) p.set("q", term);
    const s = p.toString();
    return `/sales/leads${s ? `?${s}` : ""}`;
  };
  const back = href({});
  return (
    <>
      <header className="top">
        <h1>Leads</h1>
        <p className="muted small">People who are not customers yet. {stage !== "all" ? STAGE_HELP[stage] : ""}</p>
      </header>
      <Notice ok={sp.ok} error={sp.error} />
      <nav className="tabs">
        {(["prospect", "lead", "dnc"] as const).map((s) => (
          <Link key={s} href={href({ stage: s })} className={stage === s ? "on" : undefined}>{STAGE_LABEL[s]} ({n(s)})</Link>
        ))}
        <Link href={href({ stage: "all" })} className={stage === "all" ? "on" : undefined}>All ({n("prospect") + n("lead") + n("dnc")})</Link>
      </nav>
      <form className="row wrap" method="get">
        {stage !== "prospect" && <input type="hidden" name="stage" value={stage} />}
        <label className="field grow"><span>Search name, phone, email, boat or slip</span><input name="q" defaultValue={term} /></label>
        {lists.length > 0 && (
          <label className="field">
            <span>List</span>
            <select name="list" defaultValue={list}>
              <option value="">Every list</option>
              {lists.map((l) => <option key={l.list_name} value={l.list_name}>{l.list_name} ({l.n})</option>)}
            </select>
          </label>
        )}
        <button className="btn small-btn">Show</button>
      </form>
      <div className="btn-row">
        <Link href="/sales/leads/new" className="btn primary small-btn">New lead</Link>
        <Link href="/sales/import" className="btn small-btn">Import a list</Link>
      </div>

      {rows.length === 0 ? (
        <Empty>Nobody here{term || list ? " matches" : " yet"}.</Empty>
      ) : (
        <form action={setStage} className="stack">
          <input type="hidden" name="back" value={back} />
          <div className="card row wrap bulk-bar">
            <label className="field">
              <span>Move the ticked people to</span>
              <select name="stage" defaultValue="" required>
                <option value="" disabled>Choose…</option>
                {MOVE_TARGETS.filter(([v]) => v !== stage).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <button className="btn primary small-btn">Move</button>
            <span className="muted small">{rows.length} shown{rows.length === 300 ? " (first 300; narrow the search to see others)" : ""}.{stage === "dnc" && !user.manager ? " Only a manager can move someone out of do not contact." : ""}</span>
          </div>
          {rows.map((l) => (
            <div key={l.id} className="thread-row lead-row">
              <input type="checkbox" name="ids" value={l.id} aria-label={`Select ${l.name}`} />
              <Link href={`/sales/leads/${l.id}`} className="grow lead-link">
                <strong>{l.name}</strong>
                <div className="muted small clip">{[l.boats, l.phone, l.email, l.interest].filter(Boolean).join(" · ") || "No details yet"}</div>
              </Link>
              <div className="thread-meta small muted">
                {stage === "all" && <Badge tone={STAGE_TONE[l.status]}>{STAGE_LABEL[l.status]}</Badge>}
                {l.open_notes > 0 && <span>{l.open_notes} open note(s)</span>}
                <span>{l.list_name || l.source} · {fmtDateTime(l.created_at)}</span>
              </div>
            </div>
          ))}
        </form>
      )}
    </>
  );
}
