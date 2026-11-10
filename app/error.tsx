"use client";

import Link from "next/link";

// Shown when a page fails to load. The details go to the server log, not to the screen.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page">
      <header className="top">
        <div className="eyebrow">Crisp Clean Marine</div>
        <h1>Something went wrong</h1>
        <p className="muted">Nothing was lost. Try again, and if it keeps happening, let us know what you were doing.</p>
      </header>
      <div className="btn-row">
        <button className="btn primary" onClick={reset}>Try again</button>
        <Link href="/" className="btn">Start screen</Link>
      </div>
    </main>
  );
}
