"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { addMyBoat } from "@/lib/client";

export type SharePageData = {
  publicId: string;
  boatName: string;
  date: string;
  partial: boolean;
  pairs: { slot: string; before: string; after: string }[];
  extras: { src: string; label: string }[];
  shareImage: string | null;
  portalPath: string | null;
};

export default function SharePage({ data, url, businessName, instagramHandle }: { data: SharePageData; url: string; businessName: string; instagramHandle: string }) {
  const shareFile = useRef<File | null>(null);
  const [note, setNote] = useState("");
  const caption = `Fresh clean on ${data.boatName} by ${businessName}${instagramHandle ? ` @${instagramHandle}` : ""}`;

  useEffect(() => {
    addMyBoat({ id: data.publicId, boatName: data.boatName, date: `Cleaned ${data.date}` });
  }, [data.publicId, data.boatName, data.date]);

  // iPhones only allow sharing during the tap itself, so load the image ahead of time.
  useEffect(() => {
    if (!data.shareImage) return;
    fetch(data.shareImage)
      .then((r) => r.blob())
      .then((b) => {
        shareFile.current = new File([b], `${data.boatName.replace(/[^a-z0-9]+/gi, "-")}-before-after.jpg`, { type: "image/jpeg" });
      })
      .catch(() => {});
  }, [data.shareImage, data.boatName]);

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
        await navigator.share({ title: `${data.boatName}: before & after`, url });
        return;
      }
      await copy(url, "Link copied");
    } catch (err) {
      if ((err as Error).name !== "AbortError") await copy(url, "Link copied");
    }
  }

  const hasPhotos = data.pairs.length + data.extras.length > 0 || data.shareImage;

  return (
    <main className="page share">
      <header className="top">
        <div className="eyebrow">{businessName}</div>
        <h1>{data.boatName}</h1>
        <div className="muted">{data.partial ? "Partly cleaned" : "Cleaned"} {data.date}</div>
      </header>

      {!hasPhotos && <p className="muted">Photos are still uploading from the crew&apos;s phone. Check back shortly.</p>}

      {data.shareImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.shareImage} alt={`${data.boatName} before and after`} className="share-preview" />
      )}

      {hasPhotos && (
        <div className="actions">
          {data.shareImage && (
            <button className="btn primary insta" onClick={share}>Share to Instagram or anywhere</button>
          )}
          <div className="btn-row">
            {data.shareImage && (
              <a className="btn" href={`${data.shareImage}?dl=1`} download>Save image</a>
            )}
            <button className="btn" onClick={() => copy(caption, "Caption copied")}>Copy caption</button>
            <button className="btn" onClick={() => copy(url, "Link copied")}>Copy link</button>
          </div>
          {note && <p className="note">{note}</p>}
          {data.shareImage && <p className="muted small">On iPhone, tap Share, then Instagram or Save Image.</p>}
        </div>
      )}

      {data.pairs.length > 0 && (
        <section className="stack">
          <h2>Drag to compare</h2>
          {data.pairs.map((p) => (
            <div key={p.slot} className="stack tight">
              <span className="muted small">{p.slot}</span>
              <Compare before={p.before} after={p.after} />
            </div>
          ))}
        </section>
      )}

      {data.extras.length > 0 && (
        <section className="stack">
          <h2>More photos</h2>
          <div className="grid">
            {data.extras.map((p) => (
              <a key={p.src} href={p.src} target="_blank" rel="noreferrer" className="tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt="Boat photo" loading="lazy" />
                <span className="tile-tag">{p.label}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <footer className="foot muted small">
        {businessName}
        {instagramHandle ? ` · @${instagramHandle}` : ""}
        <br />
        {data.portalPath ? <Link href={data.portalPath}>Your boat page: schedule, history and more</Link> : <Link href="/customer">Your cleanings</Link>}
      </footer>
    </main>
  );
}

function Compare({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="compare">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt="After" loading="lazy" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={before} alt="Before" loading="lazy" className="compare-before" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <div className="compare-line" style={{ left: `${pos}%` }} />
      <span className="compare-tag left">Before</span>
      <span className="compare-tag right">After</span>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Slide to compare before and after" />
    </div>
  );
}
