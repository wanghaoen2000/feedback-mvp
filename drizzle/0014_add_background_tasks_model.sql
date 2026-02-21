-- 为 background_tasks 表添加 model 列
-- 用于在任务运行时就能显示正在使用的AI模型（而不是只存在 inputParams JSON 中）
ALTER TABLE `background_tasks` ADD COLUMN `model` varchar(128) DEFAULT NULL;
