/** Document Zod schemas — source of truth for both the API and the web app. */
import { z } from "zod";
import { DocumentStatusSchema, epochMillis } from "./common";

/**
 * A source document uploaded into a collection. The raw bytes live in R2; this
 * record (D1 `documents` table) is the metadata handle.
 */
export const DocumentSchema = z
  .object({
    id: z.string().meta({ example: "doc_4c1e77a0" }),
    tenantId: z.string().meta({ example: "org_2abc123" }),
    collectionId: z.string().meta({ example: "col_9f8b2a1c" }),
    filename: z.string().meta({ example: "handbook.pdf" }),
    contentType: z.string().meta({ example: "application/pdf" }),
    sizeBytes: z.number().int().meta({ example: 248_913 }),
    status: DocumentStatusSchema,
    error: z
      .string()
      .optional()
      .meta({ description: "Populated when `status === \"error\"`." }),
    chunkCount: z
      .number()
      .int()
      .optional()
      .meta({ example: 42, description: "Number of chunks indexed; populated when `status === \"ready\"`." }),
    ingestedAt: epochMillis()
      .optional()
      .meta({ description: "When ingestion last completed successfully." }),
    createdAt: epochMillis(),
    updatedAt: epochMillis(),
  })
  .meta({ id: "Document", description: "Metadata for an uploaded source document." });

/** Response for POST /v1/collections/:id/documents (multipart upload, field `file`). */
export const UploadDocumentResponseSchema = z
  .object({ document: DocumentSchema })
  .meta({ id: "UploadDocumentResponse" });

/** Response wrapping a single document (get). */
export const DocumentResponseSchema = z
  .object({ document: DocumentSchema })
  .meta({ id: "DocumentResponse" });

/** Response for GET /v1/collections/:id/documents. */
export const ListDocumentsResponseSchema = z
  .object({ documents: z.array(DocumentSchema) })
  .meta({ id: "ListDocumentsResponse" });

/** Response for GET /v1/documents/:id/status — lightweight polling shape. */
export const DocumentStatusResponseSchema = z
  .object({
    status: DocumentStatusSchema,
    chunkCount: z
      .number()
      .int()
      .optional()
      .meta({ example: 42, description: "Populated when `status === \"ready\"`." }),
    error: z
      .string()
      .optional()
      .meta({ description: "Populated when `status === \"error\"`." }),
    updatedAt: epochMillis(),
  })
  .meta({ id: "DocumentStatusResponse" });

/** Response for POST /v1/documents/:id/reingest (202 Accepted). */
export const ReingestDocumentResponseSchema = z
  .object({ document: DocumentSchema })
  .meta({ id: "ReingestDocumentResponse" });

/** Multipart upload body (documented for OpenAPI; the field is a binary file). */
export const UploadDocumentBodySchema = z
  .object({
    file: z
      .string()
      .meta({ format: "binary", description: "The source file (PDF, plain text, or Markdown)." }),
  })
  .meta({ id: "UploadDocumentBody" });
