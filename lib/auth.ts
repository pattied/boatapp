import { createHash, timingSafeEqual } from "crypto";

// Crews send the shared passcode in a header on every change.
// Viewing a job by its unguessable link needs no passcode.
export function checkPasscode(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  const given = req.headers.get("x-passcode") ?? "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
