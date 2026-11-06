import { one, q } from "@/lib/db";
import { failure, json, readJpeg } from "@/lib/http";
import { isUuid } from "@/lib/ids";
import { techSession } from "@/lib/session";
import { putJpeg, srcFor } from "@/lib/storage";

const KINDS = ["before", "after", "issue", "skip", "share"];

// One photo per request, sent as JPEG. The client id makes retries safe: the same photo
// lands at the same path and is recorded once.
export async function POST(req: Request) {
  const s = await techSession();
  if (!s) return json({ error: "Sign in again." }, 401);
  const h = req.headers;
  const clientId = h.get("x-client-id") ?? "";
  const jobId = h.get("x-job-id") ?? "";
  const kind = h.get("x-kind") ?? "";
  const slot = decodeURIComponent(h.get("x-slot") ?? "").slice(0, 40);
  const takenAt = h.get("x-taken-at") ?? "";
  if (!isUuid(clientId) || !isUuid(jobId) || !KINDS.includes(kind)) return json({ error: "Bad photo." }, 400);
  try {
    const existing = await one<{ pathname: string }>("select pathname from photos where client_id = $1", [clientId]);
    if (existing) return json({ ok: true, src: srcFor(existing.pathname), duplicate: true });
    const job = await one<{ public_id: string }>("select public_id from jobs where id = $1", [jobId]);
    if (!job) return json({ error: "That job no longer exists." }, 404);
    const jpeg = await readJpeg(req);
    if (typeof jpeg === "string") return json({ error: jpeg }, 400);
    const pathname = `jobs/${job.public_id}/${kind}/${clientId.replace(/-/g, "")}.jpg`;
    await putJpeg(pathname, jpeg);
    const taken = Number.isNaN(Date.parse(takenAt)) ? null : new Date(takenAt).toISOString();
    const row = await one<{ id: string }>(
      `insert into photos (job_id, kind, slot, pathname, client_id, taken_at, taken_by)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (client_id) do nothing returning id`,
      [jobId, kind, slot, pathname, clientId, taken, s.name],
    );
    // A retake replaces the earlier photo in the same slot (kept for the record, hidden from views).
    if (row && slot && ["before", "after"].includes(kind)) {
      await q(
        "update photos set replaced = true where job_id = $1 and kind = $2 and slot = $3 and id <> $4 and not replaced",
        [jobId, kind, slot, row.id],
      );
    }
    if (row && kind === "share") {
      await q("update photos set replaced = true where job_id = $1 and kind = 'share' and id <> $2 and not replaced", [jobId, row.id]);
    }
    return json({ ok: true, src: srcFor(pathname) }, 201);
  } catch (err) {
    return failure(err);
  }
}
