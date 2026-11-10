import { notFound } from "next/navigation";
import { addDock, addGate, deleteDock, deleteGate, updateDock, updateGate, updateMarina, deleteMarina } from "../../actions";
import { DeleteForm, Field, Notice, PageHead, Submit } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { one, q } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { requireManager } from "@/lib/session";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function MarinaDetail({ params, searchParams }: Props) {
  await requireManager();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const m = await one<{ id: string; name: string; address: string; notes: string }>("select * from marinas where id = $1", [id]);
  if (!m) notFound();
  const [gates, docks, history] = await Promise.all([
    q<{ id: string; name: string; code: string; notes: string; updated_at: string; boats: number }>(
      `select g.*, (select count(*)::int from boats b left join docks d on d.id = b.dock_id
         where coalesce(b.gate_id, d.gate_id) = g.id and b.status <> 'sold') as boats
       from gates g where marina_id = $1 order by name`,
      [id],
    ),
    q<{ id: string; name: string; gate_id: string | null; boats: number }>(
      `select d.*, (select count(*)::int from boats b where b.dock_id = d.id and b.status <> 'sold') as boats
       from docks d where marina_id = $1 order by name`,
      [id],
    ),
    q<{ at: string; actor: string; entity_id: string; detail: { from: string; to: string; note?: string } }>(
      `select at, actor, entity_id, detail from audit_log where entity = 'gate' and action = 'change_code'
         and entity_id in (select id::text from gates where marina_id = $1) order by at desc limit 30`,
      [id],
    ),
  ]);
  const back = `/manager/marinas/${id}`;
  const gateName = (gid: string) => gates.find((g) => g.id === gid)?.name ?? "Removed gate";

  return (
    <>
      <PageHead title={m.name} sub={m.address || "No address"} />
      <Notice ok={sp.ok} error={sp.error} />

      <section className="card stack">
        <h2>Gates</h2>
        {gates.length === 0 && <p className="muted small">No gates yet.</p>}
        {gates.map((g) => (
          <form key={g.id} action={updateGate} className="row wrap">
            <input type="hidden" name="id" value={g.id} />
            <input type="hidden" name="back" value={back} />
            <Field label="Gate" name="name" defaultValue={g.name} />
            <Field label="Code" name="code" defaultValue={g.code} />
            <Field label="Why the code changed" name="change_note" placeholder="Marina rotated codes" />
            <span className="muted small">{g.boats} boat(s)</span>
            <Submit tone="plain">Save</Submit>
            <Submit tone="quiet" formAction={deleteGate}>Remove</Submit>
          </form>
        ))}
        <form action={addGate} className="row wrap">
          <input type="hidden" name="marina_id" value={id} />
          <input type="hidden" name="back" value={back} />
          <Field label="New gate" name="name" placeholder="Gate 3" />
          <Field label="Code" name="code" />
          <Submit>Add gate</Submit>
        </form>
      </section>

      <section className="card stack">
        <h2>Docks</h2>
        {docks.length === 0 && <p className="muted small">No docks yet. Each dock can have a default gate.</p>}
        {docks.map((d) => (
          <form key={d.id} action={updateDock} className="row wrap">
            <input type="hidden" name="id" value={d.id} />
            <input type="hidden" name="back" value={back} />
            <Field label="Dock" name="name" defaultValue={d.name} />
            <label className="field">
              <span>Gate</span>
              <select name="gate_id" defaultValue={d.gate_id ?? ""}>
                <option value="">No gate</option>
                {gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <span className="muted small">{d.boats} boat(s)</span>
            <Submit tone="plain">Save</Submit>
            <Submit tone="quiet" formAction={deleteDock}>Remove</Submit>
          </form>
        ))}
        <form action={addDock} className="row wrap">
          <input type="hidden" name="marina_id" value={id} />
          <input type="hidden" name="back" value={back} />
          <Field label="New dock" name="name" placeholder="C" />
          <label className="field">
            <span>Gate</span>
            <select name="gate_id" defaultValue="">
              <option value="">No gate</option>
              {gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <Submit>Add dock</Submit>
        </form>
      </section>

      <section className="card stack">
        <h2>Gate code history</h2>
        {history.length === 0 && <p className="muted small">No code changes recorded yet.</p>}
        <ul className="plain-list small">
          {history.map((h, i) => (
            <li key={i}>
              {fmtDateTime(h.at)} · {gateName(h.entity_id)}: {h.detail.from || "(none)"} → {h.detail.to || "(none)"}
              {h.detail.note ? ` · ${h.detail.note}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <form action={updateMarina} className="card form-grid">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="back" value={back} />
        <h2 className="wide">Marina details</h2>
        <Field label="Name" name="name" defaultValue={m.name} required />
        <Field label="Address" name="address" defaultValue={m.address} />
        <label className="field wide"><span>Notes</span><textarea name="notes" defaultValue={m.notes} rows={3} /></label>
        <div className="wide"><Submit>Save marina</Submit></div>
      </form>
      <details className="danger-zone"><summary>Delete this marina</summary><DeleteForm action={deleteMarina} id={id} back={back} label="Delete marina" warning="Removes the marina with its gates and docks. Only possible when no boats are at this marina." /></details>
    </>
  );
}
