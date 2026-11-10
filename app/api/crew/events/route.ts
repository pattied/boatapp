import { applyEvent, crewAccess, markOtherCrewWork, type CrewEvent } from "@/lib/crew";
import { failure, json } from "@/lib/http";
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
    if (result === "missing") return json({ error: "That job no longer exists." }, 404);
    return json({ ok: true, result });
  } catch (err) {
    return failure(err);
  }
}
