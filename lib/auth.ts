import { createHash, timingSafeEqual } from "crypto";

// Crews send the shared passcode in a header on every change.
// Viewing a job by its unguessable link needs no passcode.
function matches(req: Request, header: string, expected: string | undefined): boolean {
  if (!expected) return true;
  const given = req.headers.get(header) ?? "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function checkPasscode(req: Request): boolean {
  return matches(req, "x-passcode", process.env.APP_PASSCODE);
}

// Manager pages use MANAGER_PASSCODE when it is set, otherwise the crew passcode.
export function checkManager(req: Request): boolean {
  return matches(req, "x-manager-passcode", process.env.MANAGER_PASSCODE || process.env.APP_PASSCODE);
}
