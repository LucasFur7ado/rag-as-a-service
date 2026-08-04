CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"last4" text NOT NULL,
	"rate_limit_per_minute" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint,
	"revoked_at" bigint,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"blob_path" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"error" text,
	"chunk_count" integer,
	"ingested_at" bigint,
	"ingestion_run_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key_id" text PRIMARY KEY NOT NULL,
	"hits" bigint[] DEFAULT '{}' NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"event_type" text NOT NULL,
	"created_at" bigint NOT NULL,
	"collection_id" text,
	"document_id" text,
	"auth_type" text NOT NULL,
	"api_key_id" text,
	"status" text NOT NULL,
	"error_code" text,
	"latency_total_ms" integer,
	"latency_embed_ms" integer,
	"latency_retrieval_ms" integer,
	"latency_generation_ms" integer,
	"chunks_retrieved" integer,
	"top_score" double precision,
	"tokens_prompt" integer,
	"tokens_completion" integer,
	"estimated_cost" double precision,
	"query_hash" text,
	"query_length" integer,
	"query_text" text,
	"bytes_processed" bigint,
	"chunk_count" integer
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "collections_tenant_id_idx" ON "collections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_collection_id_idx" ON "documents" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_id_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "usage_events_tenant_created_idx" ON "usage_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_tenant_collection_idx" ON "usage_events" USING btree ("tenant_id","collection_id");--> statement-breakpoint
CREATE INDEX "usage_events_tenant_type_idx" ON "usage_events" USING btree ("tenant_id","event_type");