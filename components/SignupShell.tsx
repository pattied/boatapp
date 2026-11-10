"use client";

import { useState, type ReactNode } from "react";

// Wraps the sign-up fields. Submitting by hand (not through the form's action) keeps everything the
// customer typed when the server reports a problem.
export default function SignupShell({ action, children }: { action: (fd: FormData) => Promise<{ error: string } | void>; children: ReactNode }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await action(new FormData(e.currentTarget));
      if (result?.error) {
        setError(result.error);
        setPending(false);
      }
      // On success the server sends the browser to the thank-you page.
    } catch {
      setError("We couldn't send your sign-up. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      {children}
      {error && <p className="notice bad" role="alert">{error}</p>}
      <button className="btn primary" disabled={pending}>{pending ? "Sending…" : "Send sign-up"}</button>
    </form>
  );
}
