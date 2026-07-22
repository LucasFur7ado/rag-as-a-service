import { LandingCta } from "@/components/landing-cta";

// Statically renderable landing shell — auth-dependent CTA is a client island.
export default function Home() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-24 text-center">
      <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
        RAG as a Service
      </span>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        Ship retrieval-augmented answers over your own documents.
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Multi-tenant ingestion, vector search, and grounded generation behind a
        simple API. Bring your documents; we handle the retrieval.
      </p>
      <div className="flex items-center gap-3">
        <LandingCta />
      </div>
    </div>
  );
}
