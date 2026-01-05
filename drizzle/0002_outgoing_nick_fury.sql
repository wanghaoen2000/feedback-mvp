CREATE TABLE `task_progress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskKey` varchar(128) NOT NULL,
	`studentName` varchar(64) NOT NULL,
	`inputData` text NOT NULL,
	`currentStep` int NOT NULL DEFAULT 0,
	`step1Result` text,
	`step2Result` text,
	`step3Result` text,
	`step4Result` text,
	`step5Result` text,
	`dateStr` varchar(32),
	`status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `task_progress_id` PRIMARY KEY(`id`),
	CONSTRAINT `task_progress_taskKey_unique` UNIQUE(`taskKey`)
);
