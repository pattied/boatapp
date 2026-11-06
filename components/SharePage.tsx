"use client";

import { useEffect, useRef, useState } from "react";
import type { Job, Photo } from "@/lib/storage";

export default function SharePage({
  job,
  date,
  url,
  businessName,
  instagramHandle,
}: {
  job: Job;
  date: string;
  url: string;
  businessName: string;
  instagramHandle: string;
}) {
  const shareFile = useRef<File | null>(null);
  const [note, setNote] = useState("");
  const pairs = Array.from({ length: Math.min(job.before.length, job.after.length) }, (_, i) => ({
    before: job.before[i],
    after: job.after[i],
  }));
  const extras = [...job.before.slice(pairs.length), ...job.after.slice(pairs.length)];
  const caption = `Fresh clean on ${job.boatName} by ${businessName}${instagramHandle ? ` @${instagramHandle}` : ""}`;

  // iPhones only allow sharing during the tap itself, so load the image ahead of time.
  useEffect(() => {
    if (!job.shareImage) return;
    fetch(job.shareImage)
      .then((r) => r.blob())
      .then((b) => {
        shareFile.current = new File([b], `${job.boatName.replace(/[^a-z0-9]+/gi, "-")}-before-after.jpg`, {
          type: "image/jpeg",
        });
      })
      .catch(() => {});
  }, [job.shareImage, job.boatName]);

  function flash(text: string) {
    setNote(text);
    setTimeout(() => setNote(""), 2500);
  }

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(done);
    } catch {
      window.prompt("Copy this:", text);
    }
  }

  async function share() {
    const file = shareFile.current;
    try {
      // Share the image alone: iPhones drop the picture when text is sent with it.
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: `${job.boatName}: before & after`, url });
        return;
      }
      await copy(url, "Link copied");
    } catch (err) {
      if ((err as Error).name !== "AbortError") await copy(url, "Link copied");
    }
  }

  return (
    <main className="page share">
      <header className="top">
        <div className="eyebrow">{businessName}</div>
        <h1>{job.boatName}</h1>
        <div className="muted">Cleaned {date}</div>
      </header>

      {job.shareImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={job.shareImage} alt={`${job.boatName} before and after`} className="share-preview" />
      )}

      <div className="actions">
        {job.shareImage && (
          <button className="btn primary insta" onClick={share}>
            Share to Instagram or anywhere
          </button>
        )}
        <div className="btn-row">
          {job.shareImage && (
            <a className="btn" href={`${job.shareImage}?dl=1`} download>
              Save image
            </a>
          )}
          <button className="btn" onClick={() => copy(caption, "Caption copied")}>
            Copy caption
          </button>
          <button className="btn" onClick={() => copy(url, "Link copied")}>
            Copy link
          </button>
        </div>
        {note && <p className="note">{note}</p>}
        {job.shareImage && (
          <p className="muted small">On iPhone, tap Share, then Instagram or Save Image.</p>
        )}
      </div>

      {pairs.length > 0 && (
        <section className="stack">
          <h2>Drag to compare</h2>
          {pairs.map((p, i) => (
            <Compare key={i} before={p.before} after={p.after} />
          ))}
        </section>
      )}

      {(extras.length > 0 || (pairs.length === 0 && (job.before.length || job.after.length))) && (
        <section className="stack">
          <h2>More photos</h2>
          <div className="grid">
            {(pairs.length ? extras : [...job.before, ...job.after]).map((p) => (
              <a key={p.pathname} href={p.src} target="_blank" rel="noreferrer" className="tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt="Boat photo" loading="lazy" />
                <span className="tile-tag">{p.pathname.includes("/before/") ? "Before" : "After"}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <footer className="foot muted small">
        {businessName}
        {instagramHandle ? ` · @${instagramHandle}` : ""}
      </footer>
    </main>
  );
}

function Compare({ before, after }: { before: Photo; after: Photo }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="compare">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after.src} alt="After" loading="lazy" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={before.src}
        alt="Before"
        loading="lazy"
        className="compare-before"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />
      <div className="compare-line" style={{ left: `${pos}%` }} />
      <span className="compare-tag left">Before</span>
      <span className="compare-tag right">After</span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Slide to compare before and after"
      />
    </div>
  );
}
