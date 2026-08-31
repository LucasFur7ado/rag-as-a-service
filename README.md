# RAG as a Service

A multi-tenant **Retrieval-Augmented Generation** platform, built as a Next.js
app deployed to Vercel. Implemented so far:

- **Feature 1 — collections & documents**: tenant-scoped CRUD backed by Neon
  Postgres (metadata, via Drizzle ORM) and Vercel Blob (raw files), with a
  dashboard UI.
- **Feature 2 — async ingestion pipeline**: uploads are parsed, chunked,
  embedded (Workers AI) and upserted to Pinecone in the background, with live status
  in the dashboard. See [Ingestion pipeline](#ingestion-pipeline-feature-2).
- **Feature 3 — query pipeline**: a natural-language question is embedded,
  retrieved against the tenant+collection namespace, assembled into a bounded
  context and answered — grounded strictly in the retrieved chunks, streamed
  token-by-token with validated citations. See
  [Query pipeline](#query-pipeline-feature-3).
- **Feature 4 — API keys & rate limiting**: tenants mint API keys to call the
  product API programmatically; the public endpoints accept a Clerk session
  **or** an API key, and API-key traffic is rate-limited per key by an atomic
  Postgres sliding window. See
  [Authentication](#authentication-session-or-api-key) and
  [Rate limiting](#rate-limiting-feature-4).
- **Feature 5 — usage analytics**: every query and ingestion is recorded and
  surfaced on a dashboard. See [Usage analytics](#usage-analytics-feature-5).
- **Feature 6 — API documentation**: an OpenAPI 3.1 spec generated from the same
  Zod schemas the app's types come from, plus hosted docs. See
  [API documentation](#api-documentation-feature-6).
- **Feature 8 — retrieval evaluation harness**: a standalone benchmark that
  scores chunking + embedding + vector search against a committed golden
  dataset *and* against public BEIR benchmarks, comparing configurations with
  reproducible metrics and per-query failure analysis. See
  [Retrieval evaluation](#retrieval-evaluation-feature-8).

## Architecture

**One deployable.** The Next.js app *is* the backend: every endpoint is a Route
Handler under `apps/web/src/app/api`, and all backend logic lives in
`apps/web/src/server`.

```
.
├── apps/
│   └── web/        # Next.js 16 (App Router) — frontend AND API. Deployed to Vercel.
│       ├── src/app/api/   # Route Handlers (the API surface)
│       ├── src/server/    # backend logic: db, auth, services, openapi
│       └── drizzle/       # generated SQL migrations
├── packages/
│   └── shared/     # Zod schemas + inferred domain types, shared by both halves
├── pnpm-workspace.yaml
└── tsconfig.base.json   # strict TS config extended by every package
```

Because frontend and API share an origin, the browser client
([`api-client.ts`](apps/web/src/lib/api-client.ts)) calls a relative `/api` —
no CORS, no preflight, and no build-time API host to configure. It attaches the
Clerk session token as a `Bearer` header; the route handlers verify that token
against Clerk's JWKS and derive `{ userId, tenantId }` for every protected
request.

| Piece | Location |
| --- | --- |
| Postgres schema (Drizzle) + serializers | [`apps/web/src/server/db/`](apps/web/src/server/db/) |
| SQL migrations (drizzle-kit output) | [`apps/web/drizzle/`](apps/web/drizzle/) |
| Unified auth middleware (session **or** API key) | [`server/lib/auth.ts`](apps/web/src/server/lib/auth.ts) |
| Route-handler plumbing (errors, CORS, JSON) | [`server/lib/http.ts`](apps/web/src/server/lib/http.ts) |
| Collections / documents endpoints | [`app/api/v1/collections/`](apps/web/src/app/api/v1/collections/), [`app/api/v1/documents/`](apps/web/src/app/api/v1/documents/) |
| Query endpoint (SSE + JSON) | [`app/api/v1/collections/[id]/query/`](apps/web/src/app/api/v1/collections/%5Bid%5D/query/route.ts) |
| Ingestion pipeline | [`server/services/ingest.ts`](apps/web/src/server/services/ingest.ts) |
| Text extraction (PDF via `unpdf`, txt/markdown) | [`server/lib/extract.ts`](apps/web/src/server/lib/extract.ts) |
| Recursive chunker with overlap | [`server/lib/chunking.ts`](apps/web/src/server/lib/chunking.ts) |
| Embeddings + generation (Workers AI) | [`server/services/embeddings.ts`](apps/web/src/server/services/embeddings.ts), [`llm.ts`](apps/web/src/server/services/llm.ts) |
| Vector store (Pinecone over REST) | [`server/services/vectorstore.ts`](apps/web/src/server/services/vectorstore.ts) |
| Per-key rate limiter | [`server/services/ratelimit.ts`](apps/web/src/server/services/ratelimit.ts) |
| Tuning constants (chunk sizes, batch limits, models) | [`server/config.ts`](apps/web/src/server/config.ts) |
| Dashboard UI | [`app/dashboard/`](apps/web/src/app/dashboard/) |

All endpoints are tenant-scoped: every query filters by the `tenantId` derived
from the credential, and resources owned by another tenant return **404** (never
a 403 that would leak existence). Uploads accept PDF / plain text / Markdown up
to 25 MB; raw files land in Vercel Blob under
`tenants/{tenantId}/collections/{collectionId}/documents/{documentId}/{filename}`.

Shared domain types for every feature live in
[`packages/shared/src/index.ts`](packages/shared/src/index.ts).

### Migrated off Cloudflare

This project previously ran as a Cloudflare Worker. Every Cloudflare primitive
had to be replaced, and the replacements are not all like-for-like — the
trade-offs are documented where they bite:

| Was | Now | Note |
| --- | --- | --- |
| D1 (SQLite) | **Neon Postgres** + Drizzle | Real window functions and `FILTER` clauses for the analytics SQL |
| R2 | **Vercel Blob** (private store) | Files are readable only through an authenticated route |
| Workers AI (bge-m3, Llama 3.3) | **Workers AI**, unchanged — `@cf/baai/bge-m3` for embeddings, `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for generation | Reached over the REST API now, not an `AI` binding — no Worker is deployed. See [Embeddings](#embeddings-and-re-ingestion) |
| Queues + Workflows | **`after()`** background execution | No durable resume — see [Ingestion](#ingestion-pipeline-feature-2) |
| Durable Object rate limiter | **Postgres advisory-lock window** | Still atomic per key — see [Rate limiting](#rate-limiting-feature-4) |
| KV (API-key cache) | *removed* | Revocation is now immediate — see [Authentication](#authentication-session-or-api-key) |
| Analytics Engine dual-write | *removed* | It was write-only from a Worker; Postgres is both writable and readable |
| Cron triggers | **Vercel Cron** | [`vercel.json`](apps/web/vercel.json) |
| Static export → static host | **SSR on Vercel** | One deployable instead of two |

Pinecone is the only external dependency that carried over unchanged.

## Prerequisites

- **Node.js ≥ 20** (developed on Node 24)
- **pnpm 9** (`corepack enable` then `corepack prepare pnpm@9.15.4 --activate`)
- A **Clerk** application (for auth) — free tier is fine
- A **Vercel** account (Hobby is enough; see the note on `maxDuration` below)
- A **Neon** Postgres database — free tier is fine
- A **Google AI Studio** API key — free, no billing required
- A **Pinecone** account (serverless index; free tier is fine)

## Install

```bash
pnpm install
```

## Environment setup

All configuration lives in one place — copy the example and fill it in:

```bash
cp apps/web/.env.example apps/web/.env.local
```

`NEXT_PUBLIC_*` variables are baked into the browser bundle and are public by
design. Everything else is server-only, read at request time inside route
handlers. On Vercel, set them all under *Project → Settings → Environment
Variables*.

Required:

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string |
| `CLERK_ISSUER` | Your Clerk Frontend API URL |
| `CLERK_AUTHORIZED_PARTY` | Your app's origin(s), comma-separated |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | Workers AI, for embeddings **and** answer generation — see [Embeddings](#embeddings-and-re-ingestion). REST API only; no Worker is deployed |
| `PINECONE_API_KEY` / `PINECONE_INDEX` / `PINECONE_INDEX_HOST` | See [Pinecone setup](#pinecone-setup) |
| `BLOB_READ_WRITE_TOKEN` | Set automatically when you add a Blob store |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CRON_SECRET` | Shared secret for the retention cron |

**`CLERK_AUTHORIZED_PARTY` is not optional.** `iss` only proves a token came
from your Clerk instance — every origin that instance authorizes shares it — so
the `azp` claim is what pins the token to *your* frontend. Session auth fails
closed when it is unset.

> Without a real `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` the app still **builds** (a
> format-valid placeholder is used so prerender succeeds), but the sign-in flow
> and `/dashboard` gating only work once real Clerk keys are set.

### Database setup

Create a Neon project, copy the **pooled** connection string into
`DATABASE_URL`, then apply the schema:

```bash
pnpm db:migrate
```

Schema changes are made in
[`apps/web/src/server/db/schema.ts`](apps/web/src/server/db/schema.ts);
regenerate SQL with `pnpm db:generate` (drizzle-kit) and re-apply with
`pnpm db:migrate`.

The app talks to Neon over its **serverless HTTP driver**: each query is a
stateless fetch, so there is no connection to keep alive between invocations and
no pool to exhaust when Vercel scales out. The trade-off is no interactive
transactions — nothing here needs one, and the single place that wants atomicity
(the rate limiter) gets it from a per-key advisory lock inside one statement.

### Blob storage setup

In the Vercel dashboard: *Storage → Create → Blob*, and set access to
**Private**. This matters: these are tenants' uploaded documents, and a public
store would make every one of them readable by anyone holding the URL. With a
private store, files are reachable only through
`GET /api/v1/documents/:id/raw`, which authenticates and tenant-scopes first.

### Pinecone setup

Ingestion embeds with **`@cf/baai/bge-m3`** at **1024 dimensions**, so the
Pinecone index must be created with that dimension and the **cosine** metric
(the pipeline verifies this at run time and fails with a clear error on
mismatch):

1. In the [Pinecone console](https://app.pinecone.io/) create a **serverless**
   index, e.g. `rag-index`, with **dimension `1024`** and **metric `cosine`**.
2. Copy the index **host** from the index page into `PINECONE_INDEX_HOST` and
   the index name into `PINECONE_INDEX`.
3. Create an API key and set it as `PINECONE_API_KEY`.

The app talks to Pinecone's data-plane REST API directly (no SDK), so nothing
else needs installing.

### Embeddings and re-ingestion

Embeddings briefly moved to `gemini-embedding-001` during the Vercel migration
and have moved **back to `@cf/baai/bge-m3`**. Google's free embedding tier
counts each *input* of a batch against a 100-request quota, so a single full
batch exhausts it and ingestion 429s mid-document. Workers AI grants 10,000
Neurons/day and bge-m3 costs 1,075 neurons per million input tokens — roughly
**9.3M input tokens/day free**, about 40k chunks at `CHUNK_SIZE_CHARS`.

This uses the **model only**, over the Workers AI REST API
(`POST /accounts/:id/ai/run/@cf/baai/bge-m3`, `services/workersai.ts`). No
Worker is deployed, there is no `wrangler` in the toolchain and no `AI`
binding — it needs nothing but `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`. Generation moved back to Workers AI too (see
[Generation](#generation)), so those two variables now cover the entire AI
pipeline and share one 10,000 Neurons/day allowance.

**Vectors from different models are not comparable** — different models produce
different vector spaces even at the same dimension — so every document must be
re-ingested after a provider change (dashboard → **Reprocess**, or
`POST /api/v1/documents/:id/reingest`). Vector ids are deterministic, so a
re-run overwrites in place rather than duplicating. Only one provider is wired
up at a time, deliberately: a runtime switch would silently mix vector spaces
inside a single index.

The index dimension never had to change. 1024 is bge-m3's **native** output —
nothing is truncated or projected — and it is why the index was created with
that dimension in the first place. Vectors are normalized defensively before
storage (a no-op for bge-m3, which already returns unit-length vectors).

bge-m3 is **symmetric**: it takes no prefix and encodes passages and questions
identically. The `EmbeddingProvider` seam still carries a task argument, since
a provider that *does* distinguish the two (Gemini's `RETRIEVAL_DOCUMENT` /
`RETRIEVAL_QUERY`) needs the caller to have said which it wanted, and that is
not recoverable after the fact.

## Ingestion pipeline (Feature 2)

Uploading a document returns immediately with `status: "uploaded"` and kicks off
ingestion in the background:

```
POST /api/v1/collections/:id/documents
   └─ after() → runIngestion()
        1. mark processing         (status = processing, record run id)
        2. extract text            (Blob → unpdf for PDF, decode for txt/md;
                                    keeps page numbers for later citations)
        3. chunk text              (recursive character splitting w/ overlap)
        4. verify index dimension  (embedding dim must match Pinecone index)
        5. embed + upsert batches  (Workers AI ≤100 inputs/request →
                                    Pinecone upserts ≤150 vectors & <2 MB/request)
        6. finalize                (status = ready + chunk count)
      on any failure → status = error + readable message
```

Design notes:

- **What replaced the Workflow.** On Cloudflare this ran as a durable Workflow:
  each phase was a checkpointed `step.do(...)`, so an evicted instance resumed
  from the last completed step. Vercel has no durable-execution primitive, so
  the pipeline is a sequential function invoked through
  [`after()`](https://nextjs.org/docs/app/api-reference/functions/after) — it
  starts once the upload response is sent and runs inside that same invocation.
- **Retries are preserved.** Every phase is wrapped in `withRetries` with
  exponential backoff, so a transient failure (network, 429, 5xx) does not fail
  the document. Deterministic failures (unparseable/empty file, provider 4xx,
  config mismatch) throw `PermanentError`, skip retries entirely, and mark the
  document `error` immediately — nothing hangs in `processing`.
- **Resumption is not preserved.** A run killed by the function timeout leaves
  the document in `processing`. `reingest` is the recovery path, and it accepts
  a document that has been `processing` for more than 15 minutes rather than
  refusing with a 409 forever.
- **`maxDuration`.** The upload route budgets 300s (the Vercel Pro/Fluid
  ceiling). On Hobby the platform caps it lower (60s), which is enough for
  typical documents but can time out on a very large PDF.
- **Free-tier pacing.** `EMBED_BATCH_DELAY_MS` spaces embedding batches, and is
  0 by default: Workers AI allows 3,000 embedding requests/minute, which batches
  of `MAX_EMBED_BATCH_SIZE` cannot approach. The binding constraint is the daily
  neuron allowance, which spacing does not help with. Raise it only if a
  provider with a per-minute cap is wired in.
- **Idempotent** — vector ids are deterministic (`{documentId}#{chunkIndex}`),
  so re-running ingestion overwrites vectors instead of duplicating them.
- **Tenant isolation** — vectors live in a per-tenant+collection namespace
  (`t_{tenantId}__c_{collectionId}`, built by `vectorNamespace()`). Each vector
  carries `tenantId`, `collectionId`, `documentId`, `chunkIndex`, `page`,
  `filename` and the chunk text as metadata.
- **Deletes are made safe without termination.** There is no instance handle to
  terminate a running ingestion, so instead its final writes are scoped to the
  run's own `ingestion_run_id` *and* the document row. If the document is
  deleted (or a newer run claims it) mid-flight, those updates match nothing and
  the run ends as a silent no-op rather than resurrecting a deleted row.
- **Status** — `GET /api/v1/documents/:id/status` returns
  `{ status, chunkCount?, error?, updatedAt }`; the dashboard polls it while any
  document is processing.
- **Deletes clean up vectors** — deleting a document removes its vectors (by id
  prefix) and its blob folder; deleting a collection removes the whole Pinecone
  namespace and blob prefix.

## Query pipeline (Feature 3)

```
POST /api/v1/collections/:id/query    body: { query, topK?, stream? }
   1. embed query        (Workers AI bge-m3, `task: "query"`)
   2. retrieve top-k     (Pinecone: tenant+collection namespace + tenantId filter)
   3. assemble context   (threshold → dedupe → token budget → reorder → label [n])
   4. generate           (Workers AI Llama 3.3 70B, streamed, grounded prompt)
   5. resolve citations  (map emitted [n] markers → real chunks; drop hallucinated)
```

Each stage is a separate, individually-testable function behind a service seam
(`retrieval` → `context` → `llm` → `citations`); the route only validates,
orchestrates and shapes the response — no SDK calls in the handler.

**Response modes**

- **Streaming (default)** — Server-Sent Events; each `data:` line is one JSON
  `QueryStreamEvent`: zero+ `delta` (answer text) → one `sources` (citations +
  usage) → one `done` (or an in-band `error`). The route sets
  `X-Accel-Buffering: no` so Vercel's proxy does not buffer the stream and
  deliver every token at once when generation finishes.
- **`stream: false`** — a single JSON `{ answer, sources, usage }`:

  ```bash
  curl -X POST "$API/v1/collections/$ID/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"query":"What is the refund policy?","stream":false}'
  ```

<a id="generation"></a>
**Model.** Generation uses **`@cf/meta/llama-3.3-70b-instruct-fp8-fast`** on
Workers AI, behind the `LlmProvider` seam in
[`llm.ts`](apps/web/src/server/services/llm.ts) — swap the class (or just
`GENERATION_MODEL`) to move generation elsewhere without touching the pipeline.
It rides the same REST transport, account and token as embeddings
([`workersai.ts`](apps/web/src/server/services/workersai.ts)), so the AI half of
the stack is one vendor and one quota. Streaming comes back as SSE that is *not*
wrapped in Cloudflare's `result` envelope, which is why `workersAiStream()`
returns the raw body for the provider to decode.

Generation, not embeddings, is what spends the free 10,000 Neurons/day: this
model bills 26,668 neurons/1M input tokens and 204,805/1M output, so a typical
query (~4k context, ~300 output tokens) costs ~170 neurons — roughly **55 free
queries/day**. `@cf/meta/llama-3.1-8b-instruct-fp8-fast` is ~6x cheaper if that
bites. Unlike the embedding model, changing this needs **no** re-ingestion.

**Grounding & citations.** The [system prompt](apps/web/src/server/prompts.ts)
instructs the model to answer **only** from the numbered context passages, cite
with the given `[n]` markers, and reply *"I could not find an answer to this in
the provided documents."* when the context doesn't cover the question. After
generation, every emitted `[n]` marker is validated against the real retrieved
chunks; markers with no matching chunk are dropped and reported in
`usage.invalidMarkers` (the UI flags them).

**Lost-in-the-middle.** LLMs attend most reliably to the **start and end** of a
long context, so `orderForContextWindow()` in
[`context.ts`](apps/web/src/server/services/context.ts) places the
highest-scoring chunks at both ends and buries the weakest in the middle.
Citation markers are assigned by relevance rank *before* reordering, so marker
numbers stay meaningful regardless of prompt position.

**Tenant isolation.** Retrieval runs inside the per-tenant+collection namespace
built by `vectorNamespace()` **and** applies a `tenantId` metadata filter as
defense-in-depth — a namespace-construction bug still can't surface another
tenant's vectors. The collection itself is loaded tenant-scoped, so a second
user querying the first user's collection id gets a **404**.

**Hybrid search: not enabled — dense-only.** The Workers AI endpoint for
bge-m3 returns dense vectors only — the model produces sparse/lexical weights
but they are not exposed — so nothing was stored at ingestion to fuse. The dense path lives behind the `VectorStore` seam
with a marked `// TODO: hybrid search` in
[`retrieval.ts`](apps/web/src/server/services/retrieval.ts).

**Tuning retrieval.** Every knob lives in
[`apps/web/src/server/config.ts`](apps/web/src/server/config.ts) and takes
effect immediately (no re-ingestion needed):

| Constant | Default | Effect |
| --- | --- | --- |
| `TOP_K` | `8` | Chunks fetched from the vector store per query |
| `MAX_TOP_K` | `20` | Hard cap on a client-supplied `topK` |
| `SIMILARITY_THRESHOLD` | `0.35` | Min cosine score to enter the context (raise = stricter grounding / more "not found") |
| `NEAR_DUPLICATE_JACCARD` | `0.85` | Word-trigram similarity above which chunks are deduplicated |
| `CONTEXT_TOKEN_BUDGET` | `4000` | Max context tokens (BPE-counted); lowest-scoring chunks dropped first |
| `MAX_QUERY_LENGTH` | `2000` | Reject longer questions with 400 |
| `GENERATION_MODEL` / `GENERATION_MAX_TOKENS` / `GENERATION_TEMPERATURE` | Llama 3.3 70B (fp8-fast) / `1024` / `0.1` | Generation model + decoding |

`SIMILARITY_THRESHOLD` tracks the embedding model. It was raised to 0.45 while
Gemini was in place — Gemini's cosine scores sit higher than BGE-M3's for both
relevant and irrelevant text — and is back to **0.35** now that bge-m3 is; left
at 0.45 it would silently drop on-topic chunks.

**Edge cases.** Empty query → **400**; collection with no `ready` documents →
**409** (friendly "ingest a document first" — never a hallucinated answer);
nothing clears `SIMILARITY_THRESHOLD` → **422** ("no relevant content found").

**Re-ranking** (out of scope) has a marked insertion point between retrieval and
context assembly (`// TODO (next): re-ranking`).

## Authentication (session or API key)

Every protected endpoint runs through one unified module
([`server/lib/auth.ts`](apps/web/src/server/lib/auth.ts)) that accepts **two**
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
| `POST/DELETE /v1/collections`, `DELETE /v1/collections/:id` | ✓ | ✓ |
| **`POST/GET/DELETE /v1/api-keys`** (key management) | ✓ | ✗ **401** |
| **`GET /v1/analytics/*`** | ✓ | ✗ **401** |

API keys are **full-access for their tenant** (no scopes yet — see
`// TODO: scopes` in
[`apikeys.ts`](apps/web/src/server/services/apikeys.ts)) with one deliberate
exception: **API keys can never manage API keys.** Key management is
session-only (`requireSession` rejects any `rag_live_` credential with 401), so
a leaked key cannot mint or revoke keys. Tenant isolation is unchanged under key
auth: a key from tenant A querying tenant B's collection id gets a **404**.

### API key management (`/v1/api-keys`, session-only)

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/v1/api-keys` | Body `{ name, rateLimitPerMinute? }` → **201** with the **plaintext key** (only time it is ever returned) + metadata |
| `GET` | `/v1/api-keys` | List the tenant's keys — prefix + last-4 only, never key material |
| `DELETE` | `/v1/api-keys/:id` | Revoke (soft delete): set `revoked_at`; the key fails auth immediately |

**Key security.** Keys are `rag_live_` + 32 bytes of `crypto.getRandomValues`
(base64url). The **plaintext is never stored** — only its SHA-256 hash (unique,
indexed). Postgres keeps a display `key_prefix` + `last4` for the UI.

**Revocation is immediate.** The Cloudflare version kept a KV cache in front of
the key lookup, which made revocation *eventually* consistent: a revoked key
stayed valid until the cache entry was purged (best-effort) or its TTL expired.
That cache is gone. Nothing on Vercel offers a shared cache this app already
pays for, and a per-instance one would be strictly worse — unpurgeable from
another instance. Since an API-key request already touches Postgres for the
rate-limit check, folding the key lookup into the same database costs one extra
indexed read and buys revocation with no window at all. `last_used_at` is
refreshed fire-and-forget via `after()`, throttled to at most once per key per
minute so it never adds latency.

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

**Mechanism: Postgres, with a per-key advisory lock**
([`ratelimit.ts`](apps/web/src/server/services/ratelimit.ts)).

The Cloudflare version used a Durable Object, whose single-threaded-per-instance
execution gave true atomic increments. There is no equivalent primitive on
Vercel: functions are stateless and scale horizontally, so any in-process
counter is per-instance and trivially bypassed by landing on a different one.
The limiter has to live in shared storage, and Postgres is both the only shared
store this app already has and the only one that can make the check atomic.

Neon's HTTP driver has no interactive transactions, so a read-then-write would
race — two concurrent requests could both read `n = limit - 1` and both admit.
Instead the whole check runs as **one statement** whose first CTE takes a
transaction-scoped advisory lock keyed on the API key. Every request for a given
key serializes on that lock, exactly as it did on one DO instance, while
different keys never contend.

**Algorithm: sliding-window log.** `rate_limits.hits` keeps the timestamps of
allowed hits in the trailing 60s window. A naive *fixed* window lets a caller
fire a full quota at the end of one window and again at the start of the next
(~2× burst at the boundary); the sliding window moves continuously with `now`,
so the limit holds across every 60s span. Rejected requests are not recorded, so
being throttled never extends the penalty. Idle rows are swept by the daily
cron.

**Behavior:**

- Limit is **per key, per minute** — `DEFAULT_RATE_LIMIT_PER_MINUTE` (60),
  overridable per key via `rate_limit_per_minute`.
- Runs during auth, **before** any expensive work, so a throttled request never
  reaches embedding/retrieval/generation.
- Every API-key response carries `RateLimit-Limit`, `RateLimit-Remaining`,
  `RateLimit-Reset` (seconds). A rejection returns **429** with `Retry-After`
  and a JSON body `{ error, retryAfter, limit }`.
- **Session (dashboard) traffic is not rate-limited** — it is Clerk-gated,
  interactive and low-volume; the surface being protected is programmatic
  API-key traffic.

Tunables in [`config.ts`](apps/web/src/server/config.ts):
`DEFAULT_RATE_LIMIT_PER_MINUTE`, `MAX_RATE_LIMIT_PER_MINUTE`,
`RATE_LIMIT_WINDOW_MS`, `LAST_USED_THROTTLE_MS`, `RATE_LIMIT_ROW_TTL_MS`,
`API_KEY_PREFIX`, `API_KEY_RANDOM_BYTES`.

## Usage analytics (Feature 5)

Every query and ingestion is recorded as a row in the `usage_events` table and
surfaced on a dashboard at **`/dashboard/analytics`** (KPI cards with
period-over-period deltas + sparklines, a stacked queries-over-time chart with a
p95 latency line, latency-by-stage and by-collection breakdowns, an outcome
donut, token/cost over time, ingestion stats, and a paginated drill-down table
with a per-event detail sheet).

**What's tracked.** For **queries**: per-stage latency (embedding / retrieval /
generation) and total, chunks retrieved, top similarity score, prompt/completion
tokens, estimated cost, auth type, collection, and outcome — including the
`no_results`, `error`, and `rate_limited` cases, not just successes. For
**ingestion**: duration, chunk count, bytes processed, and success/failure.

**Writes are off the critical path.** A user request must never be slowed or
failed by analytics, so every write goes through `after(...)` (never awaited
before responding) and the recorder swallows its own errors (logs only). Token
counting and cost estimation also run *inside* the deferred closure, so
instrumentation adds no latency.

**Storage.** Postgres is the primary — and now only — store. The Cloudflare
version dual-wrote to Workers Analytics Engine for write volume, but that
backend is **write-only from a Worker** (reading it back needs the account SQL
API), so the dashboard read D1 anyway and the dual-write was additive rather
than a replacement. Postgres is both writable and readable from the same
runtime, and its window functions and `FILTER` clauses make the aggregations
simpler than the SQLite originals. If write volume ever outgrows a single
Postgres writer, a column-store recorder slots in behind
`CompositeAnalyticsRecorder` without touching a call site.

**Privacy — raw query text is not stored by default.** We keep a SHA-256 hash of
the query plus its length (enough to spot duplicate/abusive queries) but **not
the text**. Plaintext storage is gated behind the `STORE_RAW_QUERY_TEXT` flag in
[`config.ts`](apps/web/src/server/config.ts), which defaults to **`false`**; the
event-detail sheet says so explicitly when text is absent. No chunk contents are
ever stored.

**Retention.** A daily **Vercel Cron** job (`crons` in
[`vercel.json`](apps/web/vercel.json), handled by
[`app/api/cron/prune/route.ts`](apps/web/src/app/api/cron/prune/route.ts))
prunes `usage_events` older than `ANALYTICS_RETENTION_DAYS` (default **90**) and
sweeps idle `rate_limits` rows. That endpoint is publicly routable, so it
authenticates: Vercel sends `Authorization: Bearer $CRON_SECRET`, and the route
**fails closed** if `CRON_SECRET` is unset — a deploy that forgets it gets 401s
in the cron log rather than leaving unbounded deletes open to anyone who guesses
the path.

**API** (session-only — analytics is a dashboard feature, not part of the public
API; an API key gets a 401):
`GET /v1/analytics/{summary,timeseries,breakdown,recent,ingestion}`, all
tenant-scoped and accepting `from`/`to` (epoch ms or ISO) + optional
`collectionId`. Aggregation happens entirely in SQL
([`analytics-queries.ts`](apps/web/src/server/services/analytics-queries.ts));
no endpoint pulls raw rows to reduce in JS. Percentiles use a single tested
helper ([`percentile.ts`](apps/web/src/server/lib/percentile.ts) +
[its tests](apps/web/src/server/lib/percentile.test.ts)) whose nearest-rank
formula is mirrored into the SQL `ROW_NUMBER()` filter — deliberately *not*
Postgres's `percentile_disc`, which defines the rank differently and would
silently shift the numbers the dashboard shows.

Config knobs in [`config.ts`](apps/web/src/server/config.ts):
`ANALYTICS_RETENTION_DAYS`, `STORE_RAW_QUERY_TEXT`,
`ANALYTICS_DEFAULT_RANGE_DAYS`, `MODEL_COSTS` / `DEFAULT_MODEL_COST` (per-model
per-token rates for cost estimation — the *paid-tier* list prices, since both
models are free on the free tier; a rough relative signal, not a billing
figure).

## API documentation (Feature 6)

The API is self-documenting. Zod schemas in
[`packages/shared`](packages/shared/src/schemas) are the single source of truth:
the TypeScript types both halves use are inferred from them, and the **OpenAPI
3.1** spec is generated from the same schemas — so the docs, the types, and the
validated contract cannot drift.

- **Machine-readable spec**: `GET /api/v1/openapi.json` (and `.yaml`) — public,
  cached, valid OpenAPI 3.1. Import it into Postman/Insomnia/Swagger Editor, or
  regenerate/validate locally with `pnpm --filter web gen:openapi` (writes
  [`apps/web/src/generated/openapi.json`](apps/web/src/generated/openapi.json)
  and fails on an invalid spec). Every operation is tagged, marks which auth
  scheme(s) it accepts (`ApiKeyAuth` / `SessionAuth`), and documents all its
  responses — including `429` with the `RateLimit-*` and `Retry-After` headers.
- **Hosted docs**: a public docs section at [`/docs`](apps/web/src/app/docs) —
  overview + quickstart, authentication, rate limits, errors, an ingestion
  guide, and a full **`/docs/reference`** rendered from the spec (per-endpoint
  schemas, curl/TypeScript/Python samples, and an authenticated "Try it"
  console). Readable signed out.

The spec is registered in a dedicated layer
([`server/openapi`](apps/web/src/server/openapi)) rather than by routing through
a validating router, which keeps every endpoint's request handling (and error
bodies) unchanged. The generator is `@asteasolutions/zod-to-openapi` directly;
the API paths in the spec are relative to the `/api` base carried in its
`servers` entries.

## Run in dev

```bash
pnpm dev          # app + API on http://localhost:3000
```

Quick API check (no auth needed):

```bash
curl http://localhost:3000/api/health   # -> {"status":"ok","version":"0.2.0",...}
curl http://localhost:3000/api/me       # -> 401 {"error":"Missing credentials"}
```

Unlike the Workers setup, there are no local emulators: `next dev` talks to the
real Neon database, the real Vercel Blob store, and the real Workers AI and
Pinecone APIs. Point `DATABASE_URL` at a Neon **branch** to keep local work off
production data.

## Scripts (root)

| Script | Description |
| --- | --- |
| `pnpm dev` | Run the app (frontend + API) in dev mode |
| `pnpm build` | Build every package (types + `next build`) |
| `pnpm start` | Serve the production build locally |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm lint` | Lint all packages |
| `pnpm test` | Run unit tests |
| `pnpm db:generate` | Generate SQL migrations from the Drizzle schema |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |
| `pnpm eval:run` | Run retrieval experiments (real APIs — see [Retrieval evaluation](#retrieval-evaluation-feature-8)) |
| `pnpm eval:gen` | Generate a golden-dataset review queue |
| `pnpm eval:beir` | Score retrieval against a public BEIR benchmark (real APIs) |
| `pnpm eval:clean` | Delete the harness's Pinecone namespaces |
| `pnpm eval:reset` | Clean slate: eval namespaces + run output (`--cache` for the cache too) |

## Deploy

Deployment is Vercel's Git integration — connect the repository and it builds
and deploys every push.

**Project settings** (Vercel dashboard):

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root directory | `apps/web` |
| Install command | `pnpm install` (from the repo root; Vercel handles the workspace) |
| Node.js version | 22.x |

Then:

1. **Add the storage.** *Storage → Create → Postgres (Neon)* and *Storage →
   Create → Blob* with access **Private**. Both set their environment variables
   on the project automatically (`DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`).
2. **Set the remaining environment variables** from
   [`apps/web/.env.example`](apps/web/.env.example) — `CLERK_ISSUER`,
   `CLERK_AUTHORIZED_PARTY`, `CLOUDFLARE_*`, `PINECONE_*`, `CRON_SECRET`,
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_API_URL` /
   `PUBLIC_API_URL` (your deployed origin + `/api`).
3. **Apply the migrations**: `DATABASE_URL=… pnpm db:migrate`, or let the
   [CI workflow](.github/workflows/ci.yml) do it on the next push to `main`.
4. **Point Clerk at the deployed origin** — add your Vercel URL to the Clerk
   application's allowed origins, and set `CLERK_AUTHORIZED_PARTY` to the same
   value, or every session token it issues is rejected by the `azp` check.

The cron job in [`vercel.json`](apps/web/vercel.json) is registered
automatically on deploy.

> **`maxDuration` and the Hobby plan.** The upload and reingest routes declare
> `maxDuration = 300`. Vercel clamps that to the plan's ceiling — 60s on Hobby.
> Ingestion of a typical document finishes well inside 60s; a very large PDF may
> not, and will leave the document in `processing` until it is reprocessed. Pro
> (or Fluid compute) removes the constraint.

## Continuous deployment

Vercel builds and deploys on every push. GitHub Actions
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) owns the part Vercel
does not:

```
push to main ──► check (typecheck + lint + test + build)
                   └─► migrate (drizzle migrations against production)

pull request ──► check only
```

Add one repository secret under *Settings → Secrets and variables → Actions*:

| Secret | Value |
| --- | --- |
| `DATABASE_URL` | the production Neon connection string |

The `migrate` job is pinned to a GitHub `environment: production`, so it can be
gated behind a required reviewer.

Migrations are expected to be **additive**: this job and the Vercel deploy are
not ordered relative to each other. A destructive migration needs a deliberate
two-phase rollout, or disable Vercel's Git integration for production and
trigger it from a deploy hook after `migrate` succeeds.

## Retrieval evaluation (Feature 8)

A standalone harness in [`apps/web/eval/`](apps/web/eval/) that measures how good
**retrieval** is — chunking + embedding + vector search together — so
configurations can be compared instead of guessed at.

```bash
pnpm eval:run -- --config baseline --config chunk-1200   # compare two configs
pnpm eval:gen -- --name my-set                           # generate a dataset
pnpm eval:beir -- --dry-run                              # price a BEIR run
pnpm eval:beir                                           # score against NFCorpus
pnpm eval:clean                                          # drop eval namespaces
pnpm eval:reset -- --dry-run                             # clean slate, previewed
```

It reuses the production pipeline (`chunkPages`, `WorkersAiEmbeddingProvider`,
`PineconeVectorStore`, `retrieveFromNamespace`) rather than reimplementing it,
indexes only into `__eval__:`-prefixed Pinecone namespaces, and never touches
tenant data or the database.

**It is not part of `pnpm test` or CI** — it calls live models, spends real
Workers AI quota, and its results are non-deterministic. Only its metric math is
unit-tested in the vitest suite, which still needs no secrets.

The design decision that makes it work: **ground truth is anchored to source
character spans, never to chunk ids**, so one dataset validly scores different
chunking configurations. That required `chunkPages()` to record `startChar` /
`endChar` on every chunk — every chunk is now a contiguous slice of its source
page text, an invariant asserted in
[`chunking.test.ts`](apps/web/src/server/lib/chunking.test.ts) — and ingestion
now writes those offsets into vector metadata.

**Two answer keys, deliberately.** `eval:run` scores a small hand-written golden
set whose ground truth is a character span — it catches a regression in our
pipeline on our content, and survives a chunk-size change. `eval:beir` scores a
public BEIR benchmark (NFCorpus: 3,633 documents, 323 judged test queries) whose
ground truth is whole documents, which is what says whether the stack is
competitive by an outside standard. Neither substitutes for the other: a
document-level answer key structurally cannot detect a chunk boundary that
splits an answer in half, and our own corpus cannot tell us how we rank.

Making the second work meant folding the retrieved **chunk** ranking into a
**document** ranking — each document entering at its best chunk, once — before
scoring against the qrels. Scoring chunks directly against document-level
judgements would count one relevant document retrieved as five chunks as five
successes.

BEIR datasets are not committed (~9 MB of third-party corpus each); a run is
reproduced by naming the dataset and checking the corpus fingerprint the report
prints. `pnpm eval:beir -- --dry-run` prices a run before it indexes anything —
NFCorpus in full is ~15% of a day's free Workers AI allowance.

Full method, metrics, cost caveats, and how to build a dataset:
[`apps/web/eval/README.md`](apps/web/eval/README.md) and
[`apps/web/eval/BEIR.md`](apps/web/eval/BEIR.md).

## What is intentionally NOT implemented

Billing/plans/quotas (beyond the per-minute rate limit) and **API-key
scopes/permissions** — all keys are currently full-access for their tenant
(`// TODO: scopes` in
[`apikeys.ts`](apps/web/src/server/services/apikeys.ts)). Out of scope for
analytics: billing/invoicing, per-user (sub-tenant) attribution, alerting,
report export, and real-time streaming updates. Within the query pipeline:
**re-ranking** with a cross-encoder (clean insertion point marked between
retrieval and context assembly), query rewriting / HyDE / multi-query, semantic
caching, an evaluation harness, and conversation history (single-turn Q&A only).
**Hybrid (sparse+dense) search** is not enabled: the Workers AI endpoint for
bge-m3 exposes dense vectors only, so retrieval is dense-only behind the
`VectorStore` seam
(see the `// TODO: hybrid search` marker in
[`retrieval.ts`](apps/web/src/server/services/retrieval.ts)). **Durable
resumption of ingestion** is not implemented — see
[Ingestion pipeline](#ingestion-pipeline-feature-2) for what that means in
practice and why.
