import Link from "next/link";
import { signOut } from "@/app/actions/session";
import { getConfig } from "@/lib/config";
import { salesUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales", robots: { index: false, follow: false } };

// The frame only decorates. Every sales page checks the sign-in itself.
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const user = await salesUser();
  if (!user) return <>{children}</>;
  const { businessName } = getConfig();
  return (
    <div className="sales">
      <header className="sales-bar">
        <div className="sales-top">
          <span className="eyebrow">{businessName} · Sales{user.manager ? " (manager)" : ` · ${user.name}`}</span>
          <form action={signOut}><button className="linkish" type="submit">Sign out</button></form>
        </div>
        <nav className="sales-nav">
          <Link href="/sales">Home</Link>
          <Link href="/sales/walk">Walk a dock</Link>
          <Link href="/sales/leads/new">New lead</Link>
          <Link href="/sales/leads">Leads</Link>
          {user.manager && <Link href="/manager">Manager</Link>}
        </nav>
      </header>
      <main className="page sales-page">{children}</main>
    </div>
  );
}
