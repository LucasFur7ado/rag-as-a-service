import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env, IngestMessage } from "../env";

/**
 * Durable ingestion workflow (placeholder).
 *
 * Bound as INGEST_WORKFLOW in wrangler.jsonc. Once implemented, `run` will
 * drive the pipeline as discrete, retryable steps:
 *   parse → chunk → embed (EmbeddingProvider) → upsert (VectorStore) → mark ready.
 *
 * Kept as a stub so the binding can be declared as infrastructure-as-code
 * without shipping ingestion logic.
 */
export class IngestWorkflow extends WorkflowEntrypoint<Env, IngestMessage> {
  // TODO: implement ingestion steps using step.do(...).
  override async run(
    _event: Readonly<WorkflowEvent<IngestMessage>>,
    _step: WorkflowStep,
  ): Promise<void> {
    throw new Error("IngestWorkflow.run is not implemented");
  }
}
