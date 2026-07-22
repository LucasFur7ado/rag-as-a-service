# apps/web

Next.js (App Router) frontend for RAG-as-a-Service — Tailwind, shadcn/ui, and
Clerk auth, built as a **fully static export** (`output: 'export'`).

`pnpm --filter web build` emits a self-contained site to `apps/web/out/`. There
is no Next.js server: deploy by uploading that directory to any static host
(S3 + CloudFront, Cloudflare Pages/R2, nginx, GitHub Pages, ...).

## Architecture notes

- **Static-only.** No SSR, no Next API routes, no Server Actions, no ISR, and no
  `proxy.ts`/`middleware.ts`. The landing page (`/`) is pre-rendered to HTML at
  build time; everything auth- or data-dependent is client-rendered and talks to
  the API worker (apps/api) over `NEXT_PUBLIC_API_URL`.
- **`trailingSlash: true`** so routes land on `out/<route>/index.html` and work
  on plain file servers without rewrite rules.
- **`images.unoptimized: true`** — `next/image`'s default loader needs a server.
- **Clerk is client-side only**, via **`@clerk/react`**, not `@clerk/nextjs`.
  The App Router `ClerkProvider` in `@clerk/nextjs` registers Server Actions
  internally (keyless mode), and `next build` fails with *"Server Actions are
  not supported with static export."* `@clerk/react` is the same Clerk core with
  a browser-only provider; `src/components/providers.tsx` wires its
  `routerPush`/`routerReplace` to the Next router so navigation stays client-side.
- **Route protection is client-side.** `src/components/require-auth.tsx` wraps
  protected pages in `<Show when="signed-in">` / `<Show when="signed-out">` +
  `<RedirectToSignIn>` (Clerk v7 replaced `<SignedIn>`/`<SignedOut>` with
  `<Show>`). This only hides UI — the API worker verifies the JWT and is the
  real trust boundary.
- **Sign-in/sign-up** keep their catch-all routes but use `routing="hash"`, so
  Clerk's multi-step flow lives in the URL hash and one static HTML file per
  route is enough.
- **Dynamic dashboard views** (a single collection, etc.) must use client-side
  routing / query params — e.g. `/dashboard/?collection=<id>` — never
  `generateStaticParams`, since IDs aren't known at build time.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm --filter web dev` | Next dev server on :3000 |
| `pnpm --filter web build` | Static export to `apps/web/out/` |
| `pnpm --filter web preview` | Build, then serve `out/` as plain static files |
| `pnpm deploy:web` (root) | Build; upload `apps/web/out/` to your static host |

See the [root README](../../README.md) for env vars and the API worker.
