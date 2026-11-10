import { createHash, timingSafeEqual } from "crypto";
import { q } from "@/lib/db";
import { runDaily } from "@/lib/messaging/send";
import { ensureGenerated } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily: extend the schedule, queue tomorrow's reminders, deliver anything waiting.
// Vercel sends "Authorization: Bearer <CRON_SECRET>" when that setting exists; with it set, nothing else gets in.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret) {
    const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const h = (s: string) => createHash("sha256").update(s).digest();
    if (!timingSafeEqual(h(given), h(secret))) return new Response("Forbidden", { status: 403 });
  }
  await ensureGenerated(q);
  await runDaily();
  return Response.json({ ok: true });
}
