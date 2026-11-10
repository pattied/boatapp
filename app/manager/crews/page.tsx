import { createCrew, createTechnician, deleteCrew, deleteTechnician, updateCrew, updateTechnician } from "../actions";
import { DeleteForm, Field, Notice, PageHead, Submit } from "@/components/ui";
import { addDays, todayLA } from "@/lib/dates";
import { q } from "@/lib/db";
import { requireManager } from "@/lib/session";

type SP = Promise<{ ok?: string; error?: string }>;

export default async function Crews({ searchParams }: { searchParams: SP }) {
  await requireManager();
  const sp = await searchParams;
  const today = todayLA();
  const [crews, techs] = await Promise.all([
    q<{ id: string; name: string; active: boolean; week_jobs: number; today_jobs: number }>(
      `select c.*, (select count(*)::int from jobs j where j.crew_id = c.id and j.scheduled_date between $1 and $2 and j.status <> 'cancelled') as week_jobs,
         (select count(*)::int from jobs j where j.crew_id = c.id and j.scheduled_date = $1 and j.status <> 'cancelled') as today_jobs
       from crews c order by c.active desc, c.name`,
      [today, addDays(today, 6)],
    ),
    q<{ id: string; name: string; crew_id: string | null; active: boolean; last_seen: string | null }>(
      `select t.*, (select max(e.received_at) from crew_events e where e.by_name = t.name) as last_seen
       from technicians t order by t.active desc, t.name`,
    ),
  ]);
  const back = "/manager/crews";
  return (
    <>
      <PageHead title="Crews and technicians" sub="Jobs are assigned to a crew. A one-person crew works for a single technician." />
      <Notice ok={sp.ok} error={sp.error} />
      <section className="card stack">
        <h2>Crews</h2>
        {crews.map((c) => (
          <div key={c.id} className="stack tight">
          <form action={updateCrew} className="row wrap">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="back" value={back} />
            <Field label="Crew" name="name" defaultValue={c.name} />
            <label className="check"><input type="checkbox" name="active" defaultChecked={c.active} /> <span>Active</span></label>
            <span className="muted small">{c.today_jobs} today · {c.week_jobs} this week · {techs.filter((t) => t.crew_id === c.id && t.active).map((t) => t.name).join(", ") || "no technicians"}</span>
            <Submit tone="plain">Save</Submit>
          </form>
          <details className="danger-zone"><summary>Delete crew</summary><DeleteForm action={deleteCrew} id={c.id} back={back} label={`Delete ${c.name}`} warning="Its visits and plans become unassigned and appear on Needs attention. Untick Active instead to keep its history." /></details>
          </div>
        ))}
        <form action={createCrew} className="row wrap">
          <input type="hidden" name="back" value={back} />
          <Field label="New crew" name="name" placeholder="Crew 1 or a technician's name" />
          <Submit>Add crew</Submit>
        </form>
      </section>

      <section className="card stack">
        <h2>Technicians</h2>
        <p className="muted small">Technicians sign in with the technician passcode and pick their name. They see their crew&apos;s jobs.</p>
        {techs.map((t) => (
          <div key={t.id} className="stack tight">
          <form action={updateTechnician} className="row wrap">
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="back" value={back} />
            <Field label="Name" name="name" defaultValue={t.name} />
            <label className="field">
              <span>Crew</span>
              <select name="crew_id" defaultValue={t.crew_id ?? ""}>
                <option value="">No crew</option>
                {crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="check"><input type="checkbox" name="active" defaultChecked={t.active} /> <span>Active</span></label>
            <span className="muted small">{t.last_seen ? `Last activity ${new Date(t.last_seen).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "No activity yet"}</span>
            <Submit tone="plain">Save</Submit>
          </form>
          <details className="danger-zone"><summary>Delete technician</summary><DeleteForm action={deleteTechnician} id={t.id} back={back} label={`Delete ${t.name}`} warning="Their past work stays on each visit. Untick Active instead if they may come back." /></details>
          </div>
        ))}
        <form action={createTechnician} className="row wrap">
          <input type="hidden" name="back" value={back} />
          <Field label="New technician" name="name" />
          <label className="field">
            <span>Crew</span>
            <select name="crew_id" defaultValue="">
              <option value="">No crew</option>
              {crews.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <Submit>Add technician</Submit>
        </form>
      </section>
    </>
  );
}
