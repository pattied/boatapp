import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import SharePage, { type SharePageData } from "@/components/SharePage";
import { getConfig } from "@/lib/config";
import { fmtDay } from "@/lib/dates";
import { one } from "@/lib/db";
import { isPublicId } from "@/lib/ids";
import { getJobByPublicId, jobPhotos } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

async function baseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// The customer's photo page for one visit. The link is the key: 128 random bits, no login.
async function load(publicId: string): Promise<SharePageData | null> {
  if (!isPublicId(publicId)) return null;
  const job = await getJobByPublicId(publicId);
  if (!job || ["cancelled"].includes(job.status)) return null;
  const photos = await jobPhotos([job.id]);
  const portal = await one<{ portal_token: string }>("select portal_token from customers where id = $1", [job.customer_id]);
  const slotOf = (kind: string, slot: string) => photos.filter((p) => p.kind === kind && p.slot === slot).at(-1);
  const pairs = job.shot_list
    .map((slot) => ({ slot, b: slotOf("before", slot), a: slotOf("after", slot) }))
    .filter((x) => x.b && x.a)
    .map((x) => ({ slot: x.slot, before: x.b!.src, after: x.a!.src }));
  const paired = new Set(pairs.flatMap((p) => [p.before, p.after]));
  const extras = photos
    .filter((p) => (p.kind === "before" || p.kind === "after") && !paired.has(p.src))
    .map((p) => ({ src: p.src, label: `${p.kind === "before" ? "Before" : "After"}${p.slot && p.slot !== "Extra" ? ` · ${p.slot}` : ""}` }));
  const share = photos.filter((p) => p.kind === "share").at(-1);
  return {
    publicId,
    boatName: job.boat_name,
    date: fmtDay(job.scheduled_date, { month: "long", day: "numeric", year: "numeric" }),
    partial: job.status === "partial",
    pairs,
    extras,
    shareImage: share?.src ?? null,
    portalPath: portal ? `/portal/${portal.portal_token}` : null,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const data = await load(id).catch(() => null);
  if (!data) return { title: "Photos not found", robots: { index: false } };
  const { businessName } = getConfig();
  const base = await baseUrl();
  const image = data.shareImage ?? data.pairs[0]?.after ?? data.extras[0]?.src;
  const title = `${data.boatName}: before & after`;
  const description = `Fresh clean by ${businessName}.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, url: `${base}/j/${id}`, type: "website", images: image ? [{ url: `${base}${image}` }] : [] },
    twitter: { card: "summary_large_image", title, description, images: image ? [`${base}${image}`] : [] },
  };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();
  const { businessName, instagramHandle } = getConfig();
  return <SharePage data={data} url={`${await baseUrl()}/j/${id}`} businessName={businessName} instagramHandle={instagramHandle} />;
}
