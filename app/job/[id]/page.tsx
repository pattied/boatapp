import { notFound } from "next/navigation";
import JobEditor from "@/components/JobEditor";
import { getConfig } from "@/lib/config";
import { isJobId } from "@/lib/ids";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isJobId(id)) notFound();
  const { businessName, instagramHandle } = getConfig();
  return <JobEditor id={id} businessName={businessName} instagramHandle={instagramHandle} />;
}
