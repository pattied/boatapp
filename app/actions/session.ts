"use server";

import { redirect } from "next/navigation";
import { checkPasscode, clearSession, LOCKED_MESSAGE, setSession } from "@/lib/session";

export type SignInState = { error?: string };

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
