import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './auth';
import { products } from './products';

export const reviews = sqliteTable('reviews', {
    id: text('id').primaryKey(),
    productId: text('product_id').notNull().references(() => products.id),
    reviewerId: text('reviewer_id').notNull().references(() => users.id),
    reviewerName: text('reviewer_name').notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    imageUrls: text('image_urls', { mode: 'json' })
      .$type<string[]>()
      .default([]),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    check(
      'reviews_rating_check',
      sql`${table.rating} >= 1 and ${table.rating} <= 5`
    ),
  ]
);