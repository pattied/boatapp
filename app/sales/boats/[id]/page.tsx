import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteSpotted, updateSpotted } from "../../actions";
import { DeleteForm, Notice } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { one } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { BOAT_TYPES, SPOTTED_SELECT, SPOT_STATUS, type Spotted } from "@/lib/sales";
import { requireSales } from "@/lib/session";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function SpottedBoat({ params, searchParams }: Props) {
  const user = await requireSales();
  const { id } = await params;
  const sp = await searchParams;
  const b = isUuid(id) ? await one<Spotted>(`${SPOTTED_SELECT} where s.id = $1`, [id]) : null;
  if (!b) notFound();
  const walk = `/sales/walk?marina=${b.marina_id}${b.dock_id ? `&dock=${b.dock_id}` : ""}`;
  return (
    <>
      <header className="top">
        <div className="eyebrow">{b.marina_name}{b.dock_name ? ` · Dock ${b.dock_name}` : ""}</div>
        <h1>{b.slip || "No slip"} · {b.boat_name || "Name not noted"}</h1>
        <p className="muted small">Logged by {b.spotted_by || "staff"} on {fmtDateTime(b.spotted_at)}. <Link href={walk}>Back to this dock</Link></p>
      </header>
      <Notice ok={sp.ok} error={sp.error} />

      {b.customer_id ? (
        <section className="card stack">
          <h2>Owner</h2>
          <p>{b.customer_name}</p>
          <Link href={`/sales/leads/${b.customer_id}`} className="btn">Open {b.customer_name}</Link>
        </section>
      ) : (
        <section className="card stack">
          <h2>Owner not known yet</h2>
          <p className="muted small">When you learn who owns this boat, add them as a lead. The boat&apos;s details carry over.</p>
          <Link href={`/sales/leads/new?boat=${b.id}`} className="btn primary">Add the owner</Link>
        </section>
      )}

      <form action={updateSpotted} className="card stack">
        <h2>Boat details</h2>
        <input type="hidden" name="id" value={b.id} />
        <div className="two">
          <label className="field"><span>Slip</span><input name="slip" defaultValue={b.slip} maxLength={20} /></label>
          <label className="field"><span>Boat name</span><input name="boat_name" defaultValue={b.boat_name} maxLength={80} /></label>
        </div>
        <div className="two">
          <label className="field"><span>Make and model</span><input name="make_model" defaultValue={b.make_model} maxLength={80} /></label>
          <label className="field"><span>Length (ft)</span><input name="length_ft" defaultValue={b.length_ft ?? ""} inputMode="numeric" maxLength={3} /></label>
        </div>
        <label className="field">
          <span>Type</span>
          <select name="boat_type" defaultValue={b.boat_type}>
            <option value="">Not noted</option>
            {BOAT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field"><span>What you noticed</span><textarea name="condition" rows={2} maxLength={500} defaultValue={b.condition} /></label>
        <label className="field">
          <span>Status</span>
          {b.status === "owner_added" ? (
            <input value="Owner added" readOnly />
          ) : (
            <select name="status" defaultValue={b.status}>
              {Object.entries(SPOT_STATUS).filter(([k]) => k !== "owner_added").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </label>
        <button className="btn primary">Save</button>
      </form>

      {(user.manager || b.spotted_by === user.name) && (
        <details className="danger-zone">
          <summary>Delete this boat record</summary>
          <DeleteForm action={deleteSpotted} id={b.id} back={`/sales/boats/${b.id}`} label="Delete record" warning="Removes this dock-walk record only. A lead created from it is kept." />
        </details>
      )}
    </>
  );
}
