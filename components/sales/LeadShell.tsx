"use client";

import { useState, type ReactNode } from "react";

// Submits the lead form by hand so nothing typed is lost when the server reports a problem.
export default function LeadShell({ action, children }: { action: (fd: FormData) => Promise<{ error: string } | void>; children: ReactNode }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const r = await action(new FormData(e.currentTarget));
      if (r?.error) {
        setError(r.error);
        setPending(false);
      }
    } catch {
      setError("Could not save. Check your signal and try again. Nothing you typed was lost.");
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      {children}
      {error && <p className="notice bad" role="alert">{error}</p>}
      <button className="btn primary big-btn" disabled={pending}>{pending ? "Saving…" : "Save lead"}</button>
    </form>
  );
}
