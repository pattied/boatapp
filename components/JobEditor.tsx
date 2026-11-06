"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { addRecent, api, formatDate, getCover, setCover } from "@/lib/client";
import { composeShareImage, resizePhoto } from "@/lib/image";
import type { Job, Photo, PhotoKind } from "@/lib/storage";

type Status = "processing" | "uploading" | "done" | "error";
type Tile = {
  key: string;
  kind: PhotoKind;
  status: Status;
  display: string; // what the <img> shows: a local preview or the stored photo
  pathname?: string;
  blob?: Blob; // kept until uploaded, so a failed upload can be retried
  error?: string;
};

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function JobEditor({
  id,
  businessName,
  instagramHandle,
}: {
  id: string;
  businessName: string;
  instagramHandle: string;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [cover, setCoverState] = useState<{ before?: string; after?: string }>({});
  const [shareImage, setShareImage] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState("");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setOrigin(window.location.origin);
    setCoverState(getCover(id));
    api<{ job: Job }>(`/api/jobs/${id}`)
      .then(({ job }) => {
        setJob(job);
        setShareImage(job.shareImage);
        addRecent({ id: job.id, boatName: job.boatName, createdAt: job.createdAt });
        const toTile = (kind: PhotoKind) => (p: Photo): Tile => ({
          key: p.pathname,
          kind,
          status: "done",
          display: p.src,
          pathname: p.pathname,
        });
        setTiles([...job.before.map(toTile("before")), ...job.after.map(toTile("after"))]);
      })
      .catch((err) => setLoadError(err.message));
  }, [id]);

  const pending = tiles.some((t) => t.status === "processing" || t.status === "uploading");

  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  const patch = useCallback((key: string, change: Partial<Tile>) => {
    setTiles((all) => all.map((t) => (t.key === key ? { ...t, ...change } : t)));
  }, []);

  const upload = useCallback(
    async (tile: Tile) => {
      if (!tile.blob) return;
      patch(tile.key, { status: "uploading", error: undefined });
      let lastError = "Upload failed.";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { photo } = await api<{ photo: Photo }>(`/api/jobs/${id}/photos?kind=${tile.kind}`, {
            method: "POST",
            headers: { "content-type": "image/jpeg" },
            body: tile.blob,
          });
          patch(tile.key, { status: "done", pathname: photo.pathname, blob: undefined });
          return;
        } catch (err) {
          lastError = (err as Error).message;
          const status = (err as { status?: number }).status;
          if (status && status < 500) break; // passcode or bad request: retrying won't help
          await sleep(1500 * (attempt + 1));
        }
      }
      patch(tile.key, { status: "error", error: lastError });
    },
    [id, patch],
  );

  function addFiles(kind: PhotoKind, files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const tile: Tile = { key: uid(), kind, status: "processing", display: "" };
      setTiles((all) => [...all, tile]);
      queue.current = queue.current.then(async () => {
        try {
          const blob = await resizePhoto(file);
          const ready = { ...tile, blob, display: URL.createObjectURL(blob) };
          patch(tile.key, { blob, display: ready.display });
          await upload(ready);
        } catch (err) {
          patch(tile.key, { status: "error", error: (err as Error).message });
        }
      });
    }
  }

  function retry(tile: Tile) {
    queue.current = queue.current.then(() => upload(tile));
  }

  async function remove(tile: Tile) {
    if (!window.confirm("Remove this photo?")) return;
    if (tile.pathname) {
      try {
        await api(`/api/jobs/${id}/photos?pathname=${encodeURIComponent(tile.pathname)}`, { method: "DELETE" });
      } catch (err) {
        window.alert((err as Error).message);
        return;
      }
    }
    setTiles((all) => all.filter((t) => t.key !== tile.key));
  }

  function chooseCover(tile: Tile) {
    if (!tile.pathname) return;
    const next = { ...cover, [tile.kind]: tile.pathname };
    setCoverState(next);
    setCover(id, next);
  }

  const done = (kind: PhotoKind) => tiles.filter((t) => t.kind === kind && t.status === "done");
  const pick = (kind: PhotoKind) => {
    const list = done(kind);
    return list.find((t) => t.pathname === cover[kind]) ?? list[0];
  };

  async function createLink() {
    setShareError("");
    setSharing(true);
    try {
      const blob = await composeShareImage({
        beforeSrc: pick("before")?.display,
        afterSrc: pick("after")?.display,
        businessName,
        instagramHandle,
      });
      const res = await api<{ shareImage: string }>(`/api/jobs/${id}/share`, {
        method: "POST",
        headers: { "content-type": "image/jpeg" },
        body: blob,
      });
      setShareImage(res.shareImage);
    } catch (err) {
      setShareError((err as Error).message);
    } finally {
      setSharing(false);
    }
  }

  const link = origin ? `${origin}/j/${id}` : "";
  const smsBody = job
    ? `${businessName}: ${job.boatName} is clean and ready. Your before & after photos: ${link}`
    : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", link);
    }
  }

  async function shareLink() {
    if (navigator.share) {
      try {
        await navigator.share({ title: job?.boatName, text: smsBody.replace(link, "").trim(), url: link });
      } catch {
        // Closed the share sheet.
      }
    } else copyLink();
  }

  if (loadError) {
    return (
      <main className="page">
        <Link href="/crew" className="back">← Jobs</Link>
        <p className="error">{loadError}</p>
      </main>
    );
  }
  if (!job) return <main className="page"><p className="muted">Loading…</p></main>;

  const hasPhotos = done("before").length + done("after").length > 0;

  return (
    <main className="page">
      <Link href="/crew" className="back">← Jobs</Link>
      <header className="top">
        <h1>{job.boatName}</h1>
        <div className="muted">
          {job.customerName ? `${job.customerName} · ` : ""}
          {formatDate(job.createdAt)}
        </div>
      </header>

      {(["before", "after"] as PhotoKind[]).map((kind) => (
        <PhotoSection
          key={kind}
          kind={kind}
          tiles={tiles.filter((t) => t.kind === kind)}
          coverPath={pick(kind)?.pathname}
          onAdd={(files) => addFiles(kind, files)}
          onRetry={retry}
          onRemove={remove}
          onCover={chooseCover}
        />
      ))}

      <section className="card stack">
        <h2>Share with the customer</h2>
        <p className="muted small">
          The share image uses the starred before and after photos. Tap a photo to star it.
        </p>
        {shareImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shareImage} alt="Before and after share image" className="share-preview" />
            <div className="link-box">{link}</div>
            <a className="btn primary" href={`sms:?&body=${encodeURIComponent(smsBody)}`}>
              Text link to customer
            </a>
            <div className="btn-row">
              <button className="btn" onClick={copyLink}>{copied ? "Copied" : "Copy link"}</button>
              <button className="btn" onClick={shareLink}>Share…</button>
              <a className="btn" href={`/j/${id}`} target="_blank" rel="noreferrer">Open page</a>
            </div>
            <button className="btn quiet" onClick={createLink} disabled={sharing || pending || !hasPhotos}>
              {sharing ? "Updating…" : "Update share image"}
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={createLink} disabled={sharing || pending || !hasPhotos}>
            {sharing ? "Creating…" : pending ? "Waiting for uploads…" : "Create share link"}
          </button>
        )}
        {!hasPhotos && <p className="muted small">Add photos first.</p>}
        {shareError && <p className="error">{shareError}</p>}
      </section>
    </main>
  );
}

