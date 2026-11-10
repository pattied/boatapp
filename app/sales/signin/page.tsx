import { redirect } from "next/navigation";
import SalesSignIn from "@/components/sales/SalesSignIn";
import { getConfig } from "@/lib/config";
import { salesUser } from "@/lib/session";

export default async function SignIn() {
  if (await salesUser()) redirect("/sales");
  return <SalesSignIn businessName={getConfig().businessName} />;
}
