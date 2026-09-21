import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './auth';

export const addresses = sqliteTable(
  'addresses',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    countryCode: text('country_code').notNull(),
    countryName: text('country_name').notNull(),
    phoneCountryCode: text('phone_country_code').notNull(),
    phone: text('phone').notNull(),
    addressLine1: text('address_line_1').notNull(),
    addressLine2: text('address_line_2'),
    city: text('city').notNull(),
    state: text('state').notNull(),
    postalCode: text('postal_code').notNull(),
    deliveryInstructions: text('delivery_instructions'),
    mapboxPlaceId: text('mapbox_place_id'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('addresses_user_id_idx').on(table.userId)],
);
