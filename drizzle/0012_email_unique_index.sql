-- Add unique index on email column.
-- Email is the business unique identifier for a user.
-- NULL emails are allowed (MySQL unique index ignores NULLs).
-- Before applying: if duplicate emails exist, manually merge those users first.
ALTER TABLE `users` ADD UNIQUE INDEX `users_email_unique` (`email`);
