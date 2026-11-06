import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import { isPublicId } from "@/lib/ids";

export const metadata = { title: "Thanks for signing up", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ portal?: string }> };

export default async function Thanks({ searchParams }: Props) {
  const { portal } = await searchParams;
  const path = portal && isPublicId(portal) ? `/portal/${portal}` : null;
  return (
    <main className="page">
      <header className="top">
        <div className="eyebrow">Customer</div>
        <h1>Thanks, you&apos;re signed up</h1>
        <p className="muted">We&apos;ll review your details and confirm your first cleaning.</p>
      </header>
      {path && (
        <section className="card stack">
          <h2>Your private boat page</h2>
          <p className="muted small">
            Bookmark this link. It shows your schedule, photos and anything our crew flags. Anyone with the link can see it,
            so keep it to yourself.
          </p>
          <Link href={path} className="btn primary">Open my boat page</Link>
          <CopyButton text={path} absolute label="Copy link" />
        </section>
      )}
    </main>
  );
}
