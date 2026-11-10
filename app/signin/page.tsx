import { redirect } from "next/navigation";
import ManagerSignIn from "@/components/SignInForm";
import { getConfig } from "@/lib/config";
import { managerSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manager sign-in", robots: { index: false, follow: false } };

// Manager sign-in lives outside the manager pages, so no manager screen is ever part of this page.
export default async function SignIn() {
  if (await managerSession()) redirect("/manager");
  return <ManagerSignIn businessName={getConfig().businessName} />;
}
