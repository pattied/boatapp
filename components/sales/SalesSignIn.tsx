"use client";

import Link from "next/link";
import { useActionState } from "react";
import { salesSignIn, type SignInState } from "@/app/actions/session";

export default function SalesSignIn({ businessName }: { businessName: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(salesSignIn, {});
  return (
    <main className="page">
      <header className="top">
        <div className="eyebrow">{businessName} · Sales</div>
        <h1>Sales sign-in</h1>
      </header>
      <form className="card stack" action={action}>
        <label className="field">
          <span>Your name</span>
          <input name="name" autoComplete="name" required maxLength={40} defaultValue={state.name ?? ""} key={state.name ?? ""} />
        </label>
        <label className="field">
          <span>Sales passcode</span>
          <input type="password" name="passcode" autoComplete="current-password" required />
        </label>
        {state.error && <p className="error">{state.error}</p>}
        <button className="btn primary" disabled={pending}>{pending ? "Checking…" : "Sign in"}</button>
      </form>
      <Link href="/" className="manager-link">Switch role</Link>
    </main>
  );
}
