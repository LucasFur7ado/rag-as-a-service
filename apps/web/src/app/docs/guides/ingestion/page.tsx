import Link from "next/link";
import { DocsArticle } from "@/components/docs/docs-article";
import { CodeBlock } from "@/components/docs/code-block";
import { API_BASE_URL } from "@/lib/docs-config";

export const metadata = {
  title: "Ingesting documents — RAG as a Service Docs",
  description: "Upload a document, poll its status, and understand the ingestion lifecycle.",
};

export default function IngestionGuidePage() {
  return (
    <DocsArticle>
      <h1>Ingesting documents</h1>
      <p className="lead">
        Uploading a document is fast and asynchronous: the file is stored immediately, then indexed
        in the background. You poll for readiness before querying.
      </p>

      <h2 id="upload">1. Upload a file</h2>
      <p>
        POST the file as <code>multipart/form-data</code> with a <code>file</code> field to a
        collection you own. Accepted types are PDF, plain text, and Markdown (≤ 25 MB). The response
        is the new document at status <code>uploaded</code>.
      </p>
      <CodeBlock
        lang="bash"
        code={`curl -X POST '${API_BASE_URL}/v1/collections/col_9f8b2a1c/documents' \\
  -H 'Authorization: Bearer rag_live_YOUR_KEY' \\
  -F 'file=@./handbook.pdf'`}
      />

      <h2 id="poll">2. Poll for status</h2>
      <p>
        Ingestion (parse → chunk → embed → index) runs asynchronously. Poll the lightweight status
        endpoint until the document is <code>ready</code> (or <code>error</code>):
      </p>
      <CodeBlock
        lang="bash"
        code={`curl '${API_BASE_URL}/v1/documents/doc_4c1e77a0/status' \\
  -H 'Authorization: Bearer rag_live_YOUR_KEY'`}
      />
      <CodeBlock lang="json" code={`{ "status": "ready", "chunkCount": 42, "updatedAt": 1753800000000 }`} />

      <h2 id="lifecycle">3. The lifecycle</h2>
      <p>A document moves through these states:</p>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>uploaded</code>
            </td>
            <td>Stored and queued; indexing has not started.</td>
          </tr>
          <tr>
            <td>
              <code>processing</code>
            </td>
            <td>Being parsed, chunked, embedded, and indexed.</td>
          </tr>
          <tr>
            <td>
              <code>ready</code>
            </td>
            <td>Indexed and queryable. <code>chunkCount</code> is populated.</td>
          </tr>
          <tr>
            <td>
              <code>error</code>
            </td>
            <td>Ingestion failed; <code>error</code> explains why. Fix the source and re-ingest.</td>
          </tr>
        </tbody>
      </table>
      <p>
        A collection must have at least one <code>ready</code> document before it can be queried —
        querying an empty collection returns <code>409</code>.
      </p>

      <h2 id="reingest">Re-ingesting</h2>
      <p>
        If a document errored, or you want to re-index it, trigger a re-run. It is safe to repeat —
        vector ids are deterministic, so a re-run overwrites rather than duplicates:
      </p>
      <CodeBlock
        lang="bash"
        code={`curl -X POST '${API_BASE_URL}/v1/documents/doc_4c1e77a0/reingest' \\
  -H 'Authorization: Bearer rag_live_YOUR_KEY'`}
      />
      <p>
        Once a document is ready, head to the <Link href="/docs/reference">reference</Link> and try
        the query endpoint.
      </p>
    </DocsArticle>
  );
}
