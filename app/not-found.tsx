import Link from "next/link";
import { getConfig } from "@/lib/config";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  const { businessName } = getConfig();
  return (
    <main className="page">
      <header className="top">
        <div className="eyebrow">{businessName}</div>
        <h1>We can&apos;t find that page</h1>
        <p className="muted">
          The link may be mistyped, or the visit or customer it pointed to was removed. If we sent you this link, reply to
          us and we&apos;ll send a new one.
        </p>
      </header>
      <Link href="/" className="btn primary">Go to the start screen</Link>
    </main>
  );
}
