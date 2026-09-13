-- SQLite requires a default when adding a NOT NULL column to a populated table.
-- Existing rows are immediately backfilled from their referenced products below.
ALTER TABLE `cart_items` ADD `product_slug_snapshot` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `checkout_session_items` ADD `product_slug_snapshot` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `cart_items`
SET `product_slug_snapshot` = (
  SELECT `slug`
  FROM `products`
  WHERE `products`.`id` = `cart_items`.`product_id`
)
WHERE `product_slug_snapshot` = '';--> statement-breakpoint
UPDATE `checkout_session_items`
SET `product_slug_snapshot` = (
  SELECT `slug`
  FROM `products`
  WHERE `products`.`id` = `checkout_session_items`.`product_id`
)
WHERE `product_slug_snapshot` = '';