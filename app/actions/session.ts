"use server";

import { redirect } from "next/navigation";
import { checkPasscode, clearSession, LOCKED_MESSAGE, setSession } from "@/lib/session";

export type SignInState = { error?: string; first?: string; last?: string };

export async function managerSignIn(_prev: SignInState, fd: FormData): Promise<SignInState> {
  const code = String(fd.get("passcode") ?? "");
  const result = await checkPasscode("manager", code);
  if (result === "locked") return { error: LOCKED_MESSAGE };
  if (result === "wrong") return { error: "That passcode is not right." };
  await setSession({ role: "manager" });
  redirect("/manager");
}

export async function signOut() {
  await clearSession();
  redirect("/");
}

export async function salesSignIn(_prev: SignInState, fd: FormData): Promise<SignInState> {
  const clean = (k: string) => String(fd.get(k) ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
  const first = clean("first_name");
  const last = clean("last_name");
  const name = `${first} ${last}`.trim();
  if (!first || !last) return { error: "Enter your first and last name so your leads are recorded as yours.", first, last };
  const result = await checkPasscode("sales", String(fd.get("passcode") ?? ""));
  if (result === "locked") return { error: LOCKED_MESSAGE, first, last };
  if (result === "wrong") return { error: "That passcode is not right.", first, last };
  await setSession({ role: "sales", name });
  redirect("/sales");
}
