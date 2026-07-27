import { highlight, type CodeLang } from "@/lib/shiki";
import { CopyButton } from "./copy-button";
import { cn } from "@/lib/utils";

/**
 * A syntax-highlighted code block. Async Server Component: highlighting runs at
 * build time (see src/lib/shiki.ts), so no highlighter ships to the browser.
 * The copy button is the only client island.
 */
export async function CodeBlock({
  code,
  lang = "bash",
  filename,
  className,
}: {
  code: string;
  lang?: CodeLang;
  filename?: string;
  className?: string;
}) {
  const trimmed = code.replace(/\n+$/, "");
  const html = await highlight(trimmed, lang);

  return (
    <div className={cn("group relative my-4 overflow-hidden rounded-lg border bg-muted/40", className)}>
      {filename ? (
        <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
          <span className="font-mono text-xs text-muted-foreground">{filename}</span>
        </div>
      ) : null}
      <div className="relative">
        <div
          className="overflow-x-auto p-4 text-sm [&_pre]:!bg-transparent"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <CopyButton
          text={trimmed}
          className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        />
      </div>
    </div>
  );
}
