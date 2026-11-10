import ManagerNav from "@/components/ManagerNav";
import { signOut } from "@/app/actions/session";
import { after } from "next/server";
import { getConfig } from "@/lib/config";
import { runDaily } from "@/lib/messaging/send";
import { q } from "@/lib/db";
import { ensureGenerated } from "@/lib/schedule";
import { requireManager } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manager", robots: { index: false, follow: false } };


export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const { businessName } = getConfig();
  await requireManager();
  await ensureGenerated(q);
  after(() => runDaily()); // reminders and anything waiting to send; never slows the page
  return (
    <div className="mgr">
      <ManagerNav businessName={businessName} signOut={signOut} />
      <main className="mgr-main">{children}</main>
    </div>
  );
}
