import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite loads its WebAssembly files from disk, which breaks when bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
