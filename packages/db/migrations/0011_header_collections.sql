CREATE TABLE `header_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`href` text,
	`description` text,
	`image` text,
	`position` integer DEFAULT 0 NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `header_collections_slug_unique` ON `header_collections` (`slug`);
--> statement-breakpoint
CREATE INDEX `header_collections_position_idx` ON `header_collections` (`position`);
--> statement-breakpoint
CREATE INDEX `header_collections_visible_idx` ON `header_collections` (`is_visible`);
--> statement-breakpoint
CREATE TABLE `header_collection_items` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`href` text,
	`description` text,
	`image` text,
	`position` integer DEFAULT 0 NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `header_collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `header_collection_items_collection_id_idx` ON `header_collection_items` (`collection_id`);
--> statement-breakpoint
CREATE INDEX `header_collection_items_position_idx` ON `header_collection_items` (`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `header_collection_items_collection_slug_uidx` ON `header_collection_items` (`collection_id`,`slug`);
