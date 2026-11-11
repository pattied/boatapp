import Link from "next/link";
import { addDocks, addMarina } from "../actions";
import { Notice } from "@/components/ui";
import { q } from "@/lib/db";
import { requireSales } from "@/lib/session";

type SP = Promise<{ ok?: string; error?: string }>;

// Sales people add marinas and docks by name. Gates and gate codes stay with the manager.
export default async function Marinas({ searchParams }: { searchParams: SP }) {
  await requireSales();
  const sp = await searchParams;
  const [marinas, docks] = await Promise.all([
    q<{ id: string; name: string; address: string; logged: number; leads: number }>(
      `select m.id, m.name, m.address,
         (select count(*)::int from spotted_boats s where s.marina_id = m.id) as logged,
         (select count(distinct b.customer_id)::int from boats b join customers c on c.id = b.customer_id where b.marina_id = m.id and c.status in ('prospect', 'lead')) as leads
       from marinas m order by m.name`,
    ),
    q<{ id: string; name: string; marina_id: string }>("select id, name, marina_id from docks order by name"),
  ]);
  return (
    <>
      <header className="top"><h1>Marinas</h1><p className="muted small">{marinas.length} marina(s). Add one before walking its docks or importing a list for it.</p></header>
      <Notice ok={sp.ok} error={sp.error} />
      <form action={addMarina} className="card stack">
        <h2>Add a marina</h2>
        <label className="field"><span>Name *</span><input name="name" required maxLength={80} placeholder="Schoonmaker Point Marina" /></label>
        <label className="field"><span>Address</span><input name="address" maxLength={200} placeholder="85 Liberty Ship Way, Sausalito" /></label>
        <label className="field"><span>Docks, separated by commas</span><input name="docks" maxLength={300} placeholder="A, B, C, D" /></label>
        <label className="field"><span>Notes</span><input name="notes" maxLength={500} placeholder="Harbormaster office by the ramp, guest parking in lot 2" /></label>
        <button className="btn primary">Add marina</button>
      </form>
      {marinas.map((m) => {
        const ds = docks.filter((d) => d.marina_id === m.id);
        return (
          <section key={m.id} className="card stack">
            <h2>{m.name}</h2>
            <p className="muted small">{m.address || "No address yet"} · {m.logged} boat(s) logged · {m.leads} lead(s)</p>
            <div className="chip-row">
              {ds.map((d) => <Link key={d.id} href={`/sales/walk?marina=${m.id}&dock=${d.id}`} className="chip">Dock {d.name}</Link>)}
              {ds.length === 0 && <span className="muted small">No docks listed yet.</span>}
            </div>
            <form action={addDocks} className="row wrap">
              <input type="hidden" name="marina_id" value={m.id} />
              <label className="field grow"><span>Add docks, separated by commas</span><input name="docks" maxLength={300} placeholder="E, F" required /></label>
              <button className="btn small-btn">Add</button>
            </form>
          </section>
        );
      })}
    </>
  );
}
