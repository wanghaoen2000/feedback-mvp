CREATE TABLE `background_tasks` (
	`id` varchar(36) NOT NULL,
	`course_type` varchar(20) NOT NULL,
	`display_name` varchar(200) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`current_step` int NOT NULL DEFAULT 0,
	`total_steps` int NOT NULL DEFAULT 5,
	`input_params` text NOT NULL,
	`step_results` text,
	`error_message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completed_at` timestamp,
	CONSTRAINT `background_tasks_id` PRIMARY KEY(`id`)
);
