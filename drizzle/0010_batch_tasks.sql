-- 批量任务表（服务器端后台执行）
CREATE TABLE IF NOT EXISTS `batch_tasks` (
  `id` varchar(36) NOT NULL,
  `display_name` varchar(200) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `total_items` int NOT NULL DEFAULT 0,
  `completed_items` int NOT NULL DEFAULT 0,
  `failed_items` int NOT NULL DEFAULT 0,
  `input_params` mediumtext NOT NULL,
  `error_message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL,
  PRIMARY KEY (`id`)
);

-- 批量任务子项表
CREATE TABLE IF NOT EXISTS `batch_task_items` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `batch_id` varchar(36) NOT NULL,
  `task_number` int NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `chars` int DEFAULT 0,
  `filename` varchar(500),
  `url` text,
  `error` text,
  `truncated` int DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL,
  INDEX `idx_batch_id` (`batch_id`)
);
