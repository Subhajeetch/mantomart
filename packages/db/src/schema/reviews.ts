import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { users } from './auth';
import { products } from './products';

export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    reviewerId: text('reviewer_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewerName: text('reviewer_name').notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    imageUrls: text('image_urls', { mode: 'json' })
      .$type<string[]>()
      .default([]),
    /** True for reviews imported from AliExpress rather than written in-store. */
    isAe: integer('is_ae', { mode: 'boolean' }).notNull().default(false),
    /** Source-side review identifier, when the review comes from AliExpress. */
    sourceReviewId: text('source_review_id'),
    /** Original review publication date; createdAt remains the import time. */
    reviewDate: integer('review_date', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    check(
      'reviews_rating_check',
      sql`${table.rating} >= 1 and ${table.rating} <= 5`
    ),
    index('reviews_product_id_review_date_idx').on(
      table.productId,
      table.reviewDate
    ),
    index('reviews_product_id_is_ae_idx').on(table.productId, table.isAe),
  ]
);
