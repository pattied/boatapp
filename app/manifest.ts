import type { MetadataRoute } from "next";
import { getConfig } from "@/lib/config";

// Lets crews add the app to the home screen so it opens full screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  const { businessName } = getConfig();
  return {
    name: `${businessName} Photos`,
    short_name: "Boat Photos",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F4F7FA",
    theme_color: "#0F2A44",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }],
  };
}
