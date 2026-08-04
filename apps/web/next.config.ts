import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-rendered (the default). `output: "export"` is deliberately gone:
  // the backend now lives in this app as Route Handlers under `src/app/api`,
  // and a static export has no server runtime to run them. Deploying to Vercel
  // needs no adapter — `next build` output is consumed natively.

  // `trailingSlash` is likewise gone. It existed so a plain static file server
  // could resolve `/docs` to `out/docs/index.html`; with a real server there
  // is nothing to work around, and keeping it would have redirected every API
  // route (`/api/v1/collections` → `/api/v1/collections/`), breaking clients.

  // `unpdf` bundles its own PDF.js build with dynamic requires that Next's
  // bundler cannot statically analyze. Marking it external keeps it as a plain
  // Node dependency of the function instead.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
