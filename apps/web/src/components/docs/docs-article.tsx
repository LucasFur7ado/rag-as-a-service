import { OnThisPage } from "./on-this-page";

/** Prose page frame: readable-width article + an in-page TOC on wide screens. */
export function DocsArticle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-10">
      <article className="docs-prose min-w-0 max-w-3xl flex-1">{children}</article>
      <OnThisPage className="hidden xl:block" />
    </div>
  );
}
