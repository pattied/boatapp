import { applyEvent, type CrewEvent } from "@/lib/crew";
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
    const result = await applyEvent(s, ev);
    if (result === "missing") return json({ error: "That job no longer exists." }, 404);
    return json({ ok: true, result });
  } catch (err) {
    return failure(err);
  }
}
