# apps/web

The whole application: a Next.js 16 (App Router) frontend **and** the backend
API, deployed to Vercel as one project. Tailwind, shadcn/ui, Clerk auth.

`pnpm --filter web build` produces a standard Next.js server build. Vercel
consumes it natively — no adapter, no separate API deployment.

## Layout

```
src/
├── app/
│   ├── api/            # THE BACKEND. Route Handlers, one folder per endpoint.
│   │   ├── health/     #   /api/health
│   │   ├── me/         #   /api/me
│   │   ├── v1/…        #   /api/v1/collections, /documents, /api-keys, /analytics
│   │   └── cron/prune  #   daily retention sweep (Vercel Cron)
│   ├── dashboard/      # authenticated UI (client components)
│   └── docs/           # public docs, rendered from the generated OpenAPI spec
├── server/             # ALL backend logic. Never imported by a client component
│   │                   # (`server-only` makes that a build error).
│   ├── config.ts       # every tuning knob: chunking, retrieval, models, limits
│   ├── env.ts          # validated access to server environment variables
│   ├── db/             # Drizzle schema + Neon handle + row serializers
│   ├── lib/            # auth, http, blob storage, extraction, chunking, tokens
│   ├── services/       # embeddings, llm, vectorstore, retrieval, context,
│   │                   # citations, ingest, ratelimit, analytics
│   └── openapi/        # spec registration + document builder
├── components/         # UI
└── lib/                # browser-side helpers (typed API client, formatting)
```

## Architecture notes

- **Server-rendered.** `output: 'export'` is gone: a static export has no
  runtime, and the API now lives here. Pages are still prerendered where they
  can be (landing, docs); everything auth- or data-dependent is client-rendered
  and calls the same-origin `/api`.
- **No `trailingSlash`.** It existed so a plain file server could resolve
  `/docs` to `out/docs/index.html`. With a real server it is not just
  unnecessary but harmful — it would redirect every API route.
- **The `/api` prefix is the API base.** The OpenAPI spec carries it in its
  `servers` entries, so spec paths stay clean (`/v1/collections`).
- **Clerk is client-side only**, via **`@clerk/react`**, not `@clerk/nextjs`.
  The original reason (static export rejects the Server Actions `@clerk/nextjs`
  registers) is gone, but the choice still holds: the API verifies the Clerk JWT
  itself on every request, so nothing server-side needs a Clerk session — which
  is why this app has no `CLERK_SECRET_KEY`.
- **Route protection is client-side.** `src/components/require-auth.tsx` wraps
  protected pages in `<Show when="signed-in">` / `<Show when="signed-out">` +
  `<RedirectToSignIn>` (Clerk v7 replaced `<SignedIn>`/`<SignedOut>` with
  `<Show>`). This only hides UI — the route handlers are the trust boundary.
- **Background work uses `after()`**, not a queue. Ingestion and every analytics
  write are scheduled after the response is sent. See
  `src/server/services/ingest.ts` for what that costs versus the durable
  Cloudflare Workflow it replaced.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm --filter web dev` | Dev server (app + API) on :3000 |
| `pnpm --filter web build` | Production build (regenerates the OpenAPI spec first) |
| `pnpm --filter web start` | Serve the production build locally |
| `pnpm --filter web test` | Vitest unit tests |
| `pnpm --filter web db:generate` | Generate SQL migrations from the Drizzle schema |
| `pnpm --filter web db:migrate` | Apply migrations to `DATABASE_URL` |
| `pnpm --filter web gen:openapi` | Regenerate + validate `src/generated/openapi.json` |

See the [root README](../../README.md) for environment setup and deployment.
