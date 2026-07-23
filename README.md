# RAG as a Service

A multi-tenant **Retrieval-Augmented Generation** platform, scaffolded as a
pnpm monorepo. Implemented so far:

- **Feature 1 — collections & documents**: tenant-scoped CRUD backed by
  Cloudflare D1 (metadata, via Drizzle ORM) and R2 (raw files), with a
  dashboard UI.
- **Feature 2 — async ingestion pipeline**: uploads are parsed, chunked,
  embedded (Workers AI, BGE-M3) and upserted to Pinecone by a durable
  Cloudflare Workflow, with live status in the dashboard. See
  [Ingestion pipeline](#ingestion-pipeline-feature-2).

Retrieval/query/generation (Feature 3) and API keys (Feature 4) remain typed
`// TODO` stubs.

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

**Implemented — collections & documents (Feature 1):**

| Piece | Location |
| --- | --- |
| D1 schema (Drizzle) + serializers | [`apps/api/src/db/`](apps/api/src/db/) |
| SQL migrations (drizzle-kit output) | [`apps/api/migrations/`](apps/api/migrations/) |
| Collections API (`/v1/collections`, incl. document upload/list) | [`apps/api/src/routes/collections.ts`](apps/api/src/routes/collections.ts) |
| Documents API (`/v1/documents`) | [`apps/api/src/routes/documents.ts`](apps/api/src/routes/documents.ts) |
| Dashboard UI (list + detail via `view?id=…`) | [`apps/web/src/app/dashboard/collections/`](apps/web/src/app/dashboard/collections/) |
| Typed API client | [`apps/web/src/lib/api-client.ts`](apps/web/src/lib/api-client.ts) |

**Implemented — ingestion pipeline (Feature 2):**

| Piece | Location |
| --- | --- |
| Durable ingestion Workflow (parse → chunk → embed → upsert) | [`apps/api/src/workflows/ingest.ts`](apps/api/src/workflows/ingest.ts) |
| Queue consumer (starts one Workflow instance per upload) | [`apps/api/src/index.ts`](apps/api/src/index.ts) |
| Text extraction (PDF via `unpdf`, txt/markdown) | [`apps/api/src/lib/extract.ts`](apps/api/src/lib/extract.ts) |
| Recursive chunker with overlap | [`apps/api/src/lib/chunking.ts`](apps/api/src/lib/chunking.ts) |
| Embeddings (Workers AI, `@cf/baai/bge-m3`) | [`apps/api/src/services/embeddings.ts`](apps/api/src/services/embeddings.ts) |
| Vector store (Pinecone over REST) + namespace/id helpers | [`apps/api/src/services/vectorstore.ts`](apps/api/src/services/vectorstore.ts) |
| Tuning constants (chunk sizes, batch limits, model/dimension) | [`apps/api/src/config.ts`](apps/api/src/config.ts) |
| Status & reingest endpoints (`/v1/documents/:id/status`, `.../reingest`) | [`apps/api/src/routes/documents.ts`](apps/api/src/routes/documents.ts) |

All endpoints are tenant-scoped: every query filters by the `tenantId` derived
from the Clerk JWT, and resources owned by another tenant return **404** (never
a 403 that would leak existence). Uploads accept PDF / plain text / Markdown up
to 25 MB; raw files land in R2 under
`tenants/{tenantId}/collections/{collectionId}/documents/{documentId}/{filename}`.

**Where the remaining features plug in (still stubbed):**

| Seam | Location |
| --- | --- |
| LLM provider | [`apps/api/src/services/llm.ts`](apps/api/src/services/llm.ts) |
| Feature routes (`query`, `apikeys`) | [`apps/api/src/routes/`](apps/api/src/routes/) — return `501 Not Implemented` |
| Shared domain types | [`packages/shared/src/index.ts`](packages/shared/src/index.ts) |

## Prerequisites

- **Node.js ≥ 20** (developed on Node 24)
- **pnpm 9** (`corepack enable` then `corepack prepare pnpm@9.15.4 --activate`)
- A **Clerk** application (for auth) — free tier is fine
- A **Cloudflare** account with **Wrangler** authenticated (`pnpm dlx wrangler login`) to deploy the API worker
- Any **static host** (S3+CloudFront, Cloudflare Pages, nginx, ...) for the web app
- A **Pinecone** account (serverless index; free tier is fine) — required for ingestion (Feature 2)

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
  API URL) and `PINECONE_API_KEY` (ingestion).
