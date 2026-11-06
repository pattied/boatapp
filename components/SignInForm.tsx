"use client";

import Link from "next/link";
import { useActionState } from "react";
import { managerSignIn, type SignInState } from "@/app/actions/session";

export default function ManagerSignIn({ businessName }: { businessName: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(managerSignIn, {});
  return (
    <main className="page">
      <header className="top">
        <div className="eyebrow">{businessName} · Manager</div>
        <h1>Manager sign-in</h1>
      </header>
      <form className="card stack" action={action}>
        <label className="field">
          <span>Manager passcode</span>
          <input type="password" name="passcode" autoComplete="current-password" autoFocus required />
        </label>
        {state.error && <p className="error">{state.error}</p>}
        <button className="btn primary" disabled={pending}>{pending ? "Checking…" : "Sign in"}</button>
      </form>
      <Link href="/" className="manager-link">Switch role</Link>
    </main>
  );
}
