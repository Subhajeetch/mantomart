import { is } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),

  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role", { enum: ["customer", "admin"] }).notNull().default("customer"),


  firstName: text("first_name"),
  lastName: text("last_name"),
  dateOfBirth: integer("date_of_birth", { mode: "timestamp" }),
  gender: text("gender", { enum: ["male", "female", "other", "prefer_not_to_say"] }),


  phone: text("phone"),
  phoneVerified: integer("phone_verified", { mode: "boolean" }).notNull().default(false),
  defaultAddressId: text("default_address_id"),  // soft ref

  emailNotifications: integer("email_notifications", { mode: "boolean" }).notNull().default(true),

  smsNotifications: integer("sms_notifications", { mode: "boolean" }).notNull().default(true),

  currency: text("currency").notNull().default("USD"),
  locale: text("locale").notNull().default("en-US"),
  timezone: text("timezone").notNull().default("UTC"),


  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  ragiCoins: integer("ragi_coins").notNull().default(0),
  referralCode: text("referral_code").unique(),
  referredBy: text("referred_by"),

  totalSpent: real("total_spent").notNull().default(0),
  totalOrders: integer("total_orders").notNull().default(0),
  averageOrderValue: real("average_order_value").notNull().default(0),
  isVipUser: integer("is_vip_user", { mode: "boolean" }).notNull().default(false),

  isBanned: integer("is_banned", { mode: "boolean" }).notNull().default(false),
  bannedAt: integer("banned_at", { mode: "timestamp" }),
  bannedReason: text("banned_reason"),
  bannedBy: text("banned_by"),                   // admin userId — soft ref
  isVerifiedSeller: integer("is_verified_seller", { mode: "boolean" }).notNull().default(false), // if you ever go marketplace
  adminNotes: text("admin_notes"),               // internal only, never exposed to user
  isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false), // soft delete — never hard delete a user with orders
  deletedAt: integer("deleted_at", { mode: "timestamp" }),

  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  lastLoginIp: text("last_login_ip"),
  lastActiveAt: integer("last_active_at", { mode: "timestamp" }),
  loginCount: integer("login_count").notNull().default(0),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),                    
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),  
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }), 
  scope: text("scope"),                         
  password: text("password"),                   
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});


// only the override perms
export const userPermissions = sqliteTable("user_permissions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(),
  granted: integer("granted", { mode: "boolean" }).notNull().default(true),
  grantedBy: text("granted_by").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});