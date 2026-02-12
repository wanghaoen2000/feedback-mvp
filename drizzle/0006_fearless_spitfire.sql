CREATE TABLE `batch_task_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` varchar(36) NOT NULL,
	`task_number` int NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`chars` int DEFAULT 0,
	`filename` varchar(500),
	`url` text,
	`error` text,
	`truncated` int DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completed_at` timestamp,
	CONSTRAINT `batch_task_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `batch_tasks` (
	`id` varchar(36) NOT NULL,
	`display_name` varchar(200) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`total_items` int NOT NULL DEFAULT 0,
	`completed_items` int NOT NULL DEFAULT 0,
	`failed_items` int NOT NULL DEFAULT 0,
	`input_params` mediumtext NOT NULL,
	`error_message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completed_at` timestamp,
	CONSTRAINT `batch_tasks_id` PRIMARY KEY(`id`)
);
