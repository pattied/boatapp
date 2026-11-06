"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { addRecent, api, formatDate, getPasscode, getRecent, setPasscode, type RecentJob } from "@/lib/client";
import type { JobMeta } from "@/lib/storage";

export default function Home({ businessName, passcodeRequired }: { businessName: string; passcodeRequired: boolean }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(!passcodeRequired);
  const [code, setCode] = useState("");
  const [boatName, setBoatName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [recent, setRecent] = useState<RecentJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRecent(getRecent());
    if (passcodeRequired && getPasscode()) setSignedIn(true);
    setReady(true);
  }, [passcodeRequired]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    setPasscode(code.trim());
    try {
      const res = await api<{ ok: boolean }>("/api/auth", { method: "POST" });
      if (res.ok) setSignedIn(true);
      else {
        setPasscode(null);
        setError("That passcode is not right.");
      }
    } catch (err) {
      setPasscode(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createJob(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!boatName.trim()) {
      setError("Enter the boat name.");
      return;
    }
    setBusy(true);
    try {
      const { job } = await api<{ job: JobMeta }>("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boatName, customerName }),
      });
      addRecent({ id: job.id, boatName: job.boatName, createdAt: job.createdAt });
      router.push(`/job/${job.id}`);
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        setPasscode(null);
        setSignedIn(false);
      }
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!ready) return <main className="page" />;

  return (
    <main className="page">
      <header className="top">
        <div className="eyebrow">{businessName} · Technician</div>
        <h1>Boat photos</h1>
      </header>

      {!signedIn ? (
        <form className="card stack" onSubmit={signIn}>
          <label className="field">
            <span>Technician passcode</span>
            <input
              type="password"
              inputMode="text"
              autoComplete="current-password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={busy || !code.trim()}>
            {busy ? "Checking…" : "Sign in"}
          </button>
        </form>
      ) : (
        <>
          <form className="card stack" onSubmit={createJob}>
            <h2>New job</h2>
            <label className="field">
              <span>Boat name</span>
              <input
                value={boatName}
                onChange={(e) => setBoatName(e.target.value)}
                placeholder="Blue Heron"
                autoCapitalize="words"
                maxLength={80}
              />
            </label>
            <label className="field">
              <span>Customer first name (optional)</span>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Dana"
                autoCapitalize="words"
                maxLength={60}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn primary" disabled={busy}>
              {busy ? "Creating…" : "Start job and add photos"}
            </button>
          </form>

          <section className="stack">
            <h2>Recent jobs on this phone</h2>
            {recent.length === 0 ? (
              <p className="muted">Jobs you create on this phone show up here.</p>
            ) : (
              <ul className="list">
                {recent.map((j) => (
                  <li key={j.id}>
                    <Link href={`/job/${j.id}`} className="row-link">
                      <strong>{j.boatName}</strong>
                      <span className="muted">{formatDate(j.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <Link href="/" className="manager-link">Switch role</Link>
    </main>
  );
}
