CREATE TABLE `student_lab_repos` (
	`id` text PRIMARY KEY NOT NULL,
	`lab_id` text NOT NULL,
	`group_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lab_id`) REFERENCES `labs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_lab_repos_lab_id_group_id_unique` ON `student_lab_repos` (`lab_id`,`group_id`);