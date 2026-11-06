import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import SharePage from "@/components/SharePage";
import { getConfig } from "@/lib/config";
import { getJob } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

async function baseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const job = await getJob(id).catch(() => null);
  if (!job) return { title: "Photos not found", robots: { index: false } };
  const { businessName } = getConfig();
  const base = await baseUrl();
  const image = job.shareImage ?? job.after[0]?.src ?? job.before[0]?.src;
  const title = `${job.boatName}: before & after`;
  const description = `Fresh clean by ${businessName}.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      url: `${base}/j/${id}`,
      type: "website",
      images: image ? [{ url: `${base}${image}`, width: 1080, height: 1350 }] : [],
    },
    twitter: { card: "summary_large_image", title, description, images: image ? [`${base}${image}`] : [] },
  };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  const { businessName, instagramHandle } = getConfig();
  const date = new Date(job.createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
  return (
    <SharePage
      job={job}
      date={date}
      url={`${await baseUrl()}/j/${id}`}
      businessName={businessName}
      instagramHandle={instagramHandle}
    />
  );
}
