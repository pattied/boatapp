import Link from "next/link";
import { Badge, Empty, Notice } from "@/components/ui";
import { fmtDateTime, fmtDay, todayLA } from "@/lib/dates";
import { q } from "@/lib/db";
import { coverage, notesDue } from "@/lib/notes";
import { SPOTTED_SELECT, SPOT_STATUS, type Spotted } from "@/lib/sales";
import { requireSales } from "@/lib/session";

type SP = Promise<{ ok?: string; error?: string }>;

export default async function SalesHome({ searchParams }: { searchParams: SP }) {
  const user = await requireSales();
  const sp = await searchParams;
  const today = todayLA();
  const [counts, recentBoats, recentLeads, due] = await Promise.all([
    q<{ boats: number; fresh: number; leads: number }>(
      `select (select count(*)::int from spotted_boats) as boats,
              (select count(*)::int from spotted_boats where status = 'new') as fresh,
              (select count(*)::int from customers where status = 'prospect') as leads`,
    ),
    q<Spotted>(`${SPOTTED_SELECT} order by s.spotted_at desc limit 8`),
    q<{ id: string; name: string; phone: string; interest: string; created_at: string; boats: string | null }>(
      `select c.id, c.name, c.phone, c.interest, c.created_at,
         (select string_agg(b.name, ', ') from boats b where b.customer_id = c.id) as boats
       from customers c where c.status = 'prospect' order by c.created_at desc limit 8`,
    ),
    notesDue(today, 14),
  ]);
  const leadNotes = due.filter((n) => n.customer_status === "prospect");
  const c = counts[0];
  return (
    <>
      <header className="top">
        <h1>Sales</h1>
        <p className="muted small">{c.boats} boat(s) logged on docks, {c.fresh} not yet followed up. {c.leads} lead(s).</p>
      </header>
      <Notice ok={sp.ok} error={sp.error} />
      <div className="sales-actions">
        <Link href="/sales/walk" className="btn primary big-btn">Walk a dock</Link>
        <Link href="/sales/leads/new" className="btn big-btn">New lead (call or walk-up)</Link>
      </div>

      {leadNotes.length > 0 && (
        <section className="stack">
          <h2>Lead follow-ups coming up</h2>
          {leadNotes.map((n) => (
            <Link key={n.id} href={`/sales/leads/${n.customer_id}#notes`} className="thread-row">
              <div className="grow">
                <strong>{n.customer_name}</strong>
                <div className="small clip2">{n.body}</div>
              </div>
              <Badge tone="warn">{fmtDay(n.needed_by!, { month: "short", day: "numeric" })}</Badge>
            </Link>
          ))}
        </section>
      )}

      <section className="stack">
        <h2>Recently logged boats</h2>
        {recentBoats.length === 0 && <Empty>No boats logged yet. Start with Walk a dock.</Empty>}
        {recentBoats.map((b) => (
          <Link key={b.id} href={`/sales/boats/${b.id}`} className="thread-row">
            <div className="grow">
              <strong>{b.slip || "No slip"} · {b.boat_name || "Name not noted"}</strong>
              <div className="muted small clip">{b.marina_name}{b.dock_name ? ` · Dock ${b.dock_name}` : ""}{b.condition ? ` · ${b.condition}` : ""}</div>
            </div>
            <div className="thread-meta small muted">
              <Badge tone={b.status === "new" ? "warn" : b.status === "owner_added" ? "good" : "idle"}>{SPOT_STATUS[b.status]}</Badge>
              <span>{b.spotted_by === user.name ? "You" : b.spotted_by} · {fmtDateTime(b.spotted_at)}</span>
            </div>
          </Link>
        ))}
      </section>

      <section className="stack">
        <h2>Newest leads</h2>
        {recentLeads.length === 0 && <Empty>No leads yet.</Empty>}
        {recentLeads.map((l) => (
          <Link key={l.id} href={`/sales/leads/${l.id}`} className="thread-row">
            <div className="grow">
              <strong>{l.name}</strong>
              <div className="muted small clip">{[l.boats, l.interest, l.phone].filter(Boolean).join(" · ") || "No details yet"}</div>
            </div>
            <span className="small muted">{fmtDateTime(l.created_at)}</span>
          </Link>
        ))}
        <Link href="/sales/leads" className="btn">All leads</Link>
      </section>
    </>
  );
}
