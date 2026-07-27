/**
 * Build-time syntax highlighting (Feature 6).
 *
 * Runs during the static export (`next build`) inside Server Components, so no
 * highlighter ships to the browser. Emits dual-theme markup (`--shiki-light` /
 * `--shiki-dark` CSS variables) that globals.css switches on the `.dark` class,
 * matching the app's light/dark tokens. The highlighter is created once and
 * reused across the whole build.
 */
import { createHighlighter, type Highlighter } from "shiki";

/** Languages used across docs prose + generated code samples. */
export type CodeLang = "bash" | "ts" | "python" | "json" | "http";

const LIGHT_THEME = "github-light";
const DARK_THEME = "github-dark";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [LIGHT_THEME, DARK_THEME],
      langs: ["bash", "ts", "python", "json", "http"],
    });
  }
  return highlighterPromise;
}

/**
 * Highlight `code` in `lang` to dual-theme HTML. Call from a Server Component
 * (`await highlight(...)`) and render with `dangerouslySetInnerHTML`.
 */
export async function highlight(code: string, lang: CodeLang): Promise<string> {
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: false,
  });
}
