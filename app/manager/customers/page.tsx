import Link from "next/link";
import { Badge, Empty, Notice, PageHead } from "@/components/ui";
import { fmtDay } from "@/lib/dates";
import { q } from "@/lib/db";

type SP = Promise<{ q?: string; status?: string; ok?: string; error?: string }>;

const TONE: Record<string, string> = { active: "good", pending: "warn", paused: "warn", inactive: "idle", declined: "idle" };

export default async function Customers({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const term = (sp.q ?? "").trim();
  const status = ["active", "pending", "inactive", "declined"].includes(sp.status ?? "") ? sp.status! : "";
  const rows = await q<{
    id: string;
    name: string;
    phone: string;
    status: string;
    boats: string | null;
    next_visit: string | null;
    open_issues: number;
  }>(
    `select c.id, c.name, c.phone, c.status,
       (select string_agg(b.name || coalesce(' · ' || m.name, '') || case when b.slip <> '' then ' ' || b.slip else '' end, ', ' order by b.name)
          from boats b left join marinas m on m.id = b.marina_id where b.customer_id = c.id and b.status <> 'sold') as boats,
       (select min(j.scheduled_date) from jobs j join boats b on b.id = j.boat_id
          where b.customer_id = c.id and j.status = 'scheduled' and j.scheduled_date >= current_date) as next_visit,
       (select count(*)::int from issues i join boats b on b.id = i.boat_id where b.customer_id = c.id and i.status in ('open', 'quoted')) as open_issues
     from customers c
     where ($1 = '' or c.name ilike '%' || $1 || '%' or c.phone ilike '%' || $1 || '%'
            or exists (select 1 from boats b where b.customer_id = c.id and b.name ilike '%' || $1 || '%'))
       and ($2 = '' or c.status = $2)
     order by c.status = 'pending' desc, c.name`,
    [term, status],
  );
  return (
    <>
      <PageHead title="Customers" sub={`${rows.length} shown`}>
        <Link className="btn primary" href="/manager/customers/new">New customer</Link>
      </PageHead>
      <Notice ok={sp.ok} error={sp.error} />
      <form className="toolbar" method="get">
        <input className="search" name="q" defaultValue={term} placeholder="Search name, phone or boat" />
        <select name="status" defaultValue={status} className="search narrow">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="pending">Pending sign-up</option>
          <option value="inactive">Inactive</option>
          <option value="declined">Declined</option>
        </select>
        <button className="btn">Search</button>
      </form>
      {rows.length === 0 && <Empty>No customers yet. Add one, or share the sign-up page.</Empty>}
      <div className="job-grid">
        {rows.map((c) => (
          <Link key={c.id} href={`/manager/customers/${c.id}`} className="card job-card link-card">
            <div className="job-head">
              <strong>{c.name}</strong>
              <Badge tone={TONE[c.status] ?? "idle"}>{c.status === "pending" ? "Pending sign-up" : c.status}</Badge>
            </div>
            <div className="muted small">{c.boats ?? "No boats"}</div>
            <div className="small">
              {c.next_visit ? `Next visit ${fmtDay(c.next_visit)}` : "No upcoming visit"}
              {c.open_issues ? ` · ${c.open_issues} open issue(s)` : ""}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
