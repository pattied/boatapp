import Link from "next/link";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

const ROLES = [
  { href: "/manager", title: "Manager", body: "Schedule, customers, messages and everything else." },
  { href: "/crew", title: "Technician", body: "Today's jobs, before and after photos, flags." },
  { href: "/sales", title: "Sales", body: "Walk a dock, log boats and add new leads." },
  { href: "/customer", title: "Customer", body: "Your schedule, photos and requests." },
];

export default function Page() {
  const { businessName } = getConfig();
  return (
    <main className="page">
      <header className="top">
        <div className="eyebrow">{businessName}</div>
        <h1>Sign in as</h1>
      </header>
      <nav className="roles">
        {ROLES.map((r, i) => (
          <Link key={r.href} href={r.href} className="role-card">
            <span className="role-num">{i + 1}</span>
            <span className="role-text">
              <strong>{r.title}</strong>
              <span className="muted">{r.body}</span>
            </span>
            <span className="role-arrow" aria-hidden="true">›</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
