-- Drop product-level price/compare_at_price (pricing is per SKU/variant).
-- Add images JSON column to product_skus for variant-linked media + alt text.
-- images/videos on products remain JSON text; app-level shape is now
-- { url, alt, variantKeys?, position? } / { url, poster?, alt? }.

PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`mobile_detail` text,
	`has_size_chart` integer DEFAULT false NOT NULL,
	`size_chart_image` text,
	`size_chart_description` text,
	`is_ae_product` integer DEFAULT false NOT NULL,
	`ae_product_id` text,
	`ae_category_id` text,
	`ae_rating` real,
	`ae_review_count` integer,
	`ae_sales_count` text,
	`ae_status` text,
	`ae_last_synced` integer,
	`images` text DEFAULT '[]',
	`videos` text DEFAULT '[]',
	`main_video` text,
	`category_id` text,
	`published` integer DEFAULT false NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`meta_title` text,
	`meta_description` text,
	`tags` text DEFAULT '[]',
	`order_count` integer DEFAULT 0 NOT NULL,
	`total_revenue` integer DEFAULT 0 NOT NULL,
	`product_added_by` text,
	`product_notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`product_added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_products`(
	"id", "slug", "name", "description", "mobile_detail",
	"has_size_chart", "size_chart_image", "size_chart_description",
	"is_ae_product", "ae_product_id", "ae_category_id", "ae_rating",
	"ae_review_count", "ae_sales_count", "ae_status", "ae_last_synced",
	"images", "videos", "main_video", "category_id", "published", "featured",
	"position", "meta_title", "meta_description", "tags", "order_count",
	"total_revenue", "product_added_by", "product_notes", "created_at", "updated_at"
)
SELECT
	"id", "slug", "name", "description", "mobile_detail",
	"has_size_chart", "size_chart_image", "size_chart_description",
	"is_ae_product", "ae_product_id", "ae_category_id", "ae_rating",
	"ae_review_count", "ae_sales_count", "ae_status", "ae_last_synced",
	"images", "videos", "main_video", "category_id", "published", "featured",
	"position", "meta_title", "meta_description", "tags", "order_count",
	"total_revenue", "product_added_by", "product_notes", "created_at", "updated_at"
FROM `products`;
--> statement-breakpoint
DROP TABLE `products`;
--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_ae_product_id_unique` ON `products` (`ae_product_id`);
--> statement-breakpoint
ALTER TABLE `product_skus` ADD `images` text DEFAULT '[]';
