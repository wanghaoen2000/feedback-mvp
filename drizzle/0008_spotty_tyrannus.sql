ALTER TABLE `correction_tasks` ADD `streaming_chars` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `hw_entries` ADD `streaming_chars` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `hw_entries` ADD `started_at` timestamp;--> statement-breakpoint
ALTER TABLE `hw_entries` ADD `completed_at` timestamp;