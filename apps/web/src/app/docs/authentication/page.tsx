import Link from "next/link";
import { DocsArticle } from "@/components/docs/docs-article";
import { CodeBlock } from "@/components/docs/code-block";
import { API_BASE_URL } from "@/lib/docs-config";

export const metadata = {
  title: "Authentication — RAG as a Service Docs",
  description: "Session vs API key, header formats, and what happens on 401.",
};

export default function AuthenticationPage() {
  return (
    <DocsArticle>
      <h1>Authentication</h1>
      <p className="lead">
        Every request carries a bearer credential. There are two kinds, and each endpoint accepts
        specific ones.
      </p>

      <h2 id="api-keys">API keys (programmatic)</h2>
      <p>
        API keys are for server-to-server access. Create one in the dashboard under{" "}
        <Link href="/dashboard/api-keys">API keys</Link>; the plaintext value (prefixed{" "}
        <code>rag_live_</code>) is shown exactly once. Send it as a bearer token:
      </p>
      <CodeBlock
        lang="bash"
        code={`curl '${API_BASE_URL}/v1/collections' \\
  -H 'Authorization: Bearer rag_live_YOUR_KEY'`}
      />
      <p>
        An <code>X-API-Key</code> header is also accepted:
      </p>
      <CodeBlock
        lang="bash"
        code={`curl '${API_BASE_URL}/v1/collections' \\
  -H 'X-API-Key: rag_live_YOUR_KEY'`}
      />
      <p>
        API keys can read and write collections, documents, and run queries. They are rate-limited
        per key (see <Link href="/docs/rate-limits">rate limits</Link>) and <strong>cannot</strong>{" "}
        manage keys or read analytics.
      </p>

      <h2 id="sessions">Sessions (dashboard)</h2>
      <p>
        The dashboard authenticates with a Clerk session JWT, sent the same way (
        <code>Authorization: Bearer &lt;jwt&gt;</code>). Sessions are the only credential accepted by
        the dashboard-only endpoints — API-key management (<code>/v1/api-keys</code>) and analytics (
        <code>/v1/analytics/*</code>). Presenting an API key there returns <code>401</code>.
      </p>

      <h2 id="which">Which credential does an endpoint accept?</h2>
      <p>
        Every operation in the <Link href="/docs/reference">reference</Link> is labeled with the
        schemes it accepts (<em>API key</em>, <em>Session</em>, or both), and the OpenAPI spec marks
        each with <code>ApiKeyAuth</code> and/or <code>SessionAuth</code> security requirements.
      </p>

      <h2 id="unauthorized">What happens on 401</h2>
      <p>
        A missing, malformed, expired, or revoked credential returns <code>401</code> with the
        standard error body. A revoked API key stops working immediately.
      </p>
      <CodeBlock lang="json" code={`{ "error": "Invalid or expired credentials" }`} />
    </DocsArticle>
  );
}
