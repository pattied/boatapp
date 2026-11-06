import { checkPasscode } from "@/lib/auth";
import { json } from "@/lib/http";

export async function POST(req: Request) {
  return json({ ok: checkPasscode(req), required: Boolean(process.env.APP_PASSCODE) });
}
