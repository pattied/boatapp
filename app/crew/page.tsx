import CrewApp from "@/components/crew/CrewApp";
import { getConfig } from "@/lib/config";
import { techSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Technician", robots: { index: false, follow: false } };

export default async function Page() {
  const { businessName, instagramHandle } = getConfig();
  const s = await techSession();
  return <CrewApp businessName={businessName} instagramHandle={instagramHandle} hasSession={Boolean(s)} />;
}
