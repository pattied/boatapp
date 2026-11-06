"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatDate, getManagerPasscode, setManagerPasscode } from "@/lib/client";
import type { JobSummary } from "@/lib/storage";

type Filter = "all" | "today" | "week" | "nolink";

const laDay = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return formatDate(iso);
}

function status(j: JobSummary) {
  if (j.hasShare) return { label: "Link ready", tone: "good" };
  if (j.before + j.after > 0) return { label: "No link yet", tone: "warn" };
  return { label: "No photos", tone: "idle" };
}

export default function Manager({ businessName }: { businessName: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      const res = await api<{ jobs: JobSummary[] }>("/api/manager/jobs", {}, true);
      setJobs(res.jobs);
      setSignedIn(true);
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        setManagerPasscode(null);
        setSignedIn(false);
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (getManagerPasscode()) load();
    else {
      // No passcode saved: check whether one is needed at all.
      api<{ ok: boolean }>("/api/manager/auth", { method: "POST" }, true)
        .then((r) => (r.ok ? load() : setSignedIn(false)))
        .catch(() => setSignedIn(false));
    }
  }, [load]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setManagerPasscode(code.trim());
    const r = await api<{ ok: boolean }>("/api/manager/auth", { method: "POST" }, true).catch(() => ({ ok: false }));
    if (r.ok) load();
    else {
      setManagerPasscode(null);
      setError("That passcode is not right.");
    }
  }

  async function remove(j: JobSummary) {
    if (!window.confirm(`Delete "${j.boatName}" and all its photos? The customer's link will stop working.`)) return;
    try {
      await api(`/api/manager/jobs/${j.id}`, { method: "DELETE" }, true);
      setJobs((all) => (all ?? []).filter((x) => x.id !== j.id));
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  async function copyLink(j: JobSummary) {
    const link = `${window.location.origin}/j/${j.id}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(j.id);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt("Copy this link:", link);
    }
  }

  const shown = useMemo(() => {
    if (!jobs) return [];
    const today = laDay(new Date());
    const weekAgo = laDay(new Date(Date.now() - 6 * 86400000));
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (q && !`${j.boatName} ${j.customerName}`.toLowerCase().includes(q)) return false;
      const day = laDay(j.createdAt);
      if (filter === "today") return day === today;
      if (filter === "week") return day >= weekAgo;
      if (filter === "nolink") return !j.hasShare;
      return true;
    });
  }, [jobs, query, filter]);

  if (signedIn === null) return <main className="page wide"><p className="muted">Loading…</p></main>;

  if (!signedIn) {
    return (
      <main className="page">
        <header className="top">
          <div className="eyebrow">{businessName} · Manager</div>
          <h1>Manager sign-in</h1>
        </header>
        <form className="card stack" onSubmit={signIn}>
          <label className="field">
            <span>Manager passcode</span>
            <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={!code.trim()}>Sign in</button>
        </form>
        <Link href="/" className="manager-link">Switch role</Link>
      </main>
    );
  }

  const all = jobs ?? [];
  const today = laDay(new Date());
  const counts = {
    today: all.filter((j) => laDay(j.createdAt) === today).length,
    noLink: all.filter((j) => !j.hasShare).length,
  };

  return (
    <main className="page wide">
      <header className="top manager-top">
        <div>
          <div className="eyebrow">{businessName} · Manager</div>
          <h1>All jobs</h1>
          <div className="muted">
            {all.length} jobs · {counts.today} today · {counts.noLink} without a customer link
          </div>
        </div>
        <div className="btn-row tight">
          <button className="btn" onClick={load} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
          <Link className="btn" href="/">Switch role</Link>
        </div>
      </header>

      <div className="toolbar">
        <input
          className="search"
          placeholder="Search boat or customer"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="pills">
          {(
            [
              ["all", "All"],
              ["today", "Today"],
              ["week", "Last 7 days"],
              ["nolink", "No link yet"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button key={key} className={`pill ${filter === key ? "on" : ""}`} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {shown.length === 0 ? (
        <p className="muted">{all.length ? "No jobs match." : "No jobs yet. Technicians create them from the technician view."}</p>
      ) : (
        <div className="job-grid">
          {shown.map((j) => {
            const s = status(j);
            return (
              <article key={j.id} className="card job-card">
                <div className="job-head">
                  <strong>{j.boatName}</strong>
                  <span className={`status ${s.tone}`}>{s.label}</span>
                </div>
                <div className="muted small">
                  {j.customerName ? `${j.customerName} · ` : ""}
                  {formatDate(j.createdAt)}
                </div>
                <div className="small">
                  {j.before} before · {j.after} after · updated {timeAgo(j.lastActivity)}
                </div>
                <div className="btn-row tight">
                  <Link className="btn small-btn" href={`/job/${j.id}`}>Open job</Link>
                  <a className="btn small-btn" href={`/j/${j.id}`} target="_blank" rel="noreferrer">
                    Customer page
                  </a>
                  <button className="btn small-btn" onClick={() => copyLink(j)}>
                    {copied === j.id ? "Copied" : "Copy link"}
                  </button>
                  <button className="btn small-btn danger" onClick={() => remove(j)}>Delete</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
