"use server";

import { redirect } from "next/navigation";
import { checkPasscode, clearSession, LOCKED_MESSAGE, setSession } from "@/lib/session";

export type SignInState = { error?: string; name?: string };

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
  const name = String(fd.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (name.length < 2) return { error: "Enter your name so your leads are recorded as yours." };
  const result = await checkPasscode("sales", String(fd.get("passcode") ?? ""));
  if (result === "locked") return { error: LOCKED_MESSAGE, name };
  if (result === "wrong") return { error: "That passcode is not right.", name };
  await setSession({ role: "sales", name });
  redirect("/sales");
}
