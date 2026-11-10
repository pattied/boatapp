import Link from "next/link";
import { Empty, Notice } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { q } from "@/lib/db";
import { requireSales } from "@/lib/session";

type SP = Promise<{ q?: string; ok?: string; error?: string }>;

export default async function Leads({ searchParams }: { searchParams: SP }) {
  await requireSales();
  const sp = await searchParams;
  const term = (sp.q ?? "").trim().slice(0, 60);
  const rows = await q<{ id: string; name: string; phone: string; email: string; interest: string; source: string; created_at: string; boats: string | null; open_notes: number }>(
    `select c.id, c.name, c.phone, c.email, c.interest, c.source, c.created_at,
       (select string_agg(b.name || coalesce(' (' || nullif(b.slip, '') || ')', ''), ', ') from boats b where b.customer_id = c.id) as boats,
       (select count(*)::int from customer_notes n where n.customer_id = c.id and n.done_at is null) as open_notes
     from customers c
     where c.status = 'prospect' and ($1 = '' or c.name ilike '%' || $1 || '%' or c.phone ilike '%' || $1 || '%' or c.email ilike '%' || $1 || '%'
       or exists (select 1 from boats b where b.customer_id = c.id and (b.name ilike '%' || $1 || '%' or b.slip ilike '%' || $1 || '%')))
     order by c.created_at desc limit 200`,
    [term],
  );
  return (
    <>
      <header className="top"><h1>Leads</h1><p className="muted small">People who are not customers yet. {rows.length} shown.</p></header>
      <Notice ok={sp.ok} error={sp.error} />
      <form className="row wrap" method="get">
        <label className="field grow"><span>Search name, phone, email, boat or slip</span><input name="q" defaultValue={term} /></label>
        <button className="btn small-btn">Search</button>
        <Link href="/sales/leads/new" className="btn primary small-btn">New lead</Link>
      </form>
      {rows.length === 0 && <Empty>No leads match.</Empty>}
      {rows.map((l) => (
        <Link key={l.id} href={`/sales/leads/${l.id}`} className="thread-row">
          <div className="grow">
            <strong>{l.name}</strong>
            <div className="muted small clip">{[l.boats, l.phone, l.email, l.interest].filter(Boolean).join(" · ") || "No details yet"}</div>
          </div>
          <div className="thread-meta small muted">
            {l.open_notes > 0 && <span>{l.open_notes} open note(s)</span>}
            <span>{l.source} · {fmtDateTime(l.created_at)}</span>
          </div>
        </Link>
      ))}
    </>
  );
}
