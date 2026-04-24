CREATE TABLE `product_attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`ae_attr_name_id` text,
	`attr_name` text NOT NULL,
	`ae_attr_value_id` text,
	`attr_value` text NOT NULL,
	`attr_value_unit` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_skus` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`ae_sku_id` text,
	`ae_sku_attr` text,
	`price` integer NOT NULL,
	`compare_at_price` integer,
	`ae_price` integer,
	`ae_sale_price` integer,
	`stock` integer DEFAULT 0 NOT NULL,
	`sku` text,
	`price_includes_tax` integer DEFAULT false,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`mobile_detail` text,
	`has_size_chart` integer DEFAULT false NOT NULL,
	`size_chart_image` text,
	`size_chart_description` text,
	`price` integer NOT NULL,
	`compare_at_price` integer,
	`is_ae_product` integer DEFAULT false NOT NULL,
	`ae_product_id` text,
	`ae_category_id` text,
	`ae_rating` real,
	`ae_review_count` integer,
	`ae_sales_count` text,
	`ae_status` text,
	`ae_has_wholesale` integer DEFAULT false,
	`ae_currency_code` text,
	`ae_last_synced` integer,
	`images` text DEFAULT '[]',
	`video_url` text,
	`video_poster_url` text,
	`category_id` text,
	`published` integer DEFAULT false NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`meta_title` text,
	`meta_description` text,
	`tags` text DEFAULT '[]',
	`order_count` integer DEFAULT 0 NOT NULL,
	`total_revenue` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_ae_product_id_unique` ON `products` (`ae_product_id`);--> statement-breakpoint
CREATE TABLE `sku_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`sku_id` text NOT NULL,
	`ae_property_id` text,
	`property_name` text NOT NULL,
	`ae_value_id` text,
	`value` text NOT NULL,
	`value_definition_name` text,
	`image` text,
	FOREIGN KEY (`sku_id`) REFERENCES `product_skus`(`id`) ON UPDATE no action ON DELETE cascade
);
