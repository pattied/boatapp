"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getMyBoats, type MyBoat } from "@/lib/client";

// Customers have no accounts yet: their texted link is their key. Boats opened on this phone are listed here.
export default function CustomerHome({ businessName }: { businessName: string }) {
  const router = useRouter();
  const [boats, setBoats] = useState<MyBoat[]>([]);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setBoats(getMyBoats()), []);

  function open(e: React.FormEvent) {
    e.preventDefault();
    const id = link.trim().match(/(?:\/j\/)?([A-Za-z0-9_-]{22})(?:[/?#].*)?$/)?.[1];
    if (!id) {
      setError("That doesn't look like a photo link. Paste the whole link from your text.");
      return;
    }
    router.push(`/j/${id}`);
  }

  return (
    <main className="page">
      <header className="top">
        <div className="eyebrow">{businessName} · Customer</div>
        <h1>Your boat photos</h1>
        <p className="muted small">
          After each cleaning we text you a link to your before and after photos. Boats you open on this phone
          show up here.
        </p>
      </header>

      {boats.length > 0 && (
        <section className="stack">
          <h2>Recent cleanings</h2>
          <ul className="list">
            {boats.map((b) => (
              <li key={b.id}>
                <Link href={`/j/${b.id}`} className="row-link">
                  <strong>{b.boatName}</strong>
                  <span className="muted">{b.date}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form className="card stack" onSubmit={open}>
        <h2>Open a photo link</h2>
        <label className="field">
          <span>Paste the link from your text</span>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…/j/…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={!link.trim()}>View photos</button>
      </form>

      <Link href="/" className="manager-link">Switch role</Link>
    </main>
  );
}
