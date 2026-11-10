import { applyEvent, crewAccess, markOtherCrewWork, type CrewEvent } from "@/lib/crew";
import { after } from "next/server";
import { one } from "@/lib/db";
import { failure, json } from "@/lib/http";
import { baseUrl } from "@/lib/messaging/providers";
import { deliverDue, notifySafely } from "@/lib/messaging/send";
import { isUuid } from "@/lib/ids";
import { techSession } from "@/lib/session";

const TYPES = ["start", "complete", "skip", "flag"];

export async function POST(req: Request) {
  const s = await techSession();
  if (!s) return json({ error: "Sign in again." }, 401);
  try {
    const ev = (await req.json().catch(() => null)) as CrewEvent | null;
    if (!ev || !isUuid(ev.clientId) || !isUuid(ev.jobId) || !TYPES.includes(ev.type)) {
      return json({ error: "Bad event." }, 400);
    }
    const access = await crewAccess(s.techId, ev.jobId);
    if (access === "inactive") return json({ error: "Your technician profile is inactive. Ask your manager." }, 401);
    if (access === "missing") return json({ error: "That job no longer exists." }, 404);
    if (access === "deny") return json({ error: "That job belongs to another crew." }, 403);
    const result = await applyEvent(s, ev);
    if (access === "review" && result === "applied") await markOtherCrewWork(ev.jobId, s.name);
    // Tell the customer, after the technician's phone has its answer. Flags are never sent to customers.
    if (result === "applied" && (ev.type === "complete" || ev.type === "skip")) {
      after(async () => {
        const j = await one<{ customer_id: string; public_id: string; status: string }>(
          "select b.customer_id, j.public_id, j.status from jobs j join boats b on b.id = j.boat_id where j.id = $1",
          [ev.jobId],
        );
        if (!j) return;
        if (ev.type === "complete" && ["completed", "partial"].includes(j.status)) {
          await notifySafely("photos_ready", { customerId: j.customer_id, jobId: ev.jobId, vars: { link: `${baseUrl()}/j/${j.public_id}` }, dedupeKey: `photos:${ev.jobId}` });
        } else if (ev.type === "skip" && j.status === "skipped") {
          await notifySafely("visit_skipped", { customerId: j.customer_id, jobId: ev.jobId, dedupeKey: `skipped:${ev.jobId}` });
        }
        await deliverDue();
      });
    }
    if (result === "missing") return json({ error: "That job no longer exists." }, 404);
    return json({ ok: true, result });
  } catch (err) {
    return failure(err);
  }
}
