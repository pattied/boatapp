"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export const NAV = [
  ["/manager", "Needs attention"],
  ["/manager/schedule", "Schedule"],
  ["/manager/reschedule", "Reschedule"],
  ["/manager/customers", "Customers"],
  ["/manager/messages", "Messages"],
  ["/manager/templates", "Templates"],
  ["/manager/requests", "Requests"],
  ["/manager/issues", "Issues"],
  ["/manager/marinas", "Marinas"],
  ["/manager/crews", "Crews"],
  ["/manager/services", "Services"],
  ["/manager/billing", "Exports"],
  ["/manager/activity", "Activity"],
] as const;

function current(path: string) {
  // The longest matching prefix wins, so /manager/customers/123 highlights Customers.
  return [...NAV].sort((a, b) => b[0].length - a[0].length).find(([href]) => path === href || path.startsWith(`${href}/`)) ?? NAV[0];
}

// Desktop: brand and Sign out on top, links in a row below. Phone: the current page name and a Menu button that opens the full list.
export default function ManagerNav({ businessName, signOut }: { businessName: string; signOut: (fd: FormData) => void | Promise<void> }) {
  const path = usePathname() ?? "/manager";
  const [open, setOpen] = useState(false);
  const [href, label] = current(path);

  useEffect(() => setOpen(false), [path]);

  return (
    <header className={`mgr-bar${open ? " open" : ""}`}>
      <div className="mgr-top">
        <div className="mgr-brand">
          <span className="eyebrow">{businessName} · Manager</span>
          <span className="mgr-current">{label}</span>
        </div>
        <form action={signOut} className="mgr-signout-top">
          <button className="linkish" type="submit">Sign out</button>
        </form>
        <button type="button" className="mgr-menu-btn" aria-expanded={open} aria-controls="mgr-nav" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Menu"}
        </button>
      </div>
      <nav id="mgr-nav" className="mgr-nav">
        {NAV.map(([h, l]) => (
          <Link key={h} href={h} className={h === href ? "on" : undefined} aria-current={h === href ? "page" : undefined}>
            {l}
          </Link>
        ))}
        <form action={signOut} className="mgr-signout">
          <button className="linkish" type="submit">Sign out</button>
        </form>
      </nav>
    </header>
  );
}
