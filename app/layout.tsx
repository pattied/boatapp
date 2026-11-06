import type { Metadata, Viewport } from "next";
import { getConfig } from "@/lib/config";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { businessName } = getConfig();
  return {
    title: businessName,
    appleWebApp: { capable: true, title: businessName, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0F2A44",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
