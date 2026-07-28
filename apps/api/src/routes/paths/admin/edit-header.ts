import { Hono } from "hono";
import { and, asc, count, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { PERMISSIONS } from "@repo/auth/permissions";
import {
  headerCollectionItems,
  headerCollections,
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
const MAX_NAME_LENGTH = 80;
const MAX_SLUG_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_HREF_LENGTH = 512;
const MAX_IMAGE_LENGTH = 2048;
const MAX_ITEMS_PER_COLLECTION = 40;
const MAX_TOTAL_COLLECTIONS = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_SLUG_LENGTH);
}

function sanitizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

function sanitizeOptionalString(
  value: unknown,
  max: number
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

function sanitizeSlug(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const slug = slugify(value.trim());
  if (!slug || slug.length > MAX_SLUG_LENGTH) return null;
  return slug;
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

function sanitizeHref(value: unknown): string | null | undefined {
  const href = sanitizeOptionalString(value, MAX_HREF_LENGTH);
  if (href === undefined || href === null) return href;
  // Allow relative paths and absolute http(s) URLs only.
  if (href.startsWith("/") || /^https?:\/\//i.test(href)) return href;
  return undefined;
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

async function ensureUniqueCollectionSlug(
  db: Database,
  baseSlug: string,
  excludeId?: string
): Promise<string> {
  let candidate = baseSlug.slice(0, MAX_SLUG_LENGTH) || "collection";
  let attempt = 0;

  while (attempt < 50) {
    const [existing] = await db
      .select({ id: headerCollections.id })
      .from(headerCollections)
      .where(
        excludeId
          ? and(
              eq(headerCollections.slug, candidate),
              ne(headerCollections.id, excludeId)
            )
          : eq(headerCollections.slug, candidate)
      )
      .limit(1);

    if (!existing) return candidate;

    attempt += 1;
    const suffix = `-${attempt + 1}`;
    candidate = `${baseSlug.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
  }

  return `${baseSlug.slice(0, MAX_SLUG_LENGTH - 10)}-${nanoid(8)}`;
}

async function ensureUniqueItemSlug(
  db: Database,
  collectionId: string,
  baseSlug: string,
  excludeId?: string
): Promise<string> {
  let candidate = baseSlug.slice(0, MAX_SLUG_LENGTH) || "item";
  let attempt = 0;

  while (attempt < 50) {
    const [existing] = await db
      .select({ id: headerCollectionItems.id })
      .from(headerCollectionItems)
      .where(
        excludeId
          ? and(
              eq(headerCollectionItems.collectionId, collectionId),
              eq(headerCollectionItems.slug, candidate),
              ne(headerCollectionItems.id, excludeId)
            )
          : and(
              eq(headerCollectionItems.collectionId, collectionId),
              eq(headerCollectionItems.slug, candidate)
            )
      )
      .limit(1);

    if (!existing) return candidate;

    attempt += 1;
    const suffix = `-${attempt + 1}`;
    candidate = `${baseSlug.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
  }

  return `${baseSlug.slice(0, MAX_SLUG_LENGTH - 10)}-${nanoid(8)}`;
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

async function countItemsInCollection(
  db: Database,
  collectionId: string
): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(headerCollectionItems)
    .where(eq(headerCollectionItems.collectionId, collectionId));
  return Number(result?.value ?? 0);
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

function serializeCollectionRow(row: HeaderCollection) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    href: row.href,
    description: row.description,
    image: row.image,
    position: row.position,
    isVisible: row.isVisible,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeItemRow(row: HeaderCollectionItem) {
  return {
    id: row.id,
    collectionId: row.collectionId,
    name: row.name,
    slug: row.slug,
    href: row.href,
    description: row.description,
    image: row.image,
    position: row.position,
    isVisible: row.isVisible,
    featured: row.featured,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

const editHeader = new Hono<AppEnv>();

editHeader.use("*", requireAdminMiddleware);

// ─── GET / — full header tree (any admin can view) ────────────────────────────
editHeader.get("/", async (c) => {
  const actor = getActor(c);
  const db = getDb(c);

  try {
    const collections = await loadAdminHeaderFromDb(db);
    const canUpdate = await resolveCanUpdate(db, actor.id, actor.role);
    const visibleCount = collections.filter((col) => col.isVisible).length;

    return c.json({
      success: true,
      data: collections,
      meta: {
        totalCollections: collections.length,
        visibleCollections: visibleCount,
        maxVisibleCollections: MAX_VISIBLE_HEADER_COLLECTIONS,
        maxTotalCollections: MAX_TOTAL_COLLECTIONS,
        maxItemsPerCollection: MAX_ITEMS_PER_COLLECTION,
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

// ─── POST /collections — create collection ────────────────────────────────────
editHeader.post(
  "/collections",
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    const name = sanitizeName(body.name);
    if (!name) {
      return errorJson(
        c,
        400,
        "INVALID_NAME",
        `Name is required (1–${MAX_NAME_LENGTH} characters).`
      );
    }

    let slug =
      sanitizeSlug(body.slug) ??
      (typeof body.slug === "undefined" ? slugify(name) : null);
    if (!slug) {
      return errorJson(
        c,
        400,
        "INVALID_SLUG",
        "Slug must contain letters or numbers."
      );
    }

    const description = sanitizeOptionalString(
      body.description,
      MAX_DESCRIPTION_LENGTH
    );
    if (description === undefined && body.description !== undefined) {
      return errorJson(
        c,
        400,
        "INVALID_DESCRIPTION",
        `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
      );
    }

    const image = sanitizeOptionalString(body.image, MAX_IMAGE_LENGTH);
    if (image === undefined && body.image !== undefined) {
      return errorJson(
        c,
        400,
        "INVALID_IMAGE",
        `Image URL must be at most ${MAX_IMAGE_LENGTH} characters.`
      );
    }

    const href = sanitizeHref(body.href);
    if (href === undefined && body.href !== undefined) {
      return errorJson(
        c,
        400,
        "INVALID_HREF",
        "Href must be a relative path (starting with /) or an http(s) URL."
      );
    }

    const isVisible = sanitizeBoolean(body.isVisible) ?? true;
    const position = sanitizePosition(body.position) ?? 0;

    try {
      const total = await countAllCollections(db);
      if (total >= MAX_TOTAL_COLLECTIONS) {
        return errorJson(
          c,
          400,
          "MAX_COLLECTIONS",
          `You can have at most ${MAX_TOTAL_COLLECTIONS} header collections.`
        );
      }

      if (isVisible) {
        const visible = await countVisibleCollections(db);
        if (visible >= MAX_VISIBLE_HEADER_COLLECTIONS) {
          return errorJson(
            c,
            400,
            "MAX_VISIBLE",
            `At most ${MAX_VISIBLE_HEADER_COLLECTIONS} collections can be visible in the navbar. Hide another collection first, or create this one as hidden.`
          );
        }
      }

      slug = await ensureUniqueCollectionSlug(db, slug);
      const now = new Date();
      const id = nanoid();

      const [created] = await db
        .insert(headerCollections)
        .values({
          id,
          name,
          slug,
          href: href ?? null,
          description: description ?? null,
          image: image ?? null,
          position,
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
          description: `Created header collection "${created.name}"`,
          targetType: AUDIT_TARGET_TYPES.HEADER_COLLECTION,
          targetId: created.id,
          targetLabel: created.name,
          severity: "info",
          changes: {
            name: { to: created.name },
            slug: { to: created.slug },
            isVisible: { to: created.isVisible },
            position: { to: created.position },
          },
          metadata: { kind: "header_collection" },
        }).then(() => undefined)
      );

      return c.json(
        {
          success: true,
          message: `Collection "${created.name}" created.`,
          data: serializeCollectionRow(created),
        },
        201
      );
    } catch (error) {
      console.error("Error creating header collection:", error);
      return errorJson(
        c,
        500,
        "INTERNAL_ERROR",
        "Failed to create header collection."
      );
    }
  }
);

// ─── PATCH /collections/:id — update collection ───────────────────────────────
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
          "Header collection not found."
        );
      }

      const updates: Partial<HeaderCollection> = {
        updatedAt: new Date(),
      };
      const changes: Record<string, { from?: unknown; to?: unknown }> = {};

      if (body.name !== undefined) {
        const name = sanitizeName(body.name);
        if (!name) {
          return errorJson(
            c,
            400,
            "INVALID_NAME",
            `Name is required (1–${MAX_NAME_LENGTH} characters).`
          );
        }
        if (name !== existing.name) {
          updates.name = name;
          changes.name = { from: existing.name, to: name };
        }
      }

      if (body.slug !== undefined) {
        const slug = sanitizeSlug(body.slug);
        if (!slug) {
          return errorJson(
            c,
            400,
            "INVALID_SLUG",
            "Slug must contain letters or numbers."
          );
        }
        const uniqueSlug = await ensureUniqueCollectionSlug(db, slug, id);
        if (uniqueSlug !== existing.slug) {
          updates.slug = uniqueSlug;
          changes.slug = { from: existing.slug, to: uniqueSlug };
        }
      }

      if (body.description !== undefined) {
        const description = sanitizeOptionalString(
          body.description,
          MAX_DESCRIPTION_LENGTH
        );
        if (description === undefined) {
          return errorJson(
            c,
            400,
            "INVALID_DESCRIPTION",
            `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
          );
        }
        if (description !== existing.description) {
          updates.description = description;
          changes.description = {
            from: existing.description,
            to: description,
          };
        }
      }

      if (body.image !== undefined) {
        const image = sanitizeOptionalString(body.image, MAX_IMAGE_LENGTH);
        if (image === undefined) {
          return errorJson(
            c,
            400,
            "INVALID_IMAGE",
            `Image URL must be at most ${MAX_IMAGE_LENGTH} characters.`
          );
        }
        if (image !== existing.image) {
          updates.image = image;
          changes.image = { from: existing.image, to: image };
        }
      }

      if (body.href !== undefined) {
        const href = sanitizeHref(body.href);
        if (href === undefined) {
          return errorJson(
            c,
            400,
            "INVALID_HREF",
            "Href must be a relative path (starting with /) or an http(s) URL."
          );
        }
        if (href !== existing.href) {
          updates.href = href;
          changes.href = { from: existing.href, to: href };
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
                `At most ${MAX_VISIBLE_HEADER_COLLECTIONS} collections can be visible in the navbar.`
              );
            }
          }
          updates.isVisible = isVisible;
          changes.isVisible = { from: existing.isVisible, to: isVisible };
        }
      }

      if (Object.keys(changes).length === 0) {
        return c.json({
          success: true,
          message: "No changes detected.",
          data: serializeCollectionRow(existing),
        });
      }

      const [updated] = await db
        .update(headerCollections)
        .set(updates)
        .where(eq(headerCollections.id, id))
        .returning();

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_UPDATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Updated header collection "${updated.name}"`,
          targetType: AUDIT_TARGET_TYPES.HEADER_COLLECTION,
          targetId: updated.id,
          targetLabel: updated.name,
          severity: "info",
          changes,
          metadata: { kind: "header_collection" },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `Collection "${updated.name}" updated.`,
        data: serializeCollectionRow(updated),
      });
    } catch (error) {
      console.error("Error updating header collection:", error);
      return errorJson(
        c,
        500,
        "INTERNAL_ERROR",
        "Failed to update header collection."
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
          "Header collection not found."
        );
      }

      // Cascade deletes items via FK.
      await db
        .delete(headerCollections)
        .where(eq(headerCollections.id, id));

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_DELETE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Deleted header collection "${existing.name}"`,
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
        message: `Collection "${existing.name}" deleted.`,
      });
    } catch (error) {
      console.error("Error deleting header collection:", error);
      return errorJson(
        c,
        500,
        "INTERNAL_ERROR",
        "Failed to delete header collection."
      );
    }
  }
);

// ─── POST /collections/:id/items — create item ────────────────────────────────
editHeader.post(
  "/collections/:id/items",
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);
    const collectionId = c.req.param("id")?.trim() ?? "";

    if (!isValidId(collectionId)) {
      return errorJson(c, 400, "INVALID_ID", "Invalid collection id.");
    }

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    const name = sanitizeName(body.name);
    if (!name) {
      return errorJson(
        c,
        400,
        "INVALID_NAME",
        `Name is required (1–${MAX_NAME_LENGTH} characters).`
      );
    }

    let slug =
      sanitizeSlug(body.slug) ??
      (typeof body.slug === "undefined" ? slugify(name) : null);
    if (!slug) {
      return errorJson(
        c,
        400,
        "INVALID_SLUG",
        "Slug must contain letters or numbers."
      );
    }

    const description = sanitizeOptionalString(
      body.description,
      MAX_DESCRIPTION_LENGTH
    );
    if (description === undefined && body.description !== undefined) {
      return errorJson(
        c,
        400,
        "INVALID_DESCRIPTION",
        `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
      );
    }

    const image = sanitizeOptionalString(body.image, MAX_IMAGE_LENGTH);
    if (image === undefined && body.image !== undefined) {
      return errorJson(
        c,
        400,
        "INVALID_IMAGE",
        `Image URL must be at most ${MAX_IMAGE_LENGTH} characters.`
      );
    }

    const href = sanitizeHref(body.href);
    if (href === undefined && body.href !== undefined) {
      return errorJson(
        c,
        400,
        "INVALID_HREF",
        "Href must be a relative path (starting with /) or an http(s) URL."
      );
    }

    const isVisible = sanitizeBoolean(body.isVisible) ?? true;
    const featured = sanitizeBoolean(body.featured) ?? false;
    const position = sanitizePosition(body.position) ?? 0;

    try {
      const [collection] = await db
        .select()
        .from(headerCollections)
        .where(eq(headerCollections.id, collectionId))
        .limit(1);

      if (!collection) {
        return errorJson(
          c,
          404,
          "COLLECTION_NOT_FOUND",
          "Header collection not found."
        );
      }

      const itemCount = await countItemsInCollection(db, collectionId);
      if (itemCount >= MAX_ITEMS_PER_COLLECTION) {
        return errorJson(
          c,
          400,
          "MAX_ITEMS",
          `A collection can have at most ${MAX_ITEMS_PER_COLLECTION} items.`
        );
      }

      slug = await ensureUniqueItemSlug(db, collectionId, slug);
      const now = new Date();
      const id = nanoid();

      const [created] = await db
        .insert(headerCollectionItems)
        .values({
          id,
          collectionId,
          name,
          slug,
          href: href ?? null,
          description: description ?? null,
          image: image ?? null,
          position,
          isVisible,
          featured,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_CREATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Created header item "${created.name}" under "${collection.name}"`,
          targetType: AUDIT_TARGET_TYPES.HEADER_ITEM,
          targetId: created.id,
          targetLabel: created.name,
          severity: "info",
          changes: {
            name: { to: created.name },
            slug: { to: created.slug },
            collectionId: { to: collectionId },
          },
          metadata: {
            kind: "header_collection_item",
            collectionId,
            collectionName: collection.name,
          },
        }).then(() => undefined)
      );

      return c.json(
        {
          success: true,
          message: `Item "${created.name}" created.`,
          data: serializeItemRow(created),
        },
        201
      );
    } catch (error) {
      console.error("Error creating header item:", error);
      return errorJson(
        c,
        500,
        "INTERNAL_ERROR",
        "Failed to create header item."
      );
    }
  }
);

// ─── PATCH /items/:id — update item ───────────────────────────────────────────
editHeader.patch(
  "/items/:id",
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param("id")?.trim() ?? "";

    if (!isValidId(id)) {
      return errorJson(c, 400, "INVALID_ID", "Invalid item id.");
    }

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    try {
      const [existing] = await db
        .select()
        .from(headerCollectionItems)
        .where(eq(headerCollectionItems.id, id))
        .limit(1);

      if (!existing) {
        return errorJson(c, 404, "ITEM_NOT_FOUND", "Header item not found.");
      }

      const updates: Partial<HeaderCollectionItem> = {
        updatedAt: new Date(),
      };
      const changes: Record<string, { from?: unknown; to?: unknown }> = {};

      if (body.name !== undefined) {
        const name = sanitizeName(body.name);
        if (!name) {
          return errorJson(
            c,
            400,
            "INVALID_NAME",
            `Name is required (1–${MAX_NAME_LENGTH} characters).`
          );
        }
        if (name !== existing.name) {
          updates.name = name;
          changes.name = { from: existing.name, to: name };
        }
      }

      if (body.slug !== undefined) {
        const slug = sanitizeSlug(body.slug);
        if (!slug) {
          return errorJson(
            c,
            400,
            "INVALID_SLUG",
            "Slug must contain letters or numbers."
          );
        }
        const uniqueSlug = await ensureUniqueItemSlug(
          db,
          existing.collectionId,
          slug,
          id
        );
        if (uniqueSlug !== existing.slug) {
          updates.slug = uniqueSlug;
          changes.slug = { from: existing.slug, to: uniqueSlug };
        }
      }

      if (body.description !== undefined) {
        const description = sanitizeOptionalString(
          body.description,
          MAX_DESCRIPTION_LENGTH
        );
        if (description === undefined) {
          return errorJson(
            c,
            400,
            "INVALID_DESCRIPTION",
            `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
          );
        }
        if (description !== existing.description) {
          updates.description = description;
          changes.description = {
            from: existing.description,
            to: description,
          };
        }
      }

      if (body.image !== undefined) {
        const image = sanitizeOptionalString(body.image, MAX_IMAGE_LENGTH);
        if (image === undefined) {
          return errorJson(
            c,
            400,
            "INVALID_IMAGE",
            `Image URL must be at most ${MAX_IMAGE_LENGTH} characters.`
          );
        }
        if (image !== existing.image) {
          updates.image = image;
          changes.image = { from: existing.image, to: image };
        }
      }

      if (body.href !== undefined) {
        const href = sanitizeHref(body.href);
        if (href === undefined) {
          return errorJson(
            c,
            400,
            "INVALID_HREF",
            "Href must be a relative path (starting with /) or an http(s) URL."
          );
        }
        if (href !== existing.href) {
          updates.href = href;
          changes.href = { from: existing.href, to: href };
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
          updates.isVisible = isVisible;
          changes.isVisible = { from: existing.isVisible, to: isVisible };
        }
      }

      if (body.featured !== undefined) {
        const featured = sanitizeBoolean(body.featured);
        if (featured === undefined) {
          return errorJson(
            c,
            400,
            "INVALID_FEATURED",
            "featured must be a boolean."
          );
        }
        if (featured !== existing.featured) {
          updates.featured = featured;
          changes.featured = { from: existing.featured, to: featured };
        }
      }

      if (Object.keys(changes).length === 0) {
        return c.json({
          success: true,
          message: "No changes detected.",
          data: serializeItemRow(existing),
        });
      }

      const [updated] = await db
        .update(headerCollectionItems)
        .set(updates)
        .where(eq(headerCollectionItems.id, id))
        .returning();

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_UPDATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Updated header item "${updated.name}"`,
          targetType: AUDIT_TARGET_TYPES.HEADER_ITEM,
          targetId: updated.id,
          targetLabel: updated.name,
          severity: "info",
          changes,
          metadata: {
            kind: "header_collection_item",
            collectionId: updated.collectionId,
          },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `Item "${updated.name}" updated.`,
        data: serializeItemRow(updated),
      });
    } catch (error) {
      console.error("Error updating header item:", error);
      return errorJson(
        c,
        500,
        "INTERNAL_ERROR",
        "Failed to update header item."
      );
    }
  }
);

// ─── DELETE /items/:id ────────────────────────────────────────────────────────
editHeader.delete(
  "/items/:id",
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param("id")?.trim() ?? "";

    if (!isValidId(id)) {
      return errorJson(c, 400, "INVALID_ID", "Invalid item id.");
    }

    try {
      const [existing] = await db
        .select()
        .from(headerCollectionItems)
        .where(eq(headerCollectionItems.id, id))
        .limit(1);

      if (!existing) {
        return errorJson(c, 404, "ITEM_NOT_FOUND", "Header item not found.");
      }

      await db
        .delete(headerCollectionItems)
        .where(eq(headerCollectionItems.id, id));

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_DELETE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Deleted header item "${existing.name}"`,
          targetType: AUDIT_TARGET_TYPES.HEADER_ITEM,
          targetId: existing.id,
          targetLabel: existing.name,
          severity: "warning",
          changes: {
            name: { from: existing.name },
            slug: { from: existing.slug },
          },
          metadata: {
            kind: "header_collection_item",
            collectionId: existing.collectionId,
          },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `Item "${existing.name}" deleted.`,
      });
    } catch (error) {
      console.error("Error deleting header item:", error);
      return errorJson(
        c,
        500,
        "INTERNAL_ERROR",
        "Failed to delete header item."
      );
    }
  }
);

// ─── PUT /reorder — batch reorder collections and/or items ────────────────────
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
    const itemOrder = Array.isArray(body.items)
      ? (body.items as unknown[])
      : null;

    if (!collectionOrder && !itemOrder) {
      return errorJson(
        c,
        400,
        "INVALID_BODY",
        "Provide `collections` and/or `items` arrays of { id, position }."
      );
    }

    try {
      const now = new Date();
      let updatedCollections = 0;
      let updatedItems = 0;

      if (collectionOrder) {
        for (const entry of collectionOrder) {
          if (
            entry === null ||
            typeof entry !== "object" ||
            Array.isArray(entry)
          ) {
            continue;
          }
          const row = entry as Record<string, unknown>;
          const id =
            typeof row.id === "string" ? row.id.trim() : "";
          const position = sanitizePosition(row.position);
          if (!isValidId(id) || position === undefined) continue;

          const result = await db
            .update(headerCollections)
            .set({ position, updatedAt: now })
            .where(eq(headerCollections.id, id))
            .returning({ id: headerCollections.id });

          if (result.length > 0) updatedCollections += 1;
        }
      }

      if (itemOrder) {
        for (const entry of itemOrder) {
          if (
            entry === null ||
            typeof entry !== "object" ||
            Array.isArray(entry)
          ) {
            continue;
          }
          const row = entry as Record<string, unknown>;
          const id =
            typeof row.id === "string" ? row.id.trim() : "";
          const position = sanitizePosition(row.position);
          if (!isValidId(id) || position === undefined) continue;

          const result = await db
            .update(headerCollectionItems)
            .set({ position, updatedAt: now })
            .where(eq(headerCollectionItems.id, id))
            .returning({ id: headerCollectionItems.id });

          if (result.length > 0) updatedItems += 1;
        }
      }

      if (updatedCollections + updatedItems > 0) {
        await bustCache(c);

        c.executionCtx.waitUntil(
          logAuditFromContext(c, {
            action: AUDIT_ACTIONS.HEADER_UPDATE,
            category: AUDIT_CATEGORIES.HEADER,
            description: `Reordered header nav (${updatedCollections} collections, ${updatedItems} items)`,
            targetType: AUDIT_TARGET_TYPES.SYSTEM,
            targetLabel: "header",
            severity: "info",
            metadata: {
              kind: "header_reorder",
              updatedCollections,
              updatedItems,
            },
          }).then(() => undefined)
        );
      }

      const collections = await loadAdminHeaderFromDb(db);

      return c.json({
        success: true,
        message: "Header order updated.",
        data: collections,
        meta: { updatedCollections, updatedItems },
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

export default editHeader;
export type { HeaderAdminCollection };
