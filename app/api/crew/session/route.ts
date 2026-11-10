import { one } from "@/lib/db";
import { failure, json } from "@/lib/http";
import { isUuid } from "@/lib/ids";
import { checkPasscode, clearSession, LOCKED_MESSAGE, setSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { passcode?: string; techId?: string };
    const result = await checkPasscode("tech", String(body.passcode ?? ""));
    if (result === "locked") return json({ error: LOCKED_MESSAGE }, 429);
    if (result === "wrong") return json({ error: "That passcode is not right." }, 401);
    if (!isUuid(body.techId)) return json({ error: "Choose your name." }, 400);
    const tech = await one<{ id: string; name: string }>("select id, name from technicians where id = $1 and active", [body.techId]);
    if (!tech) return json({ error: "Choose your name." }, 400);
    await setSession({ role: "tech", techId: tech.id, name: tech.name });
    return json({ ok: true, name: tech.name });
  } catch (err) {
    return failure(err);
  }
}

export async function DELETE() {
  await clearSession();
  return json({ ok: true });
}
