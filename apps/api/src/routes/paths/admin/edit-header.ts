import { Hono } from "hono";
import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { PERMISSIONS } from "@repo/auth/permissions";
import {
  categories,
  headerCollectionItems,
  headerCollections,
  type Category,
  type Database,
  type HeaderCollection,
  type HeaderCollectionItem,
} from "@repo/db";
import {
  errorJson,
  type AppEnv,
  type AppContext,
} from "@/utils/errorJson";
import {
  requireAdminMiddleware,
  requirePermission,
  getActor,
  getDb,
} from "@/middleware/permission";
import { adminHasPermission } from "@/utils/permissions";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  logAuditFromContext,
} from "@/utils/auditLog";
import {
  invalidateHeaderNavCache,
  loadAdminHeaderFromDb,
  MAX_VISIBLE_HEADER_COLLECTIONS,
  type HeaderAdminCollection,
} from "@/utils/headerNav";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ID_LENGTH = 128;
const MAX_TOTAL_COLLECTIONS = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function categoryHref(slug: string): string {
  return `/category/${slug}`;
}

function sanitizeCategoryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return isValidId(id) ? id : null;
}

function sanitizePosition(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1_000_000, Math.floor(value)));
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = parseInt(value, 10);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1_000_000, n));
  }
  return undefined;
}

function sanitizeBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === 0 || value === "0" || value === "false") return false;
  if (value === 1 || value === "1" || value === "true") return true;
  return undefined;
}

async function getCategoryById(
  db: Database,
  categoryId: string
): Promise<Category | null> {
  const [category] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  return category ?? null;
}

async function getHeaderCollectionBySlug(
  db: Database,
  slug: string,
  excludeId?: string
): Promise<{ id: string } | null> {
  const [existing] = await db
    .select({ id: headerCollections.id })
    .from(headerCollections)
    .where(
      excludeId
        ? and(eq(headerCollections.slug, slug), ne(headerCollections.id, excludeId))
        : eq(headerCollections.slug, slug)
    )
    .limit(1);
  return existing ?? null;
}

async function readJsonObject(
  c: AppContext
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return {
      ok: false,
      response: errorJson(
        c,
        400,
        "INVALID_BODY",
        "Request body must be valid JSON."
      ),
    };
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      response: errorJson(
        c,
        400,
        "INVALID_BODY",
        "Request body must be a JSON object."
      ),
    };
  }

  return { ok: true, body: body as Record<string, unknown> };
}

async function countVisibleCollections(
  db: Database,
  excludeId?: string
): Promise<number> {
  const rows = await db
    .select({ id: headerCollections.id })
    .from(headerCollections)
    .where(eq(headerCollections.isVisible, true));

  if (!excludeId) return rows.length;
  return rows.filter((r) => r.id !== excludeId).length;
}

async function countAllCollections(db: Database): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(headerCollections);
  return Number(result?.value ?? 0);
}

async function resolveCanUpdate(
  db: Database,
  actorId: string,
  role: string
): Promise<boolean> {
  if (role === "owner") return true;
  return adminHasPermission(db, actorId, PERMISSIONS.HEADER_UPDATE);
}

async function bustCache(c: AppContext) {
  c.executionCtx.waitUntil(
    invalidateHeaderNavCache(c.env.KV).then(() => undefined)
  );
}

/**
 * Root categories that can still be added to the header (not already present).
 */
async function loadAvailableRootCategories(
  db: Database,
  usedSlugs: Set<string>
): Promise<
  Array<{
    id: string;
    name: string;
    slug: string;
    image: string | null;
    position: number;
    childCount: number;
  }>
> {
  const roots = await db
    .select()
    .from(categories)
    .where(isNull(categories.parentId))
    .orderBy(asc(categories.position), asc(categories.name));

  const allChildren = await db
    .select({
      parentId: categories.parentId,
    })
    .from(categories);

  const childCountByParent = new Map<string, number>();
  for (const row of allChildren) {
    if (!row.parentId) continue;
    childCountByParent.set(
      row.parentId,
      (childCountByParent.get(row.parentId) ?? 0) + 1
    );
  }

  return roots
    .filter((root) => !usedSlugs.has(root.slug))
    .map((root) => ({
      id: root.id,
      name: root.name,
      slug: root.slug,
      image: root.image,
      position: root.position,
      childCount: childCountByParent.get(root.id) ?? 0,
    }));
}

