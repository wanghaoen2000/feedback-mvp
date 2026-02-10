CREATE TABLE `hw_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`student_name` varchar(64) NOT NULL,
	`raw_input` text NOT NULL,
	`parsed_content` mediumtext,
	`ai_model` varchar(128),
	`entry_status` varchar(20) NOT NULL DEFAULT 'pending',
	`error_message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `hw_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hw_students` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`plan_type` varchar(10) NOT NULL DEFAULT 'weekly',
	`next_class_date` varchar(20),
	`exam_target` varchar(255),
	`exam_date` varchar(20),
	`status` varchar(10) NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `hw_students_id` PRIMARY KEY(`id`),
	CONSTRAINT `hw_students_name_unique` UNIQUE(`name`)
);
