import {
  integer,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { products } from './products';
import { users } from './auth';

export const wishlistFolders = sqliteTable(
  'wishlist_folders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('Heart'),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    totalProducts: integer('total_products').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('wishlist_folders_user_id_idx').on(table.userId),
    uniqueIndex('wishlist_folders_user_name_uidx').on(table.userId, table.name),
  ]
);

export const wishlistProducts = sqliteTable(
  'wishlist_products',
  {
    id: text('id').primaryKey(),
    folderId: text('folder_id')
      .notNull()
      .references(() => wishlistFolders.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    uniqueIndex('wishlist_products_folder_product_uidx').on(
      table.folderId,
      table.productId
    ),
    index('wishlist_products_product_id_idx').on(table.productId),
    index('wishlist_products_folder_id_created_at_idx').on(
      table.folderId,
      table.createdAt
    ),
  ]
);
