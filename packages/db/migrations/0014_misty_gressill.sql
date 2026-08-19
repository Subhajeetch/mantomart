CREATE TABLE `homepage_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`block_type` text NOT NULL,
	`config` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `homepage_blocks_position_idx` ON `homepage_blocks` (`position`);--> statement-breakpoint
CREATE INDEX `homepage_blocks_visible_idx` ON `homepage_blocks` (`is_visible`);--> statement-breakpoint
CREATE INDEX `homepage_blocks_type_idx` ON `homepage_blocks` (`block_type`);