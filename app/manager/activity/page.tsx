import { PageHead } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { q } from "@/lib/db";
import { requireManager } from "@/lib/session";

export default async function Activity() {
  await requireManager();
  const rows = await q<{ at: string; actor: string; action: string; entity: string; entity_id: string | null; detail: Record<string, unknown> }>(
    "select at, actor, action, entity, entity_id, detail from audit_log order by at desc limit 250",
  );
  return (
    <>
      <PageHead title="Activity" sub="Who changed what, newest first. Includes gate code changes, schedule edits and technician work." />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{fmtDateTime(r.at)}</td>
                <td>{r.actor}</td>
                <td>{r.action.replace(/_/g, " ")} {r.entity}</td>
                <td className="small muted">{Object.entries(r.detail ?? {}).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ").slice(0, 200)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
