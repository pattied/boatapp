import { addNote, deleteNote, setNoteDone } from "@/app/actions/notes";
import { Badge } from "@/components/ui";
import { fmtDay, fmtDateTime } from "@/lib/dates";
import { coverage, type Note } from "@/lib/notes";

// Notes and follow-ups for one customer. Used on the manager's customer page and the sales lead page.
export default function NotesCard({ customerId, notes, boats, back, today, jobLink }: {
  customerId: string;
  notes: Note[];
  boats: { id: string; name: string }[];
  back: string;
  today: string;
  jobLink?: string; // where "schedule a cleaning" should go, managers only
}) {
  const open = notes.filter((n) => !n.done_at);
  const done = notes.filter((n) => n.done_at);
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const row = (n: Note) => {
    const cov = coverage(n, today, (d) => fmtDay(d, { weekday: "short", month: "short", day: "numeric" }));
    return (
      <div key={n.id} className={`note${n.done_at ? " done" : ""}`}>
        <div className="note-body">{n.body}</div>
        <div className="muted small">
          {n.boat_name ? `${n.boat_name} · ` : ""}
          {n.created_by || "staff"} · {fmtDateTime(n.created_at)}
          {n.done_at ? ` · done ${fmtDateTime(n.done_at)}${n.done_by ? ` by ${n.done_by}` : ""}` : ""}
        </div>
        {n.needed_by && !n.done_at && (
          <div className="small">
            <Badge tone={cov?.tone ?? "idle"}>Clean by {fmtDay(n.needed_by, { weekday: "short", month: "short", day: "numeric" })}</Badge>{" "}
            <span className={cov?.tone === "bad" ? "warn-text" : "muted"}>{cov?.text}</span>
            {cov?.tone !== "good" && jobLink && <> <a href={jobLink}>Schedule a cleaning</a></>}
          </div>
        )}
        <form action={setNoteDone} className="btn-row tight">
          {hidden("id", n.id)}
          {hidden("back", back)}
          {n.done_at ? <button className="linkish" name="op" value="reopen">Reopen</button> : <button className="linkish" name="op" value="done">Mark done</button>}
          <button className="linkish" formAction={deleteNote}>Delete</button>
        </form>
      </div>
    );
  };
  return (
    <section className="card stack" id="notes">
      <h2>Notes and follow-ups{open.length ? ` (${open.length} open)` : ""}</h2>
      <form action={addNote} className="stack">
        {hidden("customer_id", customerId)}
        {hidden("back", back)}
        <label className="field">
          <span>What did the customer tell us?</span>
          <textarea name="body" rows={2} maxLength={2000} required placeholder="Racing in the Midwinters on the 21st. Family arriving for Thanksgiving." />
        </label>
        <div className="row wrap">
          <label className="field">
            <span>Boat must be clean by (optional)</span>
            <input type="date" name="needed_by" min={today} />
          </label>
          {boats.length > 1 && (
            <label className="field">
              <span>Boat</span>
              <select name="boat_id" defaultValue="">
                <option value="">All their boats</option>
                {boats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          <button className="btn primary small-btn">Save note</button>
        </div>
      </form>
      {open.map(row)}
      {done.length > 0 && (
        <details>
          <summary className="small muted">{done.length} finished note(s)</summary>
          <div className="stack">{done.map(row)}</div>
        </details>
      )}
    </section>
  );
}