function PhotoSection({
  kind,
  tiles,
  coverPath,
  onAdd,
  onRetry,
  onRemove,
  onCover,
}: {
  kind: PhotoKind;
  tiles: Tile[];
  coverPath?: string;
  onAdd: (files: FileList | null) => void;
  onRetry: (t: Tile) => void;
  onRemove: (t: Tile) => void;
  onCover: (t: Tile) => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const title = kind === "before" ? "Before" : "After";
  const waiting = tiles.filter((t) => t.status !== "done").length;

  return (
    <section className="card stack" data-section={kind}>
      <div className="section-head">
        <h2>{title} photos</h2>
        <span className="muted small">
          {tiles.length} photo{tiles.length === 1 ? "" : "s"}
          {waiting ? ` · ${waiting} uploading` : ""}
        </span>
      </div>
      {tiles.length > 0 && (
        <div className="grid">
          {tiles.map((t) => (
            <figure key={t.key} className={`tile ${t.pathname && t.pathname === coverPath ? "cover" : ""}`}>
              {t.display ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.display} alt={`${title} photo`} onClick={() => onCover(t)} />
              ) : (
                <div className="tile-blank" />
              )}
              {t.pathname && t.pathname === coverPath && <span className="star">★</span>}
              {t.status !== "done" && (
                <div className={`tile-status ${t.status}`}>
                  {t.status === "processing" && "Preparing…"}
                  {t.status === "uploading" && "Uploading…"}
                  {t.status === "error" && (
                    <>
                      <span>{t.error || "Failed"}</span>
                      {t.blob && <button onClick={() => onRetry(t)}>Retry</button>}
                    </>
                  )}
                </div>
              )}
              {(t.status === "done" || t.status === "error") && (
                <button className="remove" aria-label="Remove photo" onClick={() => onRemove(t)}>
                  ×
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
      <div className="btn-row">
        <button className="btn primary" onClick={() => camera.current?.click()}>
          Take {kind} photo
        </button>
        <button className="btn" onClick={() => library.current?.click()}>
          From library
        </button>
      </div>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-input={`${kind}-camera`}
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={library}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-input={`${kind}-library`}
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
      />
    </section>
  );
}
