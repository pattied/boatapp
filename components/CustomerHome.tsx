"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getMyBoats, getMyPortals, type MyBoat, type MyPortal } from "@/lib/client";

// Customers have no passwords: their private boat-page link is their key. Links opened on this phone show here.
export default function CustomerHome({ businessName }: { businessName: string }) {
  const router = useRouter();
  const [boats, setBoats] = useState<MyBoat[]>([]);
  const [portals, setPortals] = useState<MyPortal[]>([]);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setBoats(getMyBoats());
    setPortals(getMyPortals());
  }, []);

  function open(e: React.FormEvent) {
    e.preventDefault();
    const m = link.trim().match(/(?:\/(j|portal)\/)?([A-Za-z0-9_-]{22})(?:[/?#].*)?$/);
    if (!m) {
      setError("That doesn't look like one of our links. Paste the whole link.");
      return;
    }
    router.push(`/${m[1] === "portal" ? "portal" : "j"}/${m[2]}`);
  }

  return (
    <main className="page">
      <header className="top">
        <div className="eyebrow">{businessName} · Customer</div>
        <h1>Your boat</h1>
        <p className="muted small">
          Your private boat page shows your schedule, before and after photos, and anything our crew flagged. Pages
          you open on this phone show up here.
        </p>
      </header>

      {portals.length > 0 && (
        <section className="stack">
          <h2>Your boat page</h2>
          {portals.map((p) => (
            <Link key={p.token} href={`/portal/${p.token}`} className="row-link">
              <strong>{p.name}</strong>
              <span className="small">Open ›</span>
            </Link>
          ))}
        </section>
      )}

      {boats.length > 0 && (
        <section className="stack">
          <h2>Recent cleanings</h2>
          {boats.map((b) => (
            <Link key={b.id} href={`/j/${b.id}`} className="row-link">
              <strong>{b.boatName}</strong>
              <span className="muted">{b.date}</span>
            </Link>
          ))}
        </section>
      )}

      <form className="card stack" onSubmit={open}>
        <h2>Open a link</h2>
        <label className="field">
          <span>Paste the link we sent you</span>
          <input
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setError("");
            }}
            placeholder="https://…/portal/…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={!link.trim()}>Open</button>
      </form>

      <section className="card stack">
        <h2>New customer?</h2>
        <p className="muted small">Tell us about your boat and where it&apos;s berthed. We&apos;ll confirm your first cleaning.</p>
        <Link href="/signup" className="btn">Sign up for cleanings</Link>
      </section>

      <Link href="/" className="manager-link">Switch role</Link>
    </main>
  );
}
