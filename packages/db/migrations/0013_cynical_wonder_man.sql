CREATE TABLE `admin_stats` (
	`user_id` text PRIMARY KEY NOT NULL,
	`products_added` integer DEFAULT 0 NOT NULL,
	`orders_count` integer DEFAULT 0 NOT NULL,
	`products_with_orders` integer DEFAULT 0 NOT NULL,
	`revenue_cents` integer DEFAULT 0 NOT NULL,
	`profit_cents` integer DEFAULT 0 NOT NULL,
	`last_product_added_at` integer,
	`last_order_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "admin_stats_products_added_nonneg" CHECK("admin_stats"."products_added" >= 0),
	CONSTRAINT "admin_stats_orders_count_nonneg" CHECK("admin_stats"."orders_count" >= 0),
	CONSTRAINT "admin_stats_products_with_orders_nonneg" CHECK("admin_stats"."products_with_orders" >= 0),
	CONSTRAINT "admin_stats_revenue_cents_nonneg" CHECK("admin_stats"."revenue_cents" >= 0),
	CONSTRAINT "admin_stats_profit_cents_nonneg" CHECK("admin_stats"."profit_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX `admin_stats_products_added_idx` ON `admin_stats` (`products_added`);--> statement-breakpoint
CREATE INDEX `admin_stats_orders_count_idx` ON `admin_stats` (`orders_count`);--> statement-breakpoint
CREATE INDEX `admin_stats_revenue_cents_idx` ON `admin_stats` (`revenue_cents`);--> statement-breakpoint
CREATE TABLE `admin_stats_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`last_success_at` integer,
	`triggered_by` text,
	`triggered_by_name` text,
	`error` text,
	`admins_updated` integer DEFAULT 0 NOT NULL,
	`products_scanned` integer DEFAULT 0 NOT NULL,
	`orders_scanned` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
