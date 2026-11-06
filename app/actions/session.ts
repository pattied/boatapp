"use server";

import { redirect } from "next/navigation";
import { clearSession, passcodeOk, setSession } from "@/lib/session";

export type SignInState = { error?: string };

export async function managerSignIn(_prev: SignInState, fd: FormData): Promise<SignInState> {
  const code = String(fd.get("passcode") ?? "");
  if (!passcodeOk("manager", code)) return { error: "That passcode is not right." };
  await setSession({ role: "manager" });
  redirect("/manager");
}

export async function signOut() {
  await clearSession();
  redirect("/");
}
