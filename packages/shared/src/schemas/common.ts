/**
 * Common Zod schemas + primitive aliases shared across every request/response
 * shape. Zod is the single source of truth: the TypeScript types re-exported
 * from `../index.ts` are inferred from these schemas, and the OpenAPI spec
 * (apps/api) is generated from the same schemas. `.meta({ id })` names a schema
 * so it surfaces as a reusable `#/components/schemas/*` entry in the spec.
 */
import { z } from "zod";

/** ISO-8601 timestamp string, e.g. "2026-07-21T12:34:56.000Z". */
export type IsoDateString = string;

/** Epoch milliseconds — how the API stores and returns timestamps (D1 integer). */
export type EpochMillis = number;

/** An epoch-ms timestamp field with a realistic example for the spec. */
export const epochMillis = (example = 1_753_800_000_000) =>
  z.number().int().meta({ example });

/**
 * Shared error envelope. Every non-2xx JSON response uses this shape
 * (`{ "error": "..." }`); rate-limit responses extend it (see query schemas).
 */
export const ErrorSchema = z
  .object({
    error: z.string().meta({ example: "Collection not found" }),
  })
  .meta({
    id: "Error",
    description: "Standard error response body used across the API.",
  });

/**
 * Lifecycle status of a document. Uploads start at `uploaded`; the ingestion
 * pipeline (parse → chunk → embed → upsert) moves it to `processing` and then
 * `ready`, or `error` with a message.
 */
export const DocumentStatusSchema = z
  .enum(["uploaded", "processing", "ready", "error"])
  .meta({ id: "DocumentStatus", example: "ready" });

/** How a request authenticated: a Clerk dashboard session, or an API key. */
export const AuthTypeSchema = z
  .enum(["session", "apikey"])
  .meta({ id: "AuthType", example: "apikey" });

/** What kind of operation an analytics event records. */
export const UsageEventTypeSchema = z
  .enum(["query", "ingestion"])
  .meta({ id: "UsageEventType", example: "query" });

/**
 * Outcome of a recorded event. `no_results` is a successful query that
 * retrieved nothing relevant; `rate_limited` is a 429; `error` is any failure.
 */
export const UsageEventStatusSchema = z
  .enum(["success", "error", "rate_limited", "no_results"])
  .meta({ id: "UsageEventStatus", example: "success" });

/** Bucket granularity for the analytics time-series endpoint. */
export const TimeseriesGranularitySchema = z
  .enum(["hour", "day"])
  .meta({ id: "TimeseriesGranularity", example: "day" });

/**
 * The authenticated principal attached to a request after auth succeeds
 * (Clerk JWT or API key). Returned by `GET /me`.
 */
export const AuthContextSchema = z
  .object({
    tenantId: z.string().meta({ example: "org_2abc123" }),
    authType: AuthTypeSchema,
    userId: z
      .string()
      .optional()
      .meta({ description: "Clerk user id — present only for `session` auth." }),
    keyId: z
      .string()
      .optional()
      .meta({ description: "Id of the API key used — present only for `apikey` auth." }),
  })
  .meta({ id: "AuthContext" });
