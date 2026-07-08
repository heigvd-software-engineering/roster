CREATE TABLE `class_members` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`github_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_members_class_id_github_id_unique` ON `class_members` (`class_id`,`github_id`);--> statement-breakpoint
ALTER TABLE `classes` ADD `login` text;--> statement-breakpoint
ALTER TABLE `classes` ADD `name` text;--> statement-breakpoint
ALTER TABLE `classes` ADD `avatar_url` text;