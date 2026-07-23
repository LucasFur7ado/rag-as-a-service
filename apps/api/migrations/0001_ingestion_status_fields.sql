ALTER TABLE `documents` ADD `chunk_count` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `ingested_at` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `workflow_instance_id` text;