- **API plain vars** ([`apps/api/wrangler.jsonc`](apps/api/wrangler.jsonc)
  `vars`) — `WEB_ORIGIN`: origin(s) of the web SPA allowed by CORS,
  comma-separated (default `http://localhost:3000`); `PINECONE_INDEX` /
  `PINECONE_INDEX_HOST`: the Pinecone index name and its data-plane host (see
  [Pinecone setup](#pinecone-setup)). Set your deployed web origin here (or in
  a Wrangler environment) before deploying the API.
- **Deploys** need no env file: Wrangler authenticates via
  `pnpm dlx wrangler login` (or a `CLOUDFLARE_API_TOKEN` shell variable in CI).

> Without a real `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` the app still **builds** (a
> format-valid placeholder is used so prerender succeeds), but the sign-in flow
> and `/dashboard` gating only work once real Clerk keys are set.

### Pinecone setup

Ingestion embeds with **`@cf/baai/bge-m3`** (Workers AI), which produces
**1024-dimensional** dense vectors — the Pinecone index **must** be created
with that dimension and the **cosine** metric (the pipeline verifies this at
run time and fails with a clear error on mismatch):

1. In the [Pinecone console](https://app.pinecone.io/) create a **serverless**
   index, e.g. `rag-index`, with **dimension `1024`** and **metric `cosine`**
   (any cloud/region).
2. Copy the index **host** shown on the index page (looks like
   `rag-index-abc1234.svc.aped-1234-a56b.pinecone.io`) into the
   `PINECONE_INDEX_HOST` var (`wrangler.jsonc` for deploys, `.dev.vars` for
   local dev) and the index name into `PINECONE_INDEX`.
3. Create an API key and set it as a secret:
   `pnpm dlx wrangler secret put PINECONE_API_KEY` (local dev: `.dev.vars`).

The Worker talks to Pinecone's data-plane REST API directly (no SDK), so
nothing else needs installing.

## Ingestion pipeline (Feature 2)

Uploading a document returns immediately with `status: "uploaded"` and kicks
off asynchronous ingestion:

```
POST /v1/collections/:id/documents
   └─ enqueue → INGEST_QUEUE → queue consumer → IngestWorkflow instance
        1. mark processing         (D1: status = processing)
        2. extract text            (R2 → unpdf for PDF, decode for txt/md;
                                    keeps page numbers for later citations)
        3. chunk text              (recursive character splitting w/ overlap)
        4. verify index dimension  (embedding dim must match Pinecone index)
        5. embed + upsert batches  (Workers AI bge-m3, ≤100 inputs/request →
                                    Pinecone upserts ≤150 vectors & <2 MB/request)
        6. finalize                (D1: status = ready + chunk count)
      on any failure → D1: status = error + readable message
```

Design notes:

- **Durable & retryable** — each phase is a Cloudflare Workflows `step.do`
  with exponential-backoff retries; a transient failure (network, 429, 5xx)
  resumes from the failed step. Deterministic failures (unparseable/empty
  file, provider 4xx, config mismatch) throw `NonRetryableError` and mark the
  document `error` immediately — nothing hangs in `processing`.
- **Queue as trigger** — the upload route only enqueues (uploads stay fast);
  the queue consumer starts one Workflow instance per message and gets its own
  retries + dead-letter queue (`ingest-queue-dlq`).
- **Idempotent** — vector ids are deterministic (`{documentId}#{chunkIndex}`),
  so re-running ingestion overwrites vectors instead of duplicating them.
- **Tenant isolation** — vectors live in a per-tenant+collection namespace
  (`t_{tenantId}__c_{collectionId}`, built by `vectorNamespace()` in
  [`vectorstore.ts`](apps/api/src/services/vectorstore.ts)). Each vector
  carries `tenantId`, `collectionId`, `documentId`, `chunkIndex`, `page`,
  `filename` and the chunk text as metadata.
- **Dense-only vectors** — the Workers AI bge-m3 binding exposes dense
  embeddings only (no sparse/lexical weights), so hybrid search is deferred
  (`// TODO (Feature 3)` in
  [`embeddings.ts`](apps/api/src/services/embeddings.ts)).
- **Tuning** — chunk size/overlap, batch sizes and the embedding model live in
  [`apps/api/src/config.ts`](apps/api/src/config.ts). After changing them, hit
  **Reprocess** in the dashboard (or `POST /v1/documents/:id/reingest`) to
  re-run ingestion for a document.
- **Status** — `GET /v1/documents/:id/status` returns
  `{ status, chunkCount?, error?, updatedAt }`; the dashboard polls it while
  any document is processing and shows chunk counts / error messages inline.
- **Deletes clean up vectors** — deleting a document removes its vectors (by
  id prefix) and its R2 folder; deleting a collection removes the whole
  Pinecone namespace and R2 prefix.

Local dev: Queues, Workflows, D1 and R2 are all emulated by `wrangler dev`,
but **Workers AI always calls the real API** (inference isn't emulated), so
embedding runs incur normal Workers AI usage and need an authenticated
Wrangler session. Pinecone is likewise a real remote index even in dev.

## Run in dev

First, apply the D1 migrations to the local (miniflare) database — `wrangler
dev` emulates D1, R2, Queues and Workflows locally by default. (Workers AI and
Pinecone are always remote — see
[Ingestion pipeline](#ingestion-pipeline-feature-2) — so ingestion in dev needs
an authenticated Wrangler session and the Pinecone vars in `.dev.vars`.)

```bash
cd apps/api
pnpm db:migrate:local     # = wrangler d1 migrations apply rag-db --local
```

Then run both apps together from the repo root:

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
# One-time: provision the resources referenced in wrangler.jsonc
pnpm dlx wrangler kv namespace create RAG_KV     # paste the id into apps/api/wrangler.jsonc
pnpm dlx wrangler queues create ingest-queue
pnpm dlx wrangler queues create ingest-queue-dlq
pnpm dlx wrangler d1 create rag-db               # paste database_id into apps/api/wrangler.jsonc
pnpm dlx wrangler r2 bucket create rag-raw-docs
# Apply D1 schema migrations to the remote database
cd apps/api && pnpm db:migrate:remote            # = wrangler d1 migrations apply rag-db --remote
# Secrets
pnpm dlx wrangler secret put CLERK_ISSUER
pnpm dlx wrangler secret put PINECONE_API_KEY
# Vars in wrangler.jsonc: WEB_ORIGIN (deployed web origin), PINECONE_INDEX and
# PINECONE_INDEX_HOST (see "Pinecone setup" above — dimension 1024, cosine)

pnpm deploy:api
```

Schema changes are made in
[`apps/api/src/db/schema.ts`](apps/api/src/db/schema.ts); regenerate SQL
migrations with `pnpm db:generate` (drizzle-kit) and re-apply with
`pnpm db:migrate:local` / `pnpm db:migrate:remote`.

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

Retrieval/query (`POST /query`), re-ranking, LLM generation/streaming
(Feature 3), API-key generation and rate limiting (Feature 4), billing, and
analytics. These live behind the typed seams listed above and currently throw
`"not implemented"` / return `501`. Hybrid (sparse+dense) search is also
deferred to Feature 3 — the Workers AI bge-m3 binding exposes dense vectors
only (see the `// TODO (Feature 3)` marker in
[`embeddings.ts`](apps/api/src/services/embeddings.ts)).
