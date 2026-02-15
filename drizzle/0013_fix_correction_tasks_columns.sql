-- Fix correction_tasks table: add missing columns that were not in the original migration 0011.
-- These ALTER TABLE statements are safe to run multiple times (they silently fail if columns exist).

-- Add user_id column (was missing from migration 0011, required by Drizzle schema)
ALTER TABLE `correction_tasks` ADD COLUMN `user_id` INT NOT NULL DEFAULT 0;

-- Add streaming_chars column (was missing from migration 0011, required by Drizzle schema)
ALTER TABLE `correction_tasks` ADD COLUMN `streaming_chars` INT DEFAULT 0;

-- Add index on user_id for tenant isolation queries
ALTER TABLE `correction_tasks` ADD INDEX `idx_corr_userId` (`user_id`);

-- Fix completed_at to be explicitly nullable (avoids MySQL TIMESTAMP implicit NOT NULL issues)
ALTER TABLE `correction_tasks` MODIFY COLUMN `completed_at` TIMESTAMP NULL;
