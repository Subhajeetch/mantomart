import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import * as relations from "./relations";

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema: { ...schema, ...relations } });
}

export type Database = ReturnType<typeof createDb>;

export * from "./schema";
export * from "./relations";
export * from "./types";