import Manager from "@/components/Manager";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manager", robots: { index: false, follow: false } };

export default function Page() {
  return <Manager businessName={getConfig().businessName} />;
}
