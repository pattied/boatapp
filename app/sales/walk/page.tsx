import Link from "next/link";
import { addPlace } from "../actions";
import WalkForm from "@/components/sales/WalkForm";
import { Badge, Empty, Notice } from "@/components/ui";
import { one, q } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { BOAT_TYPES, places, SLIP_ORDER, SPOTTED_SELECT, SPOT_STATUS, type Spotted } from "@/lib/sales";
import { requireSales } from "@/lib/session";
import { isLeadStage } from "@/lib/stages";

type SP = Promise<{ marina?: string; dock?: string; ok?: string; error?: string }>;

// Step 1: choose the marina and dock. Step 2: log each boat as you pass it.
export default async function Walk({ searchParams }: { searchParams: SP }) {
  await requireSales();
  const sp = await searchParams;
  const marina = isUuid(sp.marina ?? "") ? await one<{ id: string; name: string }>("select id, name from marinas where id = $1", [sp.marina]) : null;
  const dock = marina && isUuid(sp.dock ?? "") ? await one<{ id: string; name: string }>("select id, name from docks where id = $1 and marina_id = $2", [sp.dock, marina.id]) : null;

  if (!marina) {
    const { marinas, docks } = await places();
    return (
      <>
        <header className="top"><h1>Walk a dock</h1><p className="muted small">Choose where you are. Then log each boat as you pass it.</p></header>
        <Notice ok={sp.ok} error={sp.error} />
        {marinas.map((m) => {
          const ds = docks.filter((d) => d.marina_id === m.id);
          return (
            <section key={m.id} className="card stack">
              <h2>{m.name}</h2>
              <div className="chip-row">
                {ds.map((d) => <Link key={d.id} href={`/sales/walk?marina=${m.id}&dock=${d.id}`} className="chip">Dock {d.name}</Link>)}
                <Link href={`/sales/walk?marina=${m.id}`} className="chip quiet">No dock / moorings</Link>
              </div>
              <form action={addPlace} className="row wrap">
                <input type="hidden" name="marina_id" value={m.id} />
                <label className="field grow"><span>Another dock here</span><input name="dock_name" maxLength={40} placeholder="E" required /></label>
                <button className="btn small-btn">Add and start</button>
              </form>
            </section>
          );
        })}
        <p className="small"><Link href="/sales/marinas">Add a marina with its address and docks</Link>, or use the quick form below.</p>
        <form action={addPlace} className="card stack">
          <h2>A marina that is not listed</h2>
          <label className="field"><span>Marina name</span><input name="marina_name" maxLength={80} required placeholder="Schoonmaker Point Marina" /></label>
          <label className="field"><span>Dock (optional)</span><input name="dock_name" maxLength={40} placeholder="A" /></label>
          <button className="btn primary">Add and start</button>
          <p className="muted small">A manager adds gates and gate codes later. You only need the names.</p>
        </form>
      </>
    );
  }

  const [spotted, known] = await Promise.all([
    q<Spotted>(`${SPOTTED_SELECT} where s.marina_id = $1 and s.dock_id is not distinct from $2 order by ${SLIP_ORDER}`, [marina.id, dock?.id ?? null]),
    // Boats already on file at this dock. Names only: sales people do not see customers' contact details here.
    q<{ id: string; slip: string; name: string; status: string }>(
      `select s.id, s.slip, s.name, c.status from boats s join customers c on c.id = s.customer_id
       where s.marina_id = $1 and s.dock_id is not distinct from $2 and s.status <> 'sold' and c.status not in ('declined', 'inactive')
       order by ${SLIP_ORDER}`,
      [marina.id, dock?.id ?? null],
    ),
  ]);
  const customers = known.filter((k) => !isLeadStage(k.status));

  return (
    <>
      <header className="top">
        <div className="eyebrow">{marina.name}</div>
        <h1>{dock ? `Dock ${dock.name}` : "No dock / moorings"}</h1>
        <p className="muted small">{spotted.length} boat(s) logged here. <Link href="/sales/walk">Change dock</Link></p>
      </header>
      <Notice ok={sp.ok} error={sp.error} />
      <WalkForm marinaId={marina.id} dockId={dock?.id ?? ""} boatTypes={BOAT_TYPES} />

      {customers.length > 0 && (
        <section className="stack">
          <h2>Already customers on this dock</h2>
          <p className="muted small">No need to log these: {customers.map((k) => `${k.slip || "no slip"} ${k.name}`).join(", ")}.</p>
        </section>
      )}

      <section className="stack">
        <h2>Logged on this dock</h2>
        {spotted.length === 0 && <Empty>Nothing yet. Boats appear here as they upload.</Empty>}
        {spotted.map((b) => (
          <Link key={b.id} href={`/sales/boats/${b.id}`} className="thread-row">
            <div className="grow">
              <strong>{b.slip || "No slip"} · {b.boat_name || "Name not noted"}</strong>
              <div className="muted small clip">{[b.make_model, b.length_ft ? `${b.length_ft} ft` : "", b.condition].filter(Boolean).join(" · ") || "No details"}</div>
            </div>
            <Badge tone={b.status === "new" ? "warn" : b.status === "owner_added" ? "good" : "idle"}>{SPOT_STATUS[b.status]}</Badge>
          </Link>
        ))}
      </section>
    </>
  );
}
