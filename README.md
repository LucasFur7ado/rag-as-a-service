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
- **Feature 3 — query pipeline**: a natural-language question is embedded,
  retrieved against the tenant+collection namespace, assembled into a bounded
  context and answered — grounded strictly in the retrieved chunks, streamed
  token-by-token with validated citations. See
  [Query pipeline](#query-pipeline-feature-3).
- **Feature 4 — API keys & rate limiting**: tenants mint API keys to call the
  product API programmatically; the public endpoints accept a Clerk session
  **or** an API key, and API-key traffic is rate-limited per key by an atomic
  Durable Object. See [Authentication](#authentication-session-or-api-key) and
  [Rate limiting](#rate-limiting-feature-4).

This is the full feature set for the current scaffold.

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

**Implemented — query pipeline (Feature 3):**

| Piece | Location |
| --- | --- |
| Query route (`POST /v1/collections/:id/query`, SSE + JSON) | [`apps/api/src/routes/query.ts`](apps/api/src/routes/query.ts) |
| Retrieval (embed query + tenant-filtered vector search) | [`apps/api/src/services/retrieval.ts`](apps/api/src/services/retrieval.ts) |
| Context assembly (threshold, dedupe, token budget, ordering) | [`apps/api/src/services/context.ts`](apps/api/src/services/context.ts) |
| Citation resolution (map + validate `[n]` markers) | [`apps/api/src/services/citations.ts`](apps/api/src/services/citations.ts) |
| LLM provider (Workers AI, Llama 3.3, streaming) | [`apps/api/src/services/llm.ts`](apps/api/src/services/llm.ts) |
| System prompt | [`apps/api/src/prompts.ts`](apps/api/src/prompts.ts) |
| Token counter (BPE, for the context budget) | [`apps/api/src/lib/tokens.ts`](apps/api/src/lib/tokens.ts) |
| Playground UI (streamed answer + clickable citations) | [`apps/web/src/app/dashboard/collections/playground/`](apps/web/src/app/dashboard/collections/playground/) |

**Implemented — API keys & rate limiting (Feature 4):**

| Piece | Location |
| --- | --- |
| Unified auth middleware (session **or** API key) | [`apps/api/src/lib/auth.ts`](apps/api/src/lib/auth.ts) |
| API-key management API (`/v1/api-keys`, session-only) | [`apps/api/src/routes/apikeys.ts`](apps/api/src/routes/apikeys.ts) |
| Key generation / hashing / KV cache shape | [`apps/api/src/services/apikeys.ts`](apps/api/src/services/apikeys.ts) |
| Per-key rate limiter (Durable Object) | [`apps/api/src/durable/ratelimiter.ts`](apps/api/src/durable/ratelimiter.ts) |
| API-keys dashboard (create-once, list, revoke, curl snippet) | [`apps/web/src/app/dashboard/api-keys/`](apps/web/src/app/dashboard/api-keys/) |

Shared domain types for every feature live in
[`packages/shared/src/index.ts`](packages/shared/src/index.ts).

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
  API URL), `CLERK_AUTHORIZED_PARTY` (the web app's origin(s), comma-separated)
  and `PINECONE_API_KEY` (ingestion). **Session auth fails closed without
  `CLERK_AUTHORIZED_PARTY`**: `iss` only proves a token came from your Clerk
  instance — every origin that instance authorizes shares it — so the `azp`
  claim is what pins the token to *your* frontend, and it is not optional.
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

## Query pipeline (Feature 3)

Ask a question against a collection and get a streamed, grounded answer with
citations:

```
POST /v1/collections/:id/query        body: { query, topK?, stream? }
   1. embed query        (Workers AI bge-m3 — the SAME model as ingestion)
   2. retrieve top-k     (Pinecone: tenant+collection namespace + tenantId filter)
   3. assemble context   (threshold → dedupe → token budget → reorder → label [n])
   4. generate           (Workers AI Llama 3.3, streamed, grounded system prompt)
   5. resolve citations  (map emitted [n] markers → real chunks; drop hallucinated)
```

Each stage is a separate, individually-testable function behind a service seam
(`retrieval` → `context` → `llm` → `citations`); the route only validates,
orchestrates and shapes the response — no SDK calls in the handler.

**Response modes**

- **Streaming (default)** — Server-Sent Events; each `data:` line is one JSON
  `QueryStreamEvent`: zero+ `delta` (answer text) → one `sources` (citations +
  usage) → one `done` (or an in-band `error`). The Playground consumes this so
  tokens appear progressively and citations render when generation completes.
- **`stream: false`** — a single JSON `{ answer, sources, usage }`, easy to
  call from curl and to evaluate offline:

  ```bash
  curl -X POST "$API/v1/collections/$ID/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"query":"What is the refund policy?","stream":false}'
  ```

**Model.** Generation uses **`@cf/meta/llama-3.3-70b-instruct-fp8-fast`**
(Workers AI, free-tier, instruction-tuned open weights) behind the `LlmProvider`
seam in [`llm.ts`](apps/api/src/services/llm.ts) — swap the class (or just
`GENERATION_MODEL`) to move generation elsewhere (e.g. Gemini) without touching
the pipeline. Query embedding **must** use the ingestion model
(`@cf/baai/bge-m3`); BGE-M3 is symmetric and needs no query prefix, so the raw
question is embedded as-is.

**Grounding & citations.** The [system prompt](apps/api/src/prompts.ts) instructs
the model to answer **only** from the numbered context passages, cite with the
given `[n]` markers, and reply *"I could not find an answer to this in the
provided documents."* when the context doesn't cover the question — so an
unanswerable query returns an explicit non-answer, not a fabrication. After
generation, every emitted `[n]` marker is validated against the real retrieved
chunks; markers with no matching chunk are dropped and reported in
`usage.invalidMarkers` (the UI flags them). Returned `sources` carry
`documentId`, `filename`, `page`, `chunkIndex`, `snippet`, `score` and whether
the answer actually `cited` them.

**Lost-in-the-middle.** LLMs attend most reliably to the **start and end** of a
long context, so `orderForContextWindow()` in
[`context.ts`](apps/api/src/services/context.ts) places the highest-scoring
chunks at both ends and buries the weakest in the middle. Citation markers are
assigned by relevance rank *before* reordering, so marker numbers stay
meaningful regardless of prompt position.

**Tenant isolation.** Retrieval runs inside the per-tenant+collection namespace
built by `vectorNamespace()` (the only namespace constructor in the codebase)
**and** applies a `tenantId` metadata filter as defense-in-depth — a
namespace-construction bug still can't surface another tenant's vectors. The
collection itself is loaded tenant-scoped, so a second user querying the first
user's collection id gets a **404**.

**Hybrid search: not enabled — dense-only.** The Workers AI bge-m3 binding
returns dense embeddings only (`{ data: number[][] }`); it does not expose the
model's sparse/lexical weights, so no sparse vectors were stored at ingestion
and there is nothing to fuse. The dense path lives behind the same
`VectorStore` seam with a clearly-marked `// TODO: hybrid search` in
[`retrieval.ts`](apps/api/src/services/retrieval.ts) for when sparse vectors
become available (Pinecone native sparse-dense, or manual RRF).

**Tuning retrieval.** Every knob lives in
[`apps/api/src/config.ts`](apps/api/src/config.ts) and takes effect immediately
(no re-ingestion needed):

| Constant | Default | Effect |
| --- | --- | --- |
| `TOP_K` | `8` | Chunks fetched from the vector store per query |
| `MAX_TOP_K` | `20` | Hard cap on a client-supplied `topK` |
| `SIMILARITY_THRESHOLD` | `0.35` | Min cosine score to enter the context (raise = stricter grounding / more "not found") |
| `NEAR_DUPLICATE_JACCARD` | `0.85` | Word-trigram similarity above which chunks are deduplicated |
| `CONTEXT_TOKEN_BUDGET` | `4000` | Max context tokens (BPE-counted); lowest-scoring chunks dropped first |
| `MAX_QUERY_LENGTH` | `2000` | Reject longer questions with 400 |
| `GENERATION_MODEL` / `GENERATION_MAX_TOKENS` / `GENERATION_TEMPERATURE` | Llama 3.3 / `1024` / `0.1` | Generation model + decoding |

**Edge cases.** Empty query → **400**; collection with no `ready` documents →
**409** (friendly "ingest a document first" — never a hallucinated answer);
nothing clears `SIMILARITY_THRESHOLD` → **422** ("no relevant content found").

**Re-ranking** (out of scope) has a marked insertion point between retrieval and
context assembly (`// TODO (next): re-ranking` in both `query.ts` and
`context.ts`).

## Authentication (session or API key)

Every protected endpoint runs through one unified middleware
([`apps/api/src/lib/auth.ts`](apps/api/src/lib/auth.ts)) that accepts **two**
credential types, both resolving to the same context
(`{ tenantId, authType, userId?, keyId? }`) so all downstream tenant-scoping is
identical:

- **Clerk session JWT** — `Authorization: Bearer <clerk-jwt>`, used by the
  dashboard. Verified against Clerk's JWKS, with the issuer pinned to
  `CLERK_ISSUER` **and** the `azp` claim required to match
  `CLERK_AUTHORIZED_PARTY` (a token missing `azp` is rejected, not waved
  through).
- **API key** — `Authorization: Bearer rag_live_…` (or `X-API-Key: rag_live_…`),
  used by programmatic callers. Verified by SHA-256 **hash lookup** (constant
  work — one indexed read; never a scan/compare over stored keys).

The credential is classified by the `rag_live_` prefix; a session JWT falls
through to Clerk verification.

**Which auth each endpoint accepts:**

| Endpoint | Session | API key |
| --- | :---: | :---: |
| `POST /v1/collections/:id/query` | ✓ | ✓ |
| `GET /v1/collections`, `GET /v1/collections/:id` | ✓ | ✓ |
| `POST /v1/collections/:id/documents` (upload) | ✓ | ✓ |
| `GET /v1/collections/:id/documents` | ✓ | ✓ |
| `GET /v1/documents/:id`, `.../status`, `.../raw` | ✓ | ✓ |
| `POST /v1/documents/:id/reingest`, `DELETE …` | ✓ | ✓ |
| `POST/GET/DELETE /v1/collections`, `DELETE /v1/collections/:id` | ✓ | ✓ |
| **`POST/GET/DELETE /v1/api-keys`** (key management) | ✓ | ✗ **401** |

API keys are **full-access for their tenant** (no scopes yet — see
`// TODO: scopes` in [`apikeys.ts`](apps/api/src/services/apikeys.ts)) with one
deliberate exception: **API keys can never manage API keys.** Key management is
session-only (`requireSession` rejects any `rag_live_` credential with 401), so
a leaked key cannot mint or revoke keys. Tenant isolation is unchanged under
key auth: a key from tenant A querying tenant B's collection id gets a **404**.

### API key management (`/v1/api-keys`, session-only)

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/v1/api-keys` | Body `{ name, rateLimitPerMinute? }` → **201** with the **plaintext key** (only time it is ever returned) + metadata |
| `GET` | `/v1/api-keys` | List the tenant's keys — prefix + last-4 only, never key material |
| `DELETE` | `/v1/api-keys/:id` | Revoke (soft delete): set `revoked_at`, purge the KV cache; the key fails auth immediately (see revocation note below) |

**Key security.** Keys are `rag_live_` + 32 bytes of `crypto.getRandomValues`
(base64url). The **plaintext is never stored** — only its SHA-256 hash (unique,
indexed). D1 keeps a display `key_prefix` + `last4` for the UI. A KV entry keyed
by the hash (`{ keyId, tenantId, revoked, rateLimitPerMinute }`) serves the
read-optimized auth fast path; on a KV miss (cold cache / eventual consistency)
auth falls back to D1, the source of truth, and repopulates KV.

**Revocation.** Revoking writes `revoked_at` in D1 *and* purges the KV entry, so
the key stops authenticating right away. Because the fast path short-circuits on
a KV hit and never reads D1, that purge is the only thing standing between a
revoked key and continued access — and it is best-effort (the revoke still
returns 204 if KV errors). Every cache entry therefore carries an
`expirationTtl` (`API_KEY_CACHE_TTL_SECONDS`, default 300s) as a backstop: in
the worst case a failed purge delays revocation by that TTL, after which the
entry expires, auth falls back to D1, and the key is rejected. It can never
outlive the TTL. `last_used_at`
is refreshed fire-and-forget via `ctx.waitUntil`, throttled to at most once per
key per minute so it never adds latency or hammers D1.

```bash
# Create a key (from the dashboard, or with a Clerk session JWT):
curl -X POST "$API/v1/api-keys" \
  -H "Authorization: Bearer $CLERK_JWT" -H "Content-Type: application/json" \
  -d '{"name":"prod-backend","rateLimitPerMinute":120}'
# → { "apiKey": {...}, "key": "rag_live_XXXX…" }   ← copy `key` now; shown once

# Call the product API with the key (no browser/session needed):
curl -X POST "$API/v1/collections/$COLLECTION_ID/query" \
  -H "Authorization: Bearer rag_live_XXXX…" -H "Content-Type: application/json" \
  -d '{"query":"What is the refund policy?","stream":false}'
```

An invalid, malformed, or revoked key returns **401**.

## Rate limiting (Feature 4)

**Mechanism: a Durable Object** ([`ratelimiter.ts`](apps/api/src/durable/ratelimiter.ts)),
one instance per API key (`getByName("key:{keyId}")`). Chosen deliberately:

- **Not KV** — KV is eventually consistent with per-key write limits, so a
  counter there would be inaccurate and bypassable across concurrent requests
  and colos (the spec's explicit non-goal).
- **Not the native rate-limiting binding** — its `limit`/`period` are fixed in
  `wrangler.jsonc` and it returns only `{ success }`, so it can't honor a
  **per-key** `rate_limit_per_minute` override or expose the exact
  remaining/reset needed for `RateLimit-*` headers.

A DO is single-threaded per instance, giving **true atomic** increments, plus
per-key limits and precise header math.

**Algorithm: sliding-window log.** We keep the timestamps of allowed hits in the
trailing 60s window. A naive *fixed* window lets a caller fire a full quota at
the end of one window and again at the start of the next (~2× burst at the
boundary); the sliding window moves continuously with `now`, so the limit holds
across every 60s span. State is in-memory (a rate counter needs no durability —
eviction just resets the window, at worst momentarily lenient), keeping the hot
path free of storage writes.

**Behavior:**

- Limit is **per key, per minute** — `DEFAULT_RATE_LIMIT_PER_MINUTE` (60),
  overridable per key via `rate_limit_per_minute`.
- Runs in the auth middleware **before** any expensive work, so a throttled
  request never reaches embedding/retrieval/generation.
- Every API-key response carries `RateLimit-Limit`, `RateLimit-Remaining`,
  `RateLimit-Reset` (seconds). A rejection returns **429** with `Retry-After`
  and a JSON body `{ error, retryAfter, limit }`.
- **Session (dashboard) traffic is not rate-limited** — it is Clerk-gated,
  interactive and low-volume; the surface being protected is programmatic
  API-key traffic. (Flip this by adding a session branch to the limiter.)

Tunables in [`config.ts`](apps/api/src/config.ts): `DEFAULT_RATE_LIMIT_PER_MINUTE`,
`MAX_RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_WINDOW_MS`, `LAST_USED_THROTTLE_MS`,
`API_KEY_PREFIX`, `API_KEY_RANDOM_BYTES`.

## Usage analytics (Feature 5)

Every query and ingestion is recorded as a row in the D1 `usage_events` table
and surfaced on a dashboard at **`/dashboard/analytics`** (KPI cards with
period-over-period deltas + sparklines, a stacked queries-over-time chart with a
p95 latency line, latency-by-stage and by-collection breakdowns, an outcome
donut, token/cost over time, ingestion stats, and a paginated drill-down table
with a per-event detail sheet).

**What's tracked.** For **queries**: per-stage latency (embedding / retrieval /
generation) and total, chunks retrieved, top similarity score, prompt/completion
tokens, estimated cost, auth type, collection, and outcome — including the
`no_results` (nothing relevant retrieved), `error` (pipeline failure), and
`rate_limited` (429) cases, not just successes. For **ingestion**: duration,
chunk count, bytes processed, and success/failure. See the
[`usage_events` schema](apps/api/src/db/schema.ts) and the
[`UsageEvent` type](packages/shared/src/index.ts).

**Writes are off the critical path.** A user request must never be slowed or
failed by analytics, so every write goes through `ctx.waitUntil(...)` (never
awaited before responding) and the recorder swallows its own errors (logs
only). Token counting and cost estimation also run *inside* the deferred
closure, so instrumentation adds no latency. Deliberately breaking the analytics
write has zero effect on the query response. The instrumentation lives in the
[query route](apps/api/src/routes/query.ts), the
[auth middleware](apps/api/src/lib/auth.ts) (429s), and the
[ingest workflow](apps/api/src/workflows/ingest.ts).

**Why D1 now, Analytics Engine at scale.** At portfolio scale, D1 is the
pragmatic primary store: SQL aggregation (`GROUP BY`, window-function
percentiles) keeps the dashboard queries simple and, crucially, **readable back
from the Worker**. At high write volume D1's single-writer model becomes a
bottleneck — that's where **Workers Analytics Engine** is the right answer:
`writeDataPoint` is unbounded, fire-and-forget, and effectively free. Events are
therefore **dual-written** to Analytics Engine (binding `USAGE_ANALYTICS`)
behind the swappable [`AnalyticsRecorder`](apps/api/src/services/analytics.ts)
interface. The catch (verified against the current docs): Analytics Engine is
**write-only from a Worker** — reading it back needs the account-level SQL API
and a token — so the dashboard still reads D1, and the dual-write is *additive*,
not a replacement, at this scale.

**Privacy — raw query text is not stored by default.** We keep a SHA-256 hash of
the query plus its length (enough to spot duplicate/abusive queries) but **not
the text**. Plaintext storage is gated behind the `STORE_RAW_QUERY_TEXT` flag in
[`config.ts`](apps/api/src/config.ts), which defaults to **`false`**; the
event-detail sheet says so explicitly when text is absent. No chunk contents are
ever stored.

**Retention.** A daily **cron trigger** (`triggers.crons` in
[`wrangler.jsonc`](apps/api/wrangler.jsonc), handled by `scheduled` in
[`index.ts`](apps/api/src/index.ts)) prunes `usage_events` older than
`ANALYTICS_RETENTION_DAYS` (default **90**). Test the prune locally with
`wrangler dev --test-scheduled` then
`curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"`.

**API** (session-only — analytics is a dashboard feature, not part of the public
API; an API key gets a 401): `GET /v1/analytics/{summary,timeseries,breakdown,recent,ingestion}`,
all tenant-scoped and accepting `from`/`to` (epoch ms or ISO) + optional
`collectionId`. Aggregation happens entirely in SQL
([`analytics-queries.ts`](apps/api/src/services/analytics-queries.ts)); no
endpoint pulls raw rows to reduce in JS. Percentiles use a single tested helper
([`percentile.ts`](apps/api/src/lib/percentile.ts) +
[`percentile.test.ts`](apps/api/src/lib/percentile.test.ts)) whose nearest-rank
formula is mirrored into the SQL `ROW_NUMBER()` filter.

Config knobs in [`config.ts`](apps/api/src/config.ts): `ANALYTICS_RETENTION_DAYS`,
`STORE_RAW_QUERY_TEXT`, `ANALYTICS_DEFAULT_RANGE_DAYS`, `MODEL_COSTS` /
`DEFAULT_MODEL_COST` (per-model per-token rates for cost estimation — a rough
*relative* signal, not a billing figure).

## API documentation (Feature 6)

The API is self-documenting. Zod schemas in [`packages/shared`](packages/shared/src/schemas)
are the single source of truth: the TypeScript types both apps use are inferred
from them, and the **OpenAPI 3.1** spec is generated from the same schemas — so
the docs, the types, and the validated contract cannot drift.

- **Machine-readable spec**: `GET /v1/openapi.json` (and `/v1/openapi.yaml`) —
  public, cached, valid OpenAPI 3.1. Import it into Postman/Insomnia/Swagger
  Editor, or regenerate/validate locally with `pnpm --filter api gen:openapi`
  (writes [`apps/web/src/generated/openapi.json`](apps/web/src/generated/openapi.json)
  and fails on an invalid spec). Every operation is tagged, marks which auth
  scheme(s) it accepts (`ApiKeyAuth` / `SessionAuth`), and documents all its
  responses — including `429` with the `RateLimit-*` and `Retry-After` headers.
- **Hosted docs**: the web app serves a public docs section at
  [`/docs`](apps/web/src/app/docs) — overview + quickstart, authentication, rate
  limits, errors, an ingestion guide, and a full **`/docs/reference`** rendered
  from the spec (per-endpoint schemas, curl/TypeScript/Python samples, and an
  authenticated "Try it" console). It builds to static HTML with the rest of the
  site and is readable signed out.

The spec is documented via a dedicated registration layer
([`apps/api/src/openapi`](apps/api/src/openapi)) rather than by swapping the
runtime routers to `@hono/zod-openapi`'s validating router — that keeps every
endpoint's request handling (and error bodies) byte-for-byte unchanged while
still generating the spec from the shared schemas.

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
curl http://localhost:8787/me              # -> 401 {"error":"Missing credentials"}
```

The rate-limiter Durable Object is emulated by `wrangler dev` locally (no remote
resource needed); its migration (`tag: v1`) is applied automatically on deploy.

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
# Apply D1 schema migrations to the remote database (includes the api_keys table)
cd apps/api && pnpm db:migrate:remote            # = wrangler d1 migrations apply rag-db --remote
# The RATE_LIMITER Durable Object needs no provisioning — its migration
# (tag: v1, new_sqlite_classes) is applied automatically by `wrangler deploy`.
# Secrets
pnpm dlx wrangler secret put CLERK_ISSUER
pnpm dlx wrangler secret put CLERK_AUTHORIZED_PARTY   # deployed web origin(s)
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

Billing/plans/quotas (beyond the per-minute rate limit) and **API-key
scopes/permissions** — all keys are currently full-access for their tenant
(`// TODO: scopes` in [`apikeys.ts`](apps/api/src/services/apikeys.ts)). Out of
scope for the [analytics feature](#usage-analytics-feature-5) specifically:
billing/invoicing, per-user (sub-tenant) attribution, alerting, report export,
and real-time streaming updates (the dashboard refetches on filter change).
Within the query pipeline (Feature 3), also out of scope: **re-ranking** with a
cross-encoder (clean insertion point marked between retrieval and context
assembly), query rewriting / HyDE / multi-query, semantic caching, an evaluation
harness, and conversation history (single-turn Q&A only). **Hybrid (sparse+dense)
search** is not enabled: the Workers AI bge-m3 binding exposes dense vectors
only, so retrieval is dense-only behind the `VectorStore` seam (see the
`// TODO: hybrid search` marker in
[`retrieval.ts`](apps/api/src/services/retrieval.ts)).
