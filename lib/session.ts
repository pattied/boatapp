import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

// Signed cookie sessions. Managers and technicians sign in with a shared passcode;
// technicians also pick their own name so their crew's jobs load and their work is attributed.
export type Session = { role: "manager" } | { role: "tech"; techId: string; name: string };

const COOKIE = "cc_session";

function secret() {
  return (
    process.env.SESSION_SECRET ||
    createHash("sha256")
      .update(`cc-session:${process.env.MANAGER_PASSCODE ?? ""}:${process.env.APP_PASSCODE ?? ""}`)
      .digest("hex")
  );
}

const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export function passcodeOk(role: "manager" | "tech", given: string): boolean {
  const expected = role === "manager" ? process.env.MANAGER_PASSCODE || process.env.APP_PASSCODE : process.env.APP_PASSCODE;
  if (!expected) return true; // local development without passcodes
  return safeEqual(given.trim(), expected);
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [data, mac] = raw.split(".");
  if (!data || !mac || !safeEqual(mac, sign(data))) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString()) as Session;
  } catch {
    return null;
  }
}

export async function setSession(session: Session) {
  const data = Buffer.from(JSON.stringify(session)).toString("base64url");
  (await cookies()).set(COOKIE, `${data}.${sign(data)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: (session.role === "tech" ? 180 : 30) * 86400,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function managerSession(): Promise<boolean> {
  return (await getSession())?.role === "manager";
}

export async function techSession(): Promise<Extract<Session, { role: "tech" }> | null> {
  const s = await getSession();
  return s?.role === "tech" ? s : null;
}

export class Unauthorized extends Error {}

export async function requireManager() {
  if (!(await managerSession())) throw new Unauthorized("Sign in as a manager.");
}
