CREATE TABLE `cart_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`product_id` text NOT NULL,
	`sku_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_snapshot` integer NOT NULL,
	`compare_at_price_snapshot` integer,
	`product_name_snapshot` text NOT NULL,
	`variant_label_snapshot` text,
	`image_snapshot` text,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sku_id`) REFERENCES `product_skus`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cart_items_cart_id_idx` ON `cart_items` (`cart_id`);--> statement-breakpoint
CREATE INDEX `cart_items_sku_id_idx` ON `cart_items` (`sku_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cart_items_cart_sku_uidx` ON `cart_items` (`cart_id`,`sku_id`);--> statement-breakpoint
CREATE TABLE `carts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `carts_user_id_idx` ON `carts` (`user_id`);--> statement-breakpoint
CREATE INDEX `carts_status_updated_at_idx` ON `carts` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `checkout_session_items` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`product_id` text NOT NULL,
	`sku_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_snapshot` integer NOT NULL,
	`compare_at_price_snapshot` integer,
	`product_name_snapshot` text NOT NULL,
	`variant_label_snapshot` text,
	`image_snapshot` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `checkout_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sku_id`) REFERENCES `product_skus`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checkout_session_items_session_id_idx` ON `checkout_session_items` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_session_items_session_sku_uidx` ON `checkout_session_items` (`session_id`,`sku_id`);--> statement-breakpoint
CREATE TABLE `checkout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checkout_sessions_user_id_idx` ON `checkout_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `checkout_sessions_status_idx` ON `checkout_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `checkout_sessions_expires_at_idx` ON `checkout_sessions` (`expires_at`);