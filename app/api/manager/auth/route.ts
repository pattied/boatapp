import { checkManager } from "@/lib/auth";
import { json } from "@/lib/http";

export async function POST(req: Request) {
  return json({ ok: checkManager(req) });
}
