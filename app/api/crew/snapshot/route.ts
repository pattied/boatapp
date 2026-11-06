import { buildSnapshot } from "@/lib/crew";
import { failure, json } from "@/lib/http";
import { techSession } from "@/lib/session";

export async function GET() {
  const s = await techSession();
  if (!s) return json({ error: "Sign in again." }, 401);
  try {
    const snap = await buildSnapshot(s.techId);
    if (!snap) return json({ error: "Your technician profile is inactive. Ask your manager." }, 401);
    return json(snap);
  } catch (err) {
    return failure(err);
  }
}
