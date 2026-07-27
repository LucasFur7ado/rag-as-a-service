/**
 * "Built on" strip. Deliberately lists the real infrastructure behind the
 * platform rather than customer logos — nothing here is a claim we cannot back
 * up (see the architecture section of the repo README).
 */
const STACK = [
  "Cloudflare Workers",
  "Workers AI · BGE-M3",
  "Llama 3.3 70B",
  "Pinecone",
  "D1 + R2",
  "Clerk",
];

export function TechStrip() {
  return (
    <section aria-label="Platform infrastructure" className="border-t bg-muted/30 py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Built on infrastructure that scales to the edge
        </p>
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {STACK.map((item) => (
            <li
              key={item}
              className="font-mono text-sm text-muted-foreground/80 transition-colors hover:text-foreground"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
