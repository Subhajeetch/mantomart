import { relations } from "drizzle-orm";
import { adminStats } from "../schema/admin-stats";
import { users } from "../schema/auth";

export const adminStatsRelations = relations(adminStats, ({ one }) => ({
  user: one(users, {
    fields: [adminStats.userId],
    references: [users.id],
  }),
}));
