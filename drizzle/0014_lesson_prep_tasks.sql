-- 备课任务表
CREATE TABLE IF NOT EXISTS `lesson_prep_tasks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `student_name` varchar(64) NOT NULL,
  `lesson_number` varchar(20),
  `is_new_student` int DEFAULT 0,
  `last_lesson_content` mediumtext,
  `student_status` mediumtext,
  `system_prompt` mediumtext,
  `result` mediumtext,
  `ai_model` varchar(128),
  `task_status` varchar(20) NOT NULL DEFAULT 'pending',
  `error_message` text,
  `streaming_chars` int DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_prep_userId` (`user_id`)
);
