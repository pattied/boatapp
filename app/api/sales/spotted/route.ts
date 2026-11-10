import { failure, json } from "@/lib/http";
import { saveSpotted } from "@/lib/sales";
import { salesUser } from "@/lib/session";

// Receives boats logged during a dock walk. Safe to call twice with the same clientId.
export async function POST(req: Request) {
  try {
    const user = await salesUser();
    if (!user) return json({ error: "Sign in again." }, 401);
    const b = (await req.json()) as Record<string, unknown>;
    const s = (k: string, max: number) => (typeof b[k] === "string" ? (b[k] as string).slice(0, max) : "");
    const len = Number(b.lengthFt);
    const r = await saveSpotted(
      {
        clientId: s("clientId", 60), marinaId: s("marinaId", 40), dockId: s("dockId", 40) || null, slip: s("slip", 20), boatName: s("boatName", 80),
        makeModel: s("makeModel", 80), lengthFt: Number.isInteger(len) && len > 0 && len < 500 ? len : null, boatType: s("boatType", 20), condition: s("condition", 500),
      },
      user.name,
    );
    if ("error" in r) return json({ error: r.error }, 400);
    return json({ ok: true, id: r.id, updated: Boolean(r.duplicateOf) });
  } catch (err) {
    return failure(err);
  }
}
