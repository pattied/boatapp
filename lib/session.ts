import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { q } from "./db";

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
  // With no passcode configured, only a local development machine may sign in. The live site refuses.
  if (!expected) return !process.env.VERCEL;
  return safeEqual(given.trim(), expected);
}

const MAX_TRIES = 5;
const LOCK_MINUTES = 10;

// Checks a passcode with a lockout: after 5 wrong tries from one network address, sign-in for that
// role is refused for 10 minutes. A site-wide cap of 60 wrong tries also applies, so spreading
// guesses across many addresses does not help.
export async function checkPasscode(role: "manager" | "tech", given: string): Promise<"ok" | "wrong" | "locked"> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const who = `${role}:${ip}`;
  const [mine, all] = await Promise.all([
    q<{ n: number }>(`select count(*)::int as n from signin_attempts where who = $1 and at > now() - interval '${LOCK_MINUTES} minutes'`, [who]),
    q<{ n: number }>(`select count(*)::int as n from signin_attempts where who like $1 and at > now() - interval '${LOCK_MINUTES} minutes'`, [`${role}:%`]),
  ]);
  if (mine[0].n >= MAX_TRIES || all[0].n >= 60) return "locked";
  if (passcodeOk(role, given)) return "ok";
  await q("insert into signin_attempts (who) values ($1)", [who]);
  await q("delete from signin_attempts where at < now() - interval '1 day'");
  return "wrong";
}

export const LOCKED_MESSAGE = `Too many wrong tries. Wait ${LOCK_MINUTES} minutes and try again.`;

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

// Every manager page and every manager action calls this first. The check cannot live only in the shared
// layout: a browser that already has the layout asks the server for the inner page alone.
export async function requireManager() {
  if (!(await managerSession())) redirect("/signin");
}
