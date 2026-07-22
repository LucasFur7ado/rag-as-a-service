# RAG as a Service

A multi-tenant **Retrieval-Augmented Generation** platform, scaffolded as a
pnpm monorepo. This repository is a **structure-only skeleton**: the auth flow,
routing, typed seams, and infrastructure-as-code are in place, but the RAG
features themselves (parsing, chunking, embeddings, vector upsert/query,
retrieval, re-ranking, generation) are intentionally left as typed `// TODO`
stubs to be implemented incrementally.

## Architecture

Two deployables plus a shared types package:

```
.
├── apps/
│   ├── web/        # Next.js 16 (App Router) frontend — Tailwind, shadcn/ui, Clerk.
│   │               # Static export (`output: 'export'`) → `out/`, any static host.
│   └── api/        # Cloudflare Worker backend API — Hono router, Clerk JWT auth.
│                   # Managed as IaC via wrangler.jsonc.
├── packages/
│   └── shared/     # Shared TypeScript domain types (no runtime logic).
├── pnpm-workspace.yaml
└── tsconfig.base.json   # strict TS config extended by every package
```

**Web ↔ API split.** The web app is a fully static, client-rendered SPA (no
server runtime): the landing page is pre-rendered to HTML at build time and
everything else runs in the browser. Auth is Clerk **client-side only** — there
is no Next middleware/proxy and no server-side session. It talks to the API
worker over HTTP: the typed
client in [`apps/web/src/lib/api-client.ts`](apps/web/src/lib/api-client.ts)
attaches the Clerk session token as a `Bearer` header (see the example `/me`
call). The API worker verifies that token against Clerk's JWKS and derives
`{ userId, tenantId }` for every protected request.

**Where features plug in (all currently stubbed):**

| Seam | Location |
| --- | --- |
| Embeddings provider | [`apps/api/src/services/embeddings.ts`](apps/api/src/services/embeddings.ts) |
| Vector store (Pinecone later) | [`apps/api/src/services/vectorstore.ts`](apps/api/src/services/vectorstore.ts) |
| LLM provider | [`apps/api/src/services/llm.ts`](apps/api/src/services/llm.ts) |
| Ingestion workflow | [`apps/api/src/workflows/ingest.ts`](apps/api/src/workflows/ingest.ts) |
| Feature routes (`collections`, `documents`, `query`, `apikeys`) | [`apps/api/src/routes/`](apps/api/src/routes/) — return `501 Not Implemented` |
| Shared domain types | [`packages/shared/src/index.ts`](packages/shared/src/index.ts) |

## Prerequisites

- **Node.js ≥ 20** (developed on Node 24)
- **pnpm 9** (`corepack enable` then `corepack prepare pnpm@9.15.4 --activate`)
- A **Clerk** application (for auth) — free tier is fine
- A **Cloudflare** account with **Wrangler** authenticated (`pnpm dlx wrangler login`) to deploy the API worker
- Any **static host** (S3+CloudFront, Cloudflare Pages, nginx, ...) for the web app
- *(Later, for RAG features)* a **Pinecone** account

## Install

```bash
pnpm install
```

## Environment setup

Each app owns its env file — there is no root `.env`. Copy the example next to
it and fill in real values. Never commit real secrets.

```bash
cp apps/web/.env.example apps/web/.env.local     # web: build-time public vars
cp apps/api/.dev.vars.example apps/api/.dev.vars # api: local dev secrets
```

- **Web** ([`apps/web/.env.example`](apps/web/.env.example)) — `NEXT_PUBLIC_*`
  vars only, baked into the static bundle at build time and public by design.
  Required: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL`. There is
  **no** `CLERK_SECRET_KEY` — the web app never runs server-side code, so it
  only ever needs the publishable key.
- **API** ([`apps/api/.dev.vars.example`](apps/api/.dev.vars.example)) — secrets
  for local `wrangler dev`; in production set them with
  `wrangler secret put <NAME>`. Required: `CLERK_ISSUER` (your Clerk Frontend
  API URL), and later `PINECONE_API_KEY` / `PINECONE_INDEX`.
- **Deploys** need no env file: Wrangler authenticates via
  `pnpm dlx wrangler login` (or a `CLOUDFLARE_API_TOKEN` shell variable in CI).

> Without a real `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` the app still **builds** (a
> format-valid placeholder is used so prerender succeeds), but the sign-in flow
> and `/dashboard` gating only work once real Clerk keys are set.

## Run in dev

Run both apps together from the repo root:

```bash
pnpm dev          # web on http://localhost:3000, api on http://localhost:8787
```

Or individually:

```bash
pnpm --filter web dev
pnpm --filter api dev
```

Quick API check (no auth needed):

```bash
curl http://localhost:8787/health          # -> {"status":"ok","version":"0.1.0",...}
curl http://localhost:8787/me              # -> 401 {"error":"Missing bearer token"}
```

## Scripts (root)

| Script | Description |
| --- | --- |
| `pnpm dev` | Run web + api dev servers in parallel |
| `pnpm build` | Build every package (types + `next build`) |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm lint` | Lint all packages |
| `pnpm deploy:web` | Static-export the web app to `apps/web/out/` for upload |
| `pnpm deploy:api` | Deploy the API worker |

## Deploy

The API deploys to **Cloudflare Workers**; the web app is a static bundle that
goes to any static host.

**API worker** — authenticate Wrangler first (`pnpm dlx wrangler login`):

```bash
# One-time: provision the placeholder resources referenced in wrangler.jsonc
pnpm dlx wrangler kv namespace create RAG_KV     # paste the id into apps/api/wrangler.jsonc
pnpm dlx wrangler queues create ingest-queue
pnpm dlx wrangler queues create ingest-queue-dlq
# Secrets
cd apps/api && pnpm dlx wrangler secret put CLERK_ISSUER   # repeat per secret

pnpm deploy:api
```

**Web app (static export — no server runtime):**

```bash
pnpm deploy:web   # runs `next build`, producing apps/web/out/
```

Then upload `apps/web/out/` to whichever static host you use, e.g.:

```bash
aws s3 sync apps/web/out/ s3://your-bucket --delete   # + a CloudFront invalidation
# or
pnpm dlx wrangler pages deploy apps/web/out --project-name rag-web
```

`trailingSlash: true` means every route is an `index.html` inside its own
directory, so no host-side rewrite rules are needed. Point `404.html` at the
host's error page if it supports one. Build-time env vars
(`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL`) are baked into the
bundle, so set them **before** running the build for each environment.

See [`apps/web/README.md`](apps/web/README.md) for the static-export details.

## What is intentionally NOT implemented

Document parsing/chunking, embeddings, vector upsert/query, retrieval,
re-ranking, LLM generation/streaming, the ingestion workflow body, API-key
generation, rate limiting, billing, analytics, and all feature UIs. These live
behind the typed seams listed above and currently throw
`"not implemented"` / return `501`.
