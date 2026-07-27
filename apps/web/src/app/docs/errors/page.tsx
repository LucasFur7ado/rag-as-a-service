import Link from "next/link";
import { DocsArticle } from "@/components/docs/docs-article";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata = {
  title: "Errors — RAG as a Service Docs",
  description: "The error schema and a table of status codes with causes and fixes.",
};

const CODES: Array<{ code: string; name: string; cause: string; fix: string }> = [
  { code: "400", name: "Bad Request", cause: "Malformed JSON, or a field failed validation (e.g. empty query).", fix: "Check the request body against the endpoint schema." },
  { code: "401", name: "Unauthorized", cause: "Missing, invalid, expired, or revoked credential — or an API key on a session-only endpoint.", fix: "Send a valid bearer token of the accepted type." },
  { code: "404", name: "Not Found", cause: "The resource does not exist, or belongs to another tenant (never disclosed).", fix: "Verify the id and that it belongs to your tenant." },
  { code: "409", name: "Conflict", cause: "The action conflicts with current state (querying a collection with no ready documents; re-ingesting one already processing).", fix: "Wait for ingestion to finish, then retry." },
  { code: "413", name: "Payload Too Large", cause: "An upload exceeded the 25 MB limit.", fix: "Split or compress the file." },
  { code: "415", name: "Unsupported Media Type", cause: "The uploaded file is not PDF, plain text, or Markdown.", fix: "Convert to a supported format before uploading." },
  { code: "422", name: "Unprocessable Entity", cause: "A query found no relevant content in the collection.", fix: "Rephrase, or confirm the relevant document is ingested." },
  { code: "429", name: "Too Many Requests", cause: "The API key exceeded its rate limit.", fix: "Back off using Retry-After (see rate limits)." },
  { code: "500", name: "Internal Server Error", cause: "An unexpected server-side failure.", fix: "Retry with backoff; if it persists, report it." },
];

export default function ErrorsPage() {
  return (
    <DocsArticle>
      <h1>Errors</h1>
      <p className="lead">
        Every non-2xx response uses one consistent JSON shape, so clients can handle failures
        uniformly.
      </p>

      <h2 id="schema">Error schema</h2>
      <p>
        Errors carry a single human-readable <code>error</code> string. Rate-limit responses (
        <code>429</code>) add <code>retryAfter</code> and <code>limit</code>.
      </p>
      <CodeBlock lang="json" code={`{ "error": "Collection not found" }`} />

      <h2 id="status-codes">Status codes</h2>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Meaning</th>
            <th>Common cause</th>
            <th>How to fix</th>
          </tr>
        </thead>
        <tbody>
          {CODES.map((c) => (
            <tr key={c.code}>
              <td>
                <code>{c.code}</code>
              </td>
              <td>{c.name}</td>
              <td>{c.cause}</td>
              <td>{c.fix}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        The <Link href="/docs/reference">API reference</Link> lists exactly which of these each
        endpoint can return.
      </p>
    </DocsArticle>
  );
}
