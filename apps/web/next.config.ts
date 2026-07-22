import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static export: `next build` emits a self-contained site to `out/`
  // that can be served from any static host (S3 + CloudFront, Cloudflare
  // Pages/R2, nginx, ...). There is no Next.js server runtime.
  output: "export",

  // next/image's default loader needs a server to optimize on the fly.
  images: { unoptimized: true },

  // Emit `out/<route>/index.html` (directory-style URLs) so plain static file
  // servers resolve every route without custom rewrite rules.
  trailingSlash: true,
};

export default nextConfig;
