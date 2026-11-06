"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CrewJob, Snapshot } from "@/lib/crew";
import { composeShareImage, resizePhoto } from "@/lib/image";
import { newId, outboxAdd, outboxAll, outboxRemove, sendItem, type OutboxItem, type OutboxPhoto } from "@/lib/outbox";

type View =
  | { s: "list" }
  | { s: "job"; id: string }
  | { s: "complete"; id: string }
  | { s: "skip"; id: string }
  | { s: "flag"; id: string }
  | { s: "done"; id: string };

type Target = { jobId: string; kind: OutboxPhoto["photoKind"]; slot: string; onShot?: (clientId: string) => void };

const SNAP_KEY = "cc_snapshot";
const VIEW_KEY = "cc_view";
const STALE_MS = 36 * 3600 * 1000; // after this long without a sync, job and gate-code data is cleared

const STATUS_TEXT: Record<string, string> = {
  scheduled: "To do",
  needs_reschedule: "To do",
  in_progress: "In progress",
  completed: "Done",
  partial: "Partly done",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

function readSnap(): Snapshot | null {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    if (!raw) return null;
    const { at, snap } = JSON.parse(raw) as { at: number; snap: Snapshot };
    if (Date.now() - at > STALE_MS) {
      localStorage.removeItem(SNAP_KEY);
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

function saveSnap(snap: Snapshot) {
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify({ at: Date.now(), snap }));
  } catch {}
}

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default function CrewApp({ businessName, hasSession, instagramHandle }: { businessName: string; hasSession: boolean; instagramHandle: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [signedIn, setSignedIn] = useState(hasSession);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [view, setViewState] = useState<View>({ s: "list" });
  const [day, setDay] = useState<"today" | "tomorrow">("today");
  const [notice, setNotice] = useState("");
  const [installed, setInstalled] = useState(true);
  const [guide, setGuide] = useState<{ target: Target; src: string | null } | null>(null);
  const urls = useRef(new Map<string, string>());
  const syncing$ = useRef(false);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const target = useRef<Target | null>(null);

  const setView = useCallback((v: View) => {
    setViewState(v);
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify(v));
    } catch {}
    window.scrollTo(0, 0);
  }, []);

  const urlFor = (item: OutboxPhoto) => {
    let u = urls.current.get(item.id);
    if (!u) {
      u = URL.createObjectURL(item.blob);
      urls.current.set(item.id, u);
    }
    return u;
  };

  const sync = useCallback(async () => {
    if (syncing$.current) return;
    syncing$.current = true;
    setSyncing(true);
    try {
      for (const item of await outboxAll()) {
        const r = await sendItem(item);
        if (r === "sent" || r === "dropped") {
          await outboxRemove(item.id);
          if (r === "dropped") setNotice("One saved item was for a job that no longer exists, so it was discarded.");
        } else if (r === "signed_out") {
          setSignedIn(false);
          break;
        } else {
          setOnline(false);
          break;
        }
      }
      setItems(await outboxAll());
      const res = await fetch("/api/crew/snapshot", { cache: "no-store" });
      if (res.status === 401) {
        setSignedIn(false);
      } else if (res.ok) {
        const s = (await res.json()) as Snapshot;
        setSnap(s);
        saveSnap(s);
        setLastSync(Date.now());
        setOnline(true);
      }
    } catch {
      setOnline(false);
    } finally {
      syncing$.current = false;
      setSyncing(false);
    }
  }, []);

  // Start-up: show saved data at once, then sync.
  useEffect(() => {
    setSnap(readSnap());
    outboxAll().then(setItems).catch(() => {});
    try {
      const v = sessionStorage.getItem(VIEW_KEY);
      if (v) setViewState(JSON.parse(v));
    } catch {}
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    navigator.storage?.persist?.().catch(() => {});
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/crew" }).catch(() => {});
    if (hasSession) sync();
    const onOnline = () => sync();
    const onVisible = () => document.visibilityState === "visible" && sync();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => document.visibilityState === "visible" && sync(), 30000);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [hasSession, sync]);

  // Keep the screen awake while photos are waiting to upload.
  useEffect(() => {
    if (!items.length || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => {
      lock?.release().catch(() => {});
    };
  }, [items.length]);

  // Warn before closing the page with unsent work.
  useEffect(() => {
    if (!items.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [items.length]);

  async function enqueue(item: OutboxItem) {
    await outboxAdd(item);
    setItems((all) => [...all, item]);
    sync();
  }

  function event(jobId: string, type: "start" | "complete" | "skip" | "flag", data?: Record<string, unknown>) {
    const id = newId();
    return enqueue({ id, kind: "event", jobId, createdAt: Date.now(), type, at: new Date().toISOString(), data }).then(() => id);
  }

  function openCamera(t: Target, fromLibrary = false) {
    target.current = t;
    (fromLibrary ? library : camera).current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const t = target.current;
    if (!file || !t) return;
    try {
      const blob = await resizePhoto(file);
      const id = newId();
      const item: OutboxPhoto = { id, kind: "photo", jobId: t.jobId, createdAt: Date.now(), photoKind: t.kind, slot: t.slot, takenAt: new Date().toISOString(), blob };
      await enqueue(item);
      t.onShot?.(id);
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  // Job as the phone sees it: server state plus anything still waiting in the outbox.
  const jobs = useMemo(() => {
    if (!snap) return [];
    return snap.jobs.map((j) => {
      let status = j.status;
      for (const it of items) {
        if (it.kind !== "event" || it.jobId !== j.id) continue;
        if (it.type === "start" && ["scheduled", "needs_reschedule"].includes(status)) status = "in_progress";
        if (it.type === "complete") status = it.data?.partial ? "partial" : "completed";
        if (it.type === "skip" && !["completed", "partial"].includes(status)) status = "skipped";
      }
      const pending = items.filter((i) => i.jobId === j.id).length;
      return { ...j, status, pending };
    });
  }, [snap, items]);

  type Shot = { src: string; pending: boolean; clientId: string | null };
  function shotFor(j: CrewJob, kind: string, slot: string): Shot | null {
    const local = [...items].reverse().find((i): i is OutboxPhoto => i.kind === "photo" && i.jobId === j.id && i.photoKind === kind && i.slot === slot);
    if (local) return { src: urlFor(local), pending: true, clientId: local.id };
    const server = [...j.photos].reverse().find((p) => p.kind === kind && p.slot === slot);
    if (!server) return null;
    const mine = server.clientId ? urls.current.get(server.clientId) : undefined;
    return { src: mine ?? server.src, pending: false, clientId: server.clientId };
  }
  const extras = (j: CrewJob, kind: string) => {
    const local = items.filter((i): i is OutboxPhoto => i.kind === "photo" && i.jobId === j.id && i.photoKind === kind && i.slot === "Extra");
    const server = j.photos.filter((p) => p.kind === kind && p.slot === "Extra" && !local.some((l) => l.id === p.clientId));
    return [...server.map((p) => ({ src: (p.clientId && urls.current.get(p.clientId)) || p.src, pending: false })), ...local.map((l) => ({ src: urlFor(l), pending: true }))];
  };

  // ---------- Screens ----------

  if (!signedIn) return <CrewSignIn businessName={businessName} onDone={() => { setSignedIn(true); sync(); }} />;

  const pendingCount = items.length;
  const syncBar = (
    <div className={`sync-bar ${pendingCount ? (online ? "warn" : "bad") : "good"}`}>
      <span>
        {pendingCount
          ? online
            ? `${pendingCount} item(s) uploading…`
            : `No signal: ${pendingCount} item(s) saved on this phone`
          : "All saved"}
        {lastSync ? ` · synced ${fmtTime(lastSync)}` : ""}
      </span>
      <button className="linkish dark" onClick={() => sync()} disabled={syncing}>{syncing ? "Syncing…" : "Sync now"}</button>
    </div>
  );

  const fileInputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFile} data-input="camera" />
      <input ref={library} type="file" accept="image/*" hidden onChange={onFile} data-input="library" />
    </>
  );

  const guideOverlay = guide && (
    <div className="guide">
      <div className="guide-head">After photo: <strong>{guide.target.slot}</strong></div>
      {guide.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={guide.src} alt="Before photo to match" />
      ) : (
        <p>No before photo for this angle.</p>
      )}
      <p className="guide-tip">Stand where the before photo was taken and match the angle.</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => { const t = guide.target; setGuide(null); openCamera(t); }}>Open camera</button>
        <button className="btn" onClick={() => { const t = guide.target; setGuide(null); openCamera(t, true); }}>From library</button>
        <button className="btn quiet" onClick={() => setGuide(null)}>Cancel</button>
      </div>
    </div>
  );

  const header = (
    <header className="top">
      <div className="eyebrow">{businessName} · Technician</div>
      <h1>{snap ? snap.tech.name : "Your jobs"}</h1>
      {snap && <div className="muted">{snap.tech.crewName ?? "Not on a crew yet: ask your manager to add you to one."}</div>}
    </header>
  );

  const job = "id" in view ? jobs.find((j) => j.id === view.id) : undefined;
  if ("id" in view && !job && snap) {
    setTimeout(() => setView({ s: "list" }), 0);
  }

  if (view.s === "list" || !job) {
    const list = jobs.filter((j) => j.date === (day === "today" ? snap?.today : snap?.tomorrow));
    return (
      <main className="page crew">
        {header}
        {syncBar}
        {!installed && (
          <p className="notice warn">
            Add this app to your home screen (iPhone: Share, then Add to Home Screen) so photos stay safe when there&apos;s no signal.
          </p>
        )}
        {notice && <p className="notice warn" onClick={() => setNotice("")}>{notice}</p>}
        {!snap && <p className="muted">{online ? "Loading your jobs…" : "No signal and no saved jobs on this phone yet. Open the app with signal first."}</p>}
        {snap && (
          <>
            <div className="pills">
              <button className={`pill ${day === "today" ? "on" : ""}`} onClick={() => setDay("today")}>
                Today ({jobs.filter((j) => j.date === snap.today).length})
              </button>
              <button className={`pill ${day === "tomorrow" ? "on" : ""}`} onClick={() => setDay("tomorrow")}>
                Tomorrow ({jobs.filter((j) => j.date === snap.tomorrow).length})
              </button>
            </div>
            {list.length === 0 && <p className="muted">No jobs for your crew {day}.</p>}
            <ol className="crew-list">
              {list.map((j, i) => (
                <li key={j.id}>
                  <button className={`crew-card ${j.status}`} onClick={() => setView({ s: "job", id: j.id })}>
                    <span className="crew-num">{i + 1}</span>
                    <span className="grow">
                      <strong>{j.boatName}</strong>
                      <span className="muted small">{j.location}</span>
                      <span className="small">{j.service}{j.gateCode ? ` · Gate ${j.gateCode}` : ""}</span>
                    </span>
                    <span className="crew-right">
                      <span className={`status ${["completed", "partial"].includes(j.status) ? "good" : j.status === "skipped" ? "bad" : j.status === "in_progress" ? "warn" : "idle"}`}>
                        {STATUS_TEXT[j.status]}
                      </span>
                      {j.pending > 0 && <span className="small warn-text">⬆ {j.pending}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
        <div className="crew-foot">
          <Link href="/" className="manager-link">Switch role</Link>
          <button
            className="linkish dark"
            onClick={async () => {
              if (items.length) {
                setNotice("Wait until everything has uploaded before signing out.");
                return;
              }
              await fetch("/api/crew/session", { method: "DELETE" }).catch(() => {});
              try { localStorage.removeItem(SNAP_KEY); } catch {}
              setSnap(null);
              setSignedIn(false);
            }}
          >
            Sign out
          </button>
        </div>
        {fileInputs}
      </main>
    );
  }

  const started = !["scheduled", "needs_reschedule"].includes(job.status);
  const finished = ["completed", "partial", "skipped"].includes(job.status);
  const beforeMissing = job.shotList.filter((s) => !shotFor(job, "before", s));
  const afterTaken = job.shotList.filter((s) => shotFor(job, "after", s)).length + extras(job, "after").length;

  const slotGrid = (kind: "before" | "after") => (
    <div className="grid">
      {job.shotList.map((slot) => {
        const shot = shotFor(job, kind, slot);
        const t: Target = { jobId: job.id, kind, slot };
        const open = () => (kind === "after" ? setGuide({ target: t, src: shotFor(job, "before", slot)?.src ?? null }) : openCamera(t));
        return (
          <button key={slot} className={`tile slot ${shot ? "has" : ""}`} onClick={open} disabled={kind === "after" && !started} data-slot={`${kind}-${slot}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {shot ? <img src={shot.src} alt={`${kind} ${slot}`} /> : <span className="slot-empty">📷</span>}
            <span className="tile-tag">{shot ? `${slot} ✓` : slot}</span>
            {shot?.pending && <span className="slot-pending">⬆</span>}
          </button>
        );
      })}
      {extras(job, kind).map((x, i) => (
        <div key={i} className="tile has">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={x.src} alt={`${kind} extra`} />
          <span className="tile-tag">Extra</span>
          {x.pending && <span className="slot-pending">⬆</span>}
        </div>
      ))}
      <button className="tile slot add" onClick={() => openCamera({ jobId: job.id, kind, slot: "Extra" })} disabled={kind === "after" && !started}>
        <span className="slot-empty">＋</span>
        <span className="tile-tag">Extra photo</span>
      </button>
    </div>
  );

  const back = (
    <button className="back linkish-strong" onClick={() => setView({ s: view.s === "job" || view.s === "done" ? "list" : "job", id: job.id } as View)}>
      ← {view.s === "job" || view.s === "done" ? "Jobs" : job.boatName}
    </button>
  );

  if (view.s === "complete") return <CompleteScreen job={job} lists={snap!.lists} back={back} syncBar={syncBar} afterTaken={afterTaken}
    onDone={async (message, partial, reason) => {
      await event(job.id, "complete", { message, partial, reason });
      setView({ s: "done", id: job.id });
      // Build the branded share image from the first angle that has both photos.
      const slot = job.shotList.find((s) => shotFor(job, "before", s) && shotFor(job, "after", s));
      try {
        const blob = await composeShareImage({
          beforeSrc: slot ? shotFor(job, "before", slot)!.src : undefined,
          afterSrc: slot ? shotFor(job, "after", slot)!.src : extras(job, "after")[0]?.src,
          businessName,
          instagramHandle,
        });
        await enqueue({ id: newId(), kind: "photo", jobId: job.id, createdAt: Date.now(), photoKind: "share", slot: "", takenAt: new Date().toISOString(), blob });
      } catch {
        // The customer page still shows the photos without a share image.
      }
    }} />;

  if (view.s === "skip") return <SkipScreen job={job} reasons={snap!.lists.skip} back={back} syncBar={syncBar} fileInputs={fileInputs}
    takePhoto={(onShot) => openCamera({ jobId: job.id, kind: "skip", slot: "Empty slip", onShot })}
    photoSrc={(id) => { const it = items.find((i): i is OutboxPhoto => i.kind === "photo" && i.id === id); return it ? urlFor(it) : null; }}
    onDone={async (reason) => { await event(job.id, "skip", { reason }); setView({ s: "list" }); setNotice(`${job.boatName} skipped. Your manager will reschedule it.`); }} />;

  if (view.s === "flag") return <FlagScreen job={job} categories={snap!.lists.issue} started={started} back={back} syncBar={syncBar} fileInputs={fileInputs}
    online={online} managerPhone={snap!.managerPhone}
    takePhoto={(onShot) => openCamera({ jobId: job.id, kind: "issue", slot: "Issue", onShot })}
    photoSrc={(id) => { const it = items.find((i): i is OutboxPhoto => i.kind === "photo" && i.id === id); return it ? urlFor(it) : null; }}
    onDone={async (data) => { await event(job.id, "flag", data); setView({ s: "job", id: job.id }); setNotice(data.severity === "urgent" ? "Urgent issue sent to the top of your manager's list." : "Issue saved."); }} />;

  if (view.s === "done") {
    const link = `${window.location.origin}/j/${job.publicId}`;
    return (
      <main className="page crew">
        {back}
        {syncBar}
        <section className="card stack done-card">
          <h1>{job.boatName}: {job.status === "partial" ? "partly done" : "done"}</h1>
          <p className="muted">Photos upload in the background. The customer link shows them as they arrive.</p>
          <div className="link-box">{link}</div>
          <div className="btn-row">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => setNotice("Link copied.")).catch(() => window.prompt("Copy this link:", link))}>Copy customer link</button>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <button className="btn" onClick={() => navigator.share({ url: link, title: `${job.boatName}: before & after` }).catch(() => {})}>Share…</button>
            )}
          </div>
          {notice && <p className="note">{notice}</p>}
          <button className="btn primary" onClick={() => setView({ s: "list" })}>Next job</button>
        </section>
      </main>
    );
  }

  // Job screen
  return (
    <main className="page crew">
      {back}
      {syncBar}
      {notice && <p className="notice warn" onClick={() => setNotice("")}>{notice}</p>}
      <header className="top">
        <h1>{job.boatName}</h1>
        <div className="muted">{job.service} · {STATUS_TEXT[job.status]}</div>
      </header>
      <section className="card stack">
        {job.boatPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={job.boatPhoto} alt={`${job.boatName} last visit`} className="boat-photo" />
        )}
        <div className="small muted">{job.boatDetails}{job.customerFirst ? ` · Owner: ${job.customerFirst}` : ""}</div>
        <div className="loc">{job.location || "No location on file"}</div>
        {job.gateCode && <div className="gate">Gate code <strong>{job.gateCode}</strong></div>}
        {job.accessNotes && <div className="small">Access: {job.accessNotes}</div>}
        {(job.liveaboard || job.knockFirst) && (
          <div className="row">
            {job.liveaboard && <span className="status warn">Liveaboard</span>}
            {job.knockFirst && <span className="status warn">Knock first</span>}
          </div>
        )}
        {job.notes && <div className="small notice warn">{job.notes}</div>}
      </section>

      {!finished && (
        <section className="stack">
          <h2>Before photos {beforeMissing.length ? <span className="muted small">{job.shotList.length - beforeMissing.length} of {job.shotList.length}</span> : <span className="small good-text">all taken</span>}</h2>
          {slotGrid("before")}
          {!started && (
            beforeMissing.length === 0 ? (
              <button className="btn primary big-btn" onClick={() => event(job.id, "start")}>Start job</button>
            ) : (
              <StartAnyway missing={beforeMissing} onStart={(reason) => event(job.id, "start", { missingReason: `${beforeMissing.join(", ")} (${reason})` })} />
            )
          )}
        </section>
      )}

      {started && !finished && (
        <section className="stack">
          <h2>After photos <span className="muted small">tap an angle to see its before photo</span></h2>
          {slotGrid("after")}
          <button className="btn primary big-btn" disabled={afterTaken === 0} onClick={() => setView({ s: "complete", id: job.id })}>
            {afterTaken === 0 ? "Take after photos to finish" : "Finish job"}
          </button>
        </section>
      )}

      {finished && (
        <section className="card stack">
          <p><strong>{STATUS_TEXT[job.status]}</strong>{job.skipReason ? `: ${job.skipReason}` : ""}</p>
          {job.status !== "skipped" && <button className="btn" onClick={() => setView({ s: "done", id: job.id })}>Customer link</button>}
        </section>
      )}

      <div className="btn-row">
        <button className="btn" onClick={() => setView({ s: "flag", id: job.id })}>⚠ Flag an issue</button>
        {!finished && <button className="btn" onClick={() => setView({ s: "skip", id: job.id })}>Can&apos;t do this job</button>}
      </div>
      {fileInputs}
      {guideOverlay}
    </main>
  );
}

function StartAnyway({ missing, onStart }: { missing: string[]; onStart: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="card stack">
      <p className="small">Take the {missing.length} remaining before photo(s) to start, or start anyway with a reason:</p>
      <select value={reason} onChange={(e) => setReason(e.target.value)} className="big-select">
        <option value="">Choose a reason</option>
        {["Boat covered", "Can't reach that side", "Owner aboard", "Low light", "Other"].map((r) => <option key={r}>{r}</option>)}
      </select>
      <button className="btn" disabled={!reason} onClick={() => onStart(reason)}>Start anyway</button>
    </div>
  );
}

function CompleteScreen({ job, lists, back, syncBar, afterTaken, onDone }: {
  job: CrewJob; lists: Snapshot["lists"]; back: React.ReactNode; syncBar: React.ReactNode; afterTaken: number;
  onDone: (message: string, partial: boolean, reason: string) => void;
}) {
  const [message, setMessage] = useState(lists.completion[0]);
  const [partial, setPartial] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <main className="page crew">
      {back}
      {syncBar}
      <h1>Finish {job.boatName}</h1>
      {afterTaken < job.shotList.length && (
        <p className="notice warn">{afterTaken} of {job.shotList.length} after angles taken. You can still finish.</p>
      )}
      <section className="stack">
        <h2>Message for the customer</h2>
        {lists.completion.map((m) => (
          <label key={m} className={`option ${message === m ? "on" : ""}`}>
            <input type="radio" name="msg" checked={message === m} onChange={() => setMessage(m)} /> <span>{m}</span>
          </label>
        ))}
      </section>
      <label className={`option ${partial ? "on" : ""}`}>
        <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> <span>Only partly done</span>
      </label>
      {partial && (
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="big-select">
          <option value="">Why?</option>
          {lists.partial.map((r) => <option key={r}>{r}</option>)}
        </select>
      )}
      <button className="btn primary big-btn" disabled={partial && !reason} onClick={() => onDone(message, partial, reason)}>
        {partial ? "Finish as partly done" : "Finish job"}
      </button>
    </main>
  );
}

function SkipScreen({ job, reasons, back, syncBar, fileInputs, takePhoto, photoSrc, onDone }: {
  job: CrewJob; reasons: string[]; back: React.ReactNode; syncBar: React.ReactNode; fileInputs: React.ReactNode;
  takePhoto: (onShot: (id: string) => void) => void; photoSrc: (id: string) => string | null; onDone: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const needsPhoto = reason === "Boat not in slip";
  return (
    <main className="page crew">
      {back}
      {syncBar}
      <h1>Can&apos;t do {job.boatName}</h1>
      <section className="stack">
        {reasons.map((r) => (
          <label key={r} className={`option ${reason === r ? "on" : ""}`}>
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} /> <span>{r}</span>
          </label>
        ))}
      </section>
      {needsPhoto && (
        <section className="stack">
          <p className="small">Take a photo of the empty slip.</p>
          {photo && photoSrc(photo) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoSrc(photo)!} alt="Empty slip" className="boat-photo" />
          )}
          <button className="btn" onClick={() => takePhoto(setPhoto)}>{photo ? "Retake photo" : "📷 Photo of empty slip"}</button>
        </section>
      )}
      <button className="btn danger big-btn" disabled={!reason || (needsPhoto && !photo)} onClick={() => onDone(reason)}>
        Skip this job
      </button>
      <p className="muted small">The job goes to your manager&apos;s reschedule queue.</p>
      {fileInputs}
    </main>
  );
}

function FlagScreen({ job, categories, started, back, syncBar, fileInputs, online, managerPhone, takePhoto, photoSrc, onDone }: {
  job: CrewJob; categories: string[]; started: boolean; back: React.ReactNode; syncBar: React.ReactNode; fileInputs: React.ReactNode;
  online: boolean; managerPhone: string; takePhoto: (onShot: (id: string) => void) => void; photoSrc: (id: string) => string | null;
  onDone: (data: Record<string, unknown>) => void;
}) {
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState<"normal" | "urgent">("normal");
  const [found, setFound] = useState<"before" | "after">(started ? "after" : "before");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const urgentHint = /water|bilge/i.test(category);
  return (
    <main className="page crew">
      {back}
      {syncBar}
      <h1>Flag an issue on {job.boatName}</h1>
      {photo && photoSrc(photo) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoSrc(photo)!} alt="Issue" className="boat-photo" />
      )}
      <button className="btn" onClick={() => takePhoto(setPhoto)}>{photo ? "Retake photo" : "📷 Photo of the issue"}</button>
      <section className="stack">
        <h2>What is it?</h2>
        {categories.map((c) => (
          <label key={c} className={`option ${category === c ? "on" : ""}`}>
            <input type="radio" name="cat" checked={category === c} onChange={() => { setCategory(c); if (/water|bilge/i.test(c)) setSeverity("urgent"); }} /> <span>{c}</span>
          </label>
        ))}
        <label className={`option ${category === "Crew incident (internal only)" ? "on" : ""}`}>
          <input type="radio" name="cat" checked={category === "Crew incident (internal only)"} onChange={() => setCategory("Crew incident (internal only)")} />
          <span>Crew incident (internal only, never shown to the customer)</span>
        </label>
      </section>
      <div className="pills">
        <button className={`pill ${severity === "normal" ? "on" : ""}`} onClick={() => setSeverity("normal")}>Normal</button>
        <button className={`pill danger ${severity === "urgent" ? "on" : ""}`} onClick={() => setSeverity("urgent")}>Urgent: boat at risk</button>
      </div>
      <div className="pills">
        <button className={`pill ${found === "before" ? "on" : ""}`} onClick={() => setFound("before")}>Found before work</button>
        <button className={`pill ${found === "after" ? "on" : ""}`} onClick={() => setFound("after")}>During or after work</button>
      </div>
      <label className="field">
        <span>Note (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </label>
      {severity === "urgent" && (
        <p className="notice bad">
          {online ? "Urgent flags go to the top of your manager's list." : "No signal: this is saved and sends when you have signal."}
          {managerPhone ? <> Call your manager now: <a href={`tel:${managerPhone}`}>{managerPhone}</a>.</> : " Call your manager now if the boat is at risk."}
          {urgentHint && " If the boat is taking on water, also tell the harbor office."}
        </p>
      )}
      <button className="btn primary big-btn" disabled={!category} onClick={() => onDone({ category, severity, found, note, photoClientId: photo, internal: category.startsWith("Crew incident") })}>
        Submit flag
      </button>
      {fileInputs}
    </main>
  );
}

function CrewSignIn({ businessName, onDone }: { businessName: string; onDone: () => void }) {
  const [techs, setTechs] = useState<{ id: string; name: string; crew: string | null }[] | null>(null);
  const [techId, setTechId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/crew/technicians", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setTechs(d.techs ?? []))
      .catch(() => setError("No signal. Sign in when you have signal."));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/crew/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: code, techId }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.error ?? "Could not sign in.");
      else onDone();
    } catch {
      setError("No signal. Sign in when you have signal.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page crew">
      <header className="top">
        <div className="eyebrow">{businessName} · Technician</div>
        <h1>Technician sign-in</h1>
      </header>
      <form className="card stack" onSubmit={submit}>
        <label className="field">
          <span>Your name</span>
          <select value={techId} onChange={(e) => setTechId(e.target.value)} required>
            <option value="">{techs ? (techs.length ? "Choose your name" : "No technicians yet: ask your manager") : "Loading…"}</option>
            {techs?.map((t) => <option key={t.id} value={t.id}>{t.name}{t.crew ? ` (${t.crew})` : ""}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Technician passcode</span>
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy || !techId}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <Link href="/" className="manager-link">Switch role</Link>
    </main>
  );
}
