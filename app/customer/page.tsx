import CustomerHome from "@/components/CustomerHome";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your boat photos", robots: { index: false, follow: false } };

export default function Page() {
  return <CustomerHome businessName={getConfig().businessName} />;
}
