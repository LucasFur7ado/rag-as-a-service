/** Collection Zod schemas — source of truth for both the API and the web app. */
import { z } from "zod";
import { epochMillis } from "./common";

/**
 * A collection is a named group of documents indexed together and queried as a
 * unit (one knowledge base / one vector namespace). Mirrors the
 * `collections` table (apps/api/src/db/schema.ts).
 */
export const CollectionSchema = z
  .object({
    id: z.string().meta({ example: "col_9f8b2a1c" }),
    tenantId: z.string().meta({ example: "org_2abc123" }),
    name: z.string().meta({ example: "Product docs" }),
    description: z
      .string()
      .optional()
      .meta({ example: "Public product documentation and FAQs." }),
    createdAt: epochMillis(),
    updatedAt: epochMillis(),
  })
  .meta({ id: "Collection", description: "A named group of documents indexed and queried together." });

/** Body for POST /v1/collections. */
export const CreateCollectionRequestSchema = z
  .object({
    name: z.string().min(1).meta({ example: "Product docs" }),
    description: z
      .string()
      .optional()
      .meta({ example: "Public product documentation and FAQs." }),
  })
  .meta({ id: "CreateCollectionRequest" });

/** Response wrapping a single collection (create / get). */
export const CollectionResponseSchema = z
  .object({ collection: CollectionSchema })
  .meta({ id: "CollectionResponse" });

/** Response for GET /v1/collections. */
export const ListCollectionsResponseSchema = z
  .object({ collections: z.array(CollectionSchema) })
  .meta({ id: "ListCollectionsResponse" });
