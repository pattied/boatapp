import Home from "@/components/Home";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Page() {
  const config = getConfig();
  return <Home businessName={config.businessName} passcodeRequired={config.passcodeRequired} />;
}
