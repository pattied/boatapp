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
        <div className="two" key={`${state.first ?? ""}|${state.last ?? ""}`}>
          <label className="field">
            <span>First name</span>
            <input name="first_name" autoComplete="given-name" required maxLength={30} defaultValue={state.first ?? ""} />
          </label>
          <label className="field">
            <span>Last name</span>
            <input name="last_name" autoComplete="family-name" required maxLength={30} defaultValue={state.last ?? ""} />
          </label>
        </div>
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
