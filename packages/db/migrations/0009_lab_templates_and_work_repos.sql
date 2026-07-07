ALTER TABLE `labs` ADD `template_repo_id` integer;--> statement-breakpoint
ALTER TABLE `labs` ADD `template_repo_full_name` text;--> statement-breakpoint
ALTER TABLE `student_lab_repos` ADD `gh_repo_id` integer;--> statement-breakpoint
ALTER TABLE `student_lab_repos` ADD `gh_repo_full_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `student_lab_repos_gh_repo_id_unique` ON `student_lab_repos` (`gh_repo_id`);