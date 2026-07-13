import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Audit log entries for admin / system actions.
 *
 * Design notes:
 * - Actor & target fields are denormalized (soft refs) so history survives
 *   user deletion / renames.
 * - `changes` stores field-level before/after diffs as JSON.
 * - The table is intentionally capped at ~1000 rows (enforced by the
 *   write helper in the API). Older rows are pruned on insert.
 */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),

    // ── What happened ───────────────────────────────────────────────────────
    /** Machine-readable action key, e.g. "user.ban", "admin.promote". */
    action: text("action").notNull(),
    /**
     * High-level category for filtering.
     * e.g. "user" | "admin" | "product" | "category" | "order" | "review" |
     *      "ae" | "system" | "auth" | "other"
     */
    category: text("category").notNull(),
    /** Human-readable one-line summary. */
    description: text("description").notNull(),
    /**
     * Outcome of the action.
     * "success" | "failure" | "partial"
     */
    status: text("status", {
      enum: ["success", "failure", "partial"],
    })
      .notNull()
      .default("success"),
    /**
     * Relative importance for UI highlighting.
     * "info" | "warning" | "critical"
     */
    severity: text("severity", {
      enum: ["info", "warning", "critical"],
    })
      .notNull()
      .default("info"),

    // ── Who did it (denormalized) ───────────────────────────────────────────
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    actorEmail: text("actor_email"),
    actorRole: text("actor_role"),

    // ── What was affected (denormalized) ────────────────────────────────────
    /** Entity type: "user" | "product" | "order" | "admin" | ... */
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Display label (name, email, sku, etc.) at time of action. */
    targetLabel: text("target_label"),

    // ── Diff & context ──────────────────────────────────────────────────────
    /**
     * Field-level changes: `{ field: { from: unknown, to: unknown } }`
     * or a free-form object for non-diff context.
     */
    changes: text("changes", { mode: "json" }).$type<
      Record<string, { from?: unknown; to?: unknown } | unknown>
    >(),
    /** Extra free-form metadata (request ids, counts, notes, etc.). */
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),

    // ── Request context (where) ─────────────────────────────────────────────
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    requestMethod: text("request_method"),
    requestPath: text("request_path"),

    // ── When ────────────────────────────────────────────────────────────────
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_actor_id_idx").on(table.actorId),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_category_idx").on(table.category),
    index("audit_logs_target_idx").on(table.targetType, table.targetId),
    index("audit_logs_severity_idx").on(table.severity),
    index("audit_logs_status_idx").on(table.status),
  ]
);
