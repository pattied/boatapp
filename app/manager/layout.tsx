import ManagerNav from "@/components/ManagerNav";
import ManagerSignIn from "@/components/SignInForm";
import { signOut } from "@/app/actions/session";
import { getConfig } from "@/lib/config";
import { q } from "@/lib/db";
import { ensureGenerated } from "@/lib/schedule";
import { managerSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manager", robots: { index: false, follow: false } };


export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const { businessName } = getConfig();
  if (!(await managerSession())) return <ManagerSignIn businessName={businessName} />;
  await ensureGenerated(q);
  return (
    <div className="mgr">
      <ManagerNav businessName={businessName} signOut={signOut} />
      <main className="mgr-main">{children}</main>
    </div>
  );
}
