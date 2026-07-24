CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`event_type` text NOT NULL,
	`created_at` integer NOT NULL,
	`collection_id` text,
	`document_id` text,
	`auth_type` text NOT NULL,
	`api_key_id` text,
	`status` text NOT NULL,
	`error_code` text,
	`latency_total_ms` integer,
	`latency_embed_ms` integer,
	`latency_retrieval_ms` integer,
	`latency_generation_ms` integer,
	`chunks_retrieved` integer,
	`top_score` real,
	`tokens_prompt` integer,
	`tokens_completion` integer,
	`estimated_cost` real,
	`query_hash` text,
	`query_length` integer,
	`query_text` text,
	`bytes_processed` integer,
	`chunk_count` integer
);
--> statement-breakpoint
CREATE INDEX `usage_events_tenant_created_idx` ON `usage_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_events_tenant_collection_idx` ON `usage_events` (`tenant_id`,`collection_id`);--> statement-breakpoint
CREATE INDEX `usage_events_tenant_type_idx` ON `usage_events` (`tenant_id`,`event_type`);