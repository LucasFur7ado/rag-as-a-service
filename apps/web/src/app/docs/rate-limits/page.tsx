import Link from "next/link";
import { DocsArticle } from "@/components/docs/docs-article";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata = {
  title: "Rate limits — RAG as a Service Docs",
  description: "The per-key limit, RateLimit-* headers, 429 semantics, and recommended backoff.",
};

export default function RateLimitsPage() {
  return (
    <DocsArticle>
      <h1>Rate limits</h1>
      <p className="lead">
        API-key traffic is rate-limited per key with a sliding window. Dashboard sessions are not
        rate-limited.
      </p>

      <h2 id="the-limit">The limit</h2>
      <p>
        Each key has a requests-per-minute cap — <strong>60/min by default</strong>, configurable
        per key when you create it. The window is a continuous 60 seconds (not a fixed calendar
        minute), so the cap holds across every 60-second span.
      </p>

      <h2 id="headers">RateLimit-* headers</h2>
      <p>Every response to an API-key request carries the current limiter state:</p>
      <table>
        <thead>
          <tr>
            <th>Header</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>RateLimit-Limit</code>
            </td>
            <td>Requests allowed per minute for this key.</td>
          </tr>
          <tr>
            <td>
              <code>RateLimit-Remaining</code>
            </td>
            <td>Requests remaining in the current window.</td>
          </tr>
          <tr>
            <td>
              <code>RateLimit-Reset</code>
            </td>
            <td>Seconds until the window frees capacity.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="exceeded">When you exceed it (429)</h2>
      <p>
        Over the limit, the API returns <code>429 Too Many Requests</code> with a{" "}
        <code>Retry-After</code> header (seconds) — mirrored in the body — and the same{" "}
        <code>RateLimit-*</code> headers. No downstream work runs for a throttled request.
      </p>
      <CodeBlock
        lang="json"
        code={`{ "error": "Rate limit exceeded", "retryAfter": 30, "limit": 60 }`}
      />

      <h2 id="backoff">Recommended client backoff</h2>
      <p>
        On a <code>429</code>, wait the number of seconds in <code>Retry-After</code> before
        retrying, and prefer exponential backoff with jitter for repeated failures. Proactively, you
        can slow down as <code>RateLimit-Remaining</code> approaches zero rather than waiting for a
        rejection.
      </p>
      <CodeBlock
        lang="ts"
        code={`async function withRetry(run: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await run();
    if (res.status !== 429) return res;
    const retryAfter = Number(res.headers.get("Retry-After") ?? 1);
    const jitter = Math.random() * 0.3;
    await new Promise((r) => setTimeout(r, (retryAfter + jitter) * 1000 * 2 ** attempt));
  }
}`}
      />
      <p>
        See <Link href="/docs/errors">errors</Link> for the full status-code table.
      </p>
    </DocsArticle>
  );
}
