PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_carts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`guest_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_carts`("id", "user_id", "guest_id", "status", "updated_at", "created_at") SELECT "id", "user_id", "guest_id", "status", "updated_at", "created_at" FROM `carts`;--> statement-breakpoint
DROP TABLE `carts`;--> statement-breakpoint
ALTER TABLE `__new_carts` RENAME TO `carts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `carts_user_id_idx` ON `carts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `carts_user_id_uidx` ON `carts` (`user_id`);--> statement-breakpoint
CREATE INDEX `carts_guest_id_idx` ON `carts` (`guest_id`);--> statement-breakpoint
CREATE INDEX `carts_status_updated_at_idx` ON `carts` (`status`,`updated_at`);