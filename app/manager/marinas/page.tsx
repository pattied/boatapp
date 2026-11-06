import Link from "next/link";
import { createMarina } from "../actions";
import { Empty, Field, Notice, PageHead, Submit } from "@/components/ui";
import { q } from "@/lib/db";

type SP = Promise<{ ok?: string; error?: string }>;

export default async function Marinas({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const marinas = await q<{ id: string; name: string; address: string; gates: number; docks: number; boats: number }>(
    `select m.id, m.name, m.address,
       (select count(*)::int from gates g where g.marina_id = m.id) as gates,
       (select count(*)::int from docks d where d.marina_id = m.id) as docks,
       (select count(*)::int from boats b where b.marina_id = m.id and b.status <> 'sold') as boats
     from marinas m order by m.name`,
  );
  return (
    <>
      <PageHead title="Marinas and gates" sub="Gate codes live on the gate, so one change updates every boat behind it." />
      <Notice ok={sp.ok} error={sp.error} />
      {marinas.length === 0 && <Empty>No marinas yet. Add the first one below.</Empty>}
      <div className="job-grid">
        {marinas.map((m) => (
          <Link key={m.id} href={`/manager/marinas/${m.id}`} className="card job-card link-card">
            <strong>{m.name}</strong>
            <span className="muted small">{m.address || "No address"}</span>
            <span className="small">{m.gates} gate(s) · {m.docks} dock(s) · {m.boats} boat(s)</span>
          </Link>
        ))}
      </div>
      <form action={createMarina} className="card form-grid">
        <input type="hidden" name="back" value="/manager/marinas" />
        <h2 className="wide">Add a marina</h2>
        <Field label="Name" name="name" required placeholder="Clipper Yacht Harbor" />
        <Field label="Address" name="address" />
        <label className="field wide"><span>Notes (check-in rules, parking, soap rules)</span><textarea name="notes" rows={2} /></label>
        <div className="wide"><Submit>Add marina</Submit></div>
      </form>
    </>
  );
}