function serializeCollectionRow(
  row: HeaderCollection,
  categoryId: string | null = null
) {
  return {
    id: row.id,
    categoryId,
    name: row.name,
    slug: row.slug,
    href: categoryHref(row.slug),
    position: row.position,
    isVisible: row.isVisible,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

const editHeader = new Hono<AppEnv>();

editHeader.use("*", requireAdminMiddleware);

// ─── GET / — full header tree + available root categories ─────────────────────
editHeader.get("/", async (c) => {
  const actor = getActor(c);
  const db = getDb(c);

  try {
    const collections = await loadAdminHeaderFromDb(db);
    const canUpdate = await resolveCanUpdate(db, actor.id, actor.role);
    const visibleCount = collections.filter((col) => col.isVisible).length;
    const usedSlugs = new Set(collections.map((col) => col.slug));
    const availableCategories = await loadAvailableRootCategories(db, usedSlugs);

    return c.json({
      success: true,
      data: collections,
      availableCategories,
      meta: {
        totalCollections: collections.length,
        visibleCollections: visibleCount,
        maxVisibleCollections: MAX_VISIBLE_HEADER_COLLECTIONS,
        maxTotalCollections: MAX_TOTAL_COLLECTIONS,
        currentUserId: actor.id,
        currentUserRole: actor.role,
        canUpdate,
      },
    });
  } catch (error) {
    console.error("Error loading header for admin:", error);
    return errorJson(c, 500, "INTERNAL_ERROR", "Failed to load header.");
  }
});

// ─── POST /collections — add a root category to the header ────────────────────
editHeader.post(
  "/collections",
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    const categoryId = sanitizeCategoryId(body.categoryId);
    if (!categoryId) {
      return errorJson(
        c,
        400,
        "INVALID_CATEGORY_ID",
        "Select an existing category to add to the header."
      );
    }

    const category = await getCategoryById(db, categoryId);
    if (!category) {
      return errorJson(
        c,
        404,
        "CATEGORY_NOT_FOUND",
        "Selected category was not found."
      );
    }

    if (category.parentId) {
      return errorJson(
        c,
        400,
        "NOT_ROOT_CATEGORY",
        "Only root categories can be added to the top header navigation."
      );
    }

    const isVisible = sanitizeBoolean(body.isVisible) ?? true;
    const position = sanitizePosition(body.position);

    try {
      const total = await countAllCollections(db);
      if (total >= MAX_TOTAL_COLLECTIONS) {
        return errorJson(
          c,
          400,
          "MAX_COLLECTIONS",
          `You can have at most ${MAX_TOTAL_COLLECTIONS} header categories.`
        );
      }

      if (isVisible) {
        const visible = await countVisibleCollections(db);
        if (visible >= MAX_VISIBLE_HEADER_COLLECTIONS) {
          return errorJson(
            c,
            400,
            "MAX_VISIBLE",
            `At most ${MAX_VISIBLE_HEADER_COLLECTIONS} categories can be visible in the navbar. Hide another one first, or add this as hidden.`
          );
        }
      }

      const existing = await getHeaderCollectionBySlug(db, category.slug);
      if (existing) {
        return errorJson(
          c,
          409,
          "CATEGORY_ALREADY_ADDED",
          "That category is already in the header."
        );
      }

      // Append to end when position not provided.
      let nextPosition = position;
      if (nextPosition === undefined) {
        const [maxRow] = await db
          .select({ position: headerCollections.position })
          .from(headerCollections)
          .orderBy(asc(headerCollections.position))
          .limit(1);

        // Prefer max position + 10 for stable ordering gaps.
        const all = await db
          .select({ position: headerCollections.position })
          .from(headerCollections);
        const maxPos =
          all.length === 0
            ? -10
            : Math.max(...all.map((row) => row.position));
        nextPosition = maxPos + 10;
        void maxRow;
      }

      const now = new Date();
      const id = nanoid();

      const [created] = await db
        .insert(headerCollections)
        .values({
          id,
          name: category.name,
          slug: category.slug,
          position: nextPosition,
          isVisible,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_CREATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Added category "${created.name}" to store header`,
          targetType: AUDIT_TARGET_TYPES.HEADER_COLLECTION,
          targetId: created.id,
          targetLabel: created.name,
          severity: "info",
          changes: {
            name: { to: created.name },
            slug: { to: created.slug },
            categoryId: { to: category.id },
            isVisible: { to: created.isVisible },
            position: { to: created.position },
          },
          metadata: {
            kind: "header_collection",
            categoryId: category.id,
          },
        }).then(() => undefined)
      );

      return c.json(
        {
          success: true,
          message: `"${created.name}" added to the header.`,
          data: serializeCollectionRow(created, category.id),
        },
        201
      );
    } catch (error) {
      console.error("Error creating header collection:", error);
      return errorJson(
        c,
        500,
        "INTERNAL_ERROR",
        "Failed to add category to the header."
      );
    }
  }
);

// ─── PATCH /collections/:id — visibility / category swap only ─────────────────
editHeader.patch(
  "/collections/:id",
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param("id")?.trim() ?? "";

    if (!isValidId(id)) {
      return errorJson(c, 400, "INVALID_ID", "Invalid collection id.");
    }

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    try {
      const [existing] = await db
        .select()
        .from(headerCollections)
        .where(eq(headerCollections.id, id))
        .limit(1);

      if (!existing) {
        return errorJson(
          c,
          404,
          "COLLECTION_NOT_FOUND",
          "Header category not found."
        );
      }

      const updates: Partial<HeaderCollection> = {
        updatedAt: new Date(),
      };
      const changes: Record<string, { from?: unknown; to?: unknown }> = {};
      let resolvedCategoryId: string | null = null;

      // Optional: swap to a different root category.
      if (body.categoryId !== undefined) {
        const categoryId = sanitizeCategoryId(body.categoryId);
        if (!categoryId) {
          return errorJson(c, 400, "INVALID_CATEGORY_ID", "Invalid category id.");
        }

        const category = await getCategoryById(db, categoryId);
        if (!category) {
          return errorJson(
            c,
            404,
            "CATEGORY_NOT_FOUND",
            "Selected category was not found."
          );
        }

        if (category.parentId) {
          return errorJson(
            c,
            400,
            "NOT_ROOT_CATEGORY",
            "Only root categories can be used in the top header navigation."
          );
        }

        const duplicate = await getHeaderCollectionBySlug(
          db,
          category.slug,
          id
        );
        if (duplicate) {
          return errorJson(
            c,
            409,
            "CATEGORY_ALREADY_ADDED",
            "That category is already in the header."
          );
        }

        resolvedCategoryId = category.id;

        const categoryUpdates: Partial<HeaderCollection> = {
          name: category.name,
          slug: category.slug,
        };

        for (const [key, value] of Object.entries(categoryUpdates) as Array<
          [keyof HeaderCollection, unknown]
        >) {
          if (value !== existing[key]) {
            (updates as Record<string, unknown>)[key] = value;
            changes[key] = { from: existing[key], to: value };
          }
        }
      }

      if (body.position !== undefined) {
        const position = sanitizePosition(body.position);
        if (position === undefined) {
          return errorJson(
            c,
            400,
            "INVALID_POSITION",
            "Position must be a non-negative integer."
          );
        }
        if (position !== existing.position) {
          updates.position = position;
          changes.position = { from: existing.position, to: position };
        }
      }

      if (body.isVisible !== undefined) {
        const isVisible = sanitizeBoolean(body.isVisible);
        if (isVisible === undefined) {
          return errorJson(
            c,
            400,
            "INVALID_VISIBLE",
            "isVisible must be a boolean."
          );
        }
        if (isVisible !== existing.isVisible) {
          if (isVisible) {
            const visible = await countVisibleCollections(db, id);
            if (visible >= MAX_VISIBLE_HEADER_COLLECTIONS) {
              return errorJson(
                c,
                400,
                "MAX_VISIBLE",
                `At most ${MAX_VISIBLE_HEADER_COLLECTIONS} categories can be visible in the navbar.`
              );
            }
          }
          updates.isVisible = isVisible;
          changes.isVisible = { from: existing.isVisible, to: isVisible };
        }
      }

      // Free-form name / slug / href / description are intentionally ignored.
      // Header entries always mirror the linked category.

      if (Object.keys(changes).length === 0) {
        // Resolve categoryId for response even when no-op.
        const [matched] = await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.slug, existing.slug))
          .limit(1);

        return c.json({
          success: true,
          message: "No changes detected.",
          data: serializeCollectionRow(existing, matched?.id ?? null),
        });
      }

      const [updated] = await db
        .update(headerCollections)
        .set(updates)
        .where(eq(headerCollections.id, id))
        .returning();

      if (!resolvedCategoryId) {
        const [matched] = await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.slug, updated.slug))
          .limit(1);
        resolvedCategoryId = matched?.id ?? null;
      }

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_UPDATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Updated header category "${updated.name}"`,
          targetType: AUDIT_TARGET_TYPES.HEADER_COLLECTION,
          targetId: updated.id,
          targetLabel: updated.name,
          severity: "info",
          changes,
          metadata: {
            kind: "header_collection",
            categoryId: resolvedCategoryId,
          },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `Header category "${updated.name}" updated.`,
        data: serializeCollectionRow(updated, resolvedCategoryId),
      });
    } catch (error) {
      console.error("Error updating header collection:", error);
      return errorJson(
        c,
        500,
        "INTERNAL_ERROR",
        "Failed to update header category."
      );
    }
  }
);

// ─── DELETE /collections/:id ──────────────────────────────────────────────────
editHeader.delete(
  "/collections/:id",
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param("id")?.trim() ?? "";

    if (!isValidId(id)) {
      return errorJson(c, 400, "INVALID_ID", "Invalid collection id.");
    }

    try {
      const [existing] = await db
        .select()
        .from(headerCollections)
        .where(eq(headerCollections.id, id))
        .limit(1);

      if (!existing) {
        return errorJson(
          c,
          404,
          "COLLECTION_NOT_FOUND",
          "Header category not found."
        );
      }

      // Cascade deletes legacy header items via FK.
      await db.delete(headerCollections).where(eq(headerCollections.id, id));

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_DELETE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Removed category "${existing.name}" from store header`,
          targetType: AUDIT_TARGET_TYPES.HEADER_COLLECTION,
          targetId: existing.id,
          targetLabel: existing.name,
          severity: "warning",
          changes: {
            name: { from: existing.name },
            slug: { from: existing.slug },
          },
          metadata: { kind: "header_collection" },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `"${existing.name}" removed from the header.`,
      });
    } catch (error) {
      console.error("Error deleting header collection:", error);
      return errorJson(
        c,
        500,
        "INTERNAL_ERROR",
        "Failed to remove category from the header."
      );
    }
  }
);

// ─── PUT /reorder — batch reorder collections ─────────────────────────────────
editHeader.put(
  "/reorder",
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    const collectionOrder = Array.isArray(body.collections)
      ? (body.collections as unknown[])
      : null;

    if (!collectionOrder || collectionOrder.length === 0) {
      return errorJson(
        c,
        400,
        "INVALID_BODY",
        "Provide a non-empty `collections` array of { id, position }."
      );
    }

    try {
      const now = new Date();
      let updatedCollections = 0;
      const seen = new Set<string>();

      for (const entry of collectionOrder) {
        if (
          entry === null ||
          typeof entry !== "object" ||
          Array.isArray(entry)
        ) {
          continue;
        }
        const row = entry as Record<string, unknown>;
        const id = typeof row.id === "string" ? row.id.trim() : "";
        const position = sanitizePosition(row.position);
        if (!isValidId(id) || position === undefined) continue;
        if (seen.has(id)) continue;
        seen.add(id);

        const result = await db
          .update(headerCollections)
          .set({ position, updatedAt: now })
          .where(eq(headerCollections.id, id))
          .returning({ id: headerCollections.id });

        if (result.length > 0) updatedCollections += 1;
      }

      if (updatedCollections === 0) {
        return errorJson(
          c,
          400,
          "NOTHING_REORDERED",
          "No valid header categories were reordered."
        );
      }

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_UPDATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Reordered store header (${updatedCollections} categories)`,
          targetType: AUDIT_TARGET_TYPES.SYSTEM,
          targetLabel: "header",
          severity: "info",
          metadata: {
            kind: "header_reorder",
            updatedCollections,
          },
        }).then(() => undefined)
      );

      const collections = await loadAdminHeaderFromDb(db);

      return c.json({
        success: true,
        message: "Header order updated.",
        data: collections,
        meta: { updatedCollections },
      });
    } catch (error) {
      console.error("Error reordering header:", error);
      return errorJson(c, 500, "INTERNAL_ERROR", "Failed to reorder header.");
    }
  }
);

// ─── POST /invalidate-cache — force bust public nav cache ─────────────────────
editHeader.post(
  "/invalidate-cache",
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    try {
      await invalidateHeaderNavCache(c.env.KV);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_UPDATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: "Invalidated storefront header nav cache",
          targetType: AUDIT_TARGET_TYPES.SYSTEM,
          targetLabel: "header_cache",
          severity: "info",
          metadata: { kind: "header_cache_invalidate" },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: "Header navigation cache invalidated.",
      });
    } catch (error) {
      console.error("Error invalidating header cache:", error);
      return errorJson(
        c,
        500,
        "INTERNAL_ERROR",
        "Failed to invalidate header cache."
      );
    }
  }
);

// Keep unused type export for consumers; items table still exists for legacy rows.
export type { HeaderCollectionItem };

export default editHeader;
export type { HeaderAdminCollection };
