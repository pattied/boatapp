import Link from "next/link";
import ManagerSignIn from "@/components/SignInForm";
import { signOut } from "@/app/actions/session";
import { getConfig } from "@/lib/config";
import { q } from "@/lib/db";
import { ensureGenerated } from "@/lib/schedule";
import { managerSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manager", robots: { index: false, follow: false } };

const NAV = [
  ["/manager", "Needs attention"],
  ["/manager/schedule", "Schedule"],
  ["/manager/reschedule", "Reschedule"],
  ["/manager/customers", "Customers"],
  ["/manager/requests", "Requests"],
  ["/manager/issues", "Issues"],
  ["/manager/marinas", "Marinas"],
  ["/manager/crews", "Crews"],
  ["/manager/services", "Services"],
  ["/manager/billing", "Billing export"],
  ["/manager/activity", "Activity"],
] as const;

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const { businessName } = getConfig();
  if (!(await managerSession())) return <ManagerSignIn businessName={businessName} />;
  await ensureGenerated(q);
  return (
    <div className="mgr">
      <header className="mgr-bar">
        <div className="mgr-brand">
          <span className="eyebrow">{businessName} · Manager</span>
        </div>
        <nav className="mgr-nav">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <form action={signOut}>
          <button className="linkish" type="submit">Sign out</button>
        </form>
      </header>
      <main className="mgr-main">{children}</main>
    </div>
  );
}
