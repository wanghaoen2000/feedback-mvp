-- 为 correction_tasks 添加多轮对话重试支持
ALTER TABLE `correction_tasks` ADD COLUMN `retry_count` INT DEFAULT 0;
ALTER TABLE `correction_tasks` ADD COLUMN `conversation_history` MEDIUMTEXT DEFAULT NULL;
