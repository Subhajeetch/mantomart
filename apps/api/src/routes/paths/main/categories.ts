import { Hono } from 'hono';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  categories,
  productCategories,
  products,
  type Database,
} from '@repo/db';
import {
  errorJson,
  type AppEnv,
  type AppContext,
} from '@/utils/errorJson';
import { adminHasPermission } from '@/utils/permissions';
import {
  requireAdminMiddleware,
  requireAnyPermission,
  getActor,
  getDb,
} from '@/middleware/permission';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  logAuditFromContext,
} from '@/utils/auditLog';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max nesting: root → L2 → L3 → L4. Depth 1 = root. */
export const MAX_CATEGORY_DEPTH = 4;

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 120;
const MAX_SLUG_LENGTH = 140;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_IMAGE_LENGTH = 2048;

// ─── Types ────────────────────────────────────────────────────────────────────

type CategoryRow = typeof categories.$inferSelect;

type CategoryNode = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  parentId: string | null;
  position: number;
  depth: number;
  createdAt: Date | string | number | null;
  updatedAt: Date | string | number | null;
  children: CategoryNode[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function serializeCategory(row: CategoryRow, depth = 1) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    image: row.image,
    parentId: row.parentId,
    position: row.position,
    depth,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_SLUG_LENGTH);
}

function sanitizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

function sanitizeOptionalString(
  value: unknown,
  max: number
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

function sanitizeSlug(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const slug = slugify(value.trim());
  if (!slug || slug.length > MAX_SLUG_LENGTH) return null;
  return slug;
}

function sanitizePosition(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1_000_000, Math.floor(value)));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = parseInt(value, 10);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1_000_000, n));
  }
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
        'INVALID_BODY',
        'Request body must be valid JSON.'
      ),
    };
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      response: errorJson(
        c,
        400,
        'INVALID_BODY',
        'Request body must be a JSON object.'
      ),
    };
  }

  return { ok: true, body: body as Record<string, unknown> };
}

async function resolveActorCapabilities(
  db: Database,
  actorId: string,
  role: string
) {
  if (role === 'owner') {
    return {
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canManage: true,
    };
  }

  const [canRead, canCreate, canUpdate, canDelete, canManage] =
    await Promise.all([
      adminHasPermission(db, actorId, PERMISSIONS.CATEGORY_TREE_READ),
      adminHasPermission(db, actorId, PERMISSIONS.CATEGORY_CREATE),
      adminHasPermission(db, actorId, PERMISSIONS.CATEGORY_UPDATE),
      adminHasPermission(db, actorId, PERMISSIONS.CATEGORY_DELETE),
      adminHasPermission(db, actorId, PERMISSIONS.CATEGORY_MANAGE),
    ]);

  return {
    canRead: canRead || canManage,
    canCreate: canCreate || canManage,
    canUpdate: canUpdate || canManage,
    canDelete: canDelete || canManage,
    canManage,
  };
}

/** Depth of a category: root = 1. Returns null if parent chain is broken. */
async function getCategoryDepth(
  db: Database,
  categoryId: string | null
): Promise<number | null> {
  if (!categoryId) return 0;

  let currentId: string | null = categoryId;
  let depth = 0;
  const seen = new Set<string>();

  while (currentId) {
    if (seen.has(currentId)) return null; // cycle
    seen.add(currentId);
    depth += 1;
    if (depth > MAX_CATEGORY_DEPTH + 2) return null;

    const [row]: Array<{ parentId: string | null } | undefined> = await db
      .select({ parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, currentId))
      .limit(1);

    if (!row) return null;
    currentId = row.parentId;
  }

  return depth;
}

/** Max depth of the subtree rooted at categoryId (inclusive). */
async function getSubtreeMaxDepth(
  db: Database,
  categoryId: string,
  allRows?: CategoryRow[]
): Promise<number> {
  const rows =
    allRows ??
    (await db.select().from(categories).orderBy(asc(categories.position)));

  const childrenMap = new Map<string | null, CategoryRow[]>();
  for (const row of rows) {
    const key = row.parentId ?? null;
    const list = childrenMap.get(key) ?? [];
    list.push(row);
    childrenMap.set(key, list);
  }

  function walk(id: string, depth: number): number {
    let max = depth;
    const kids = childrenMap.get(id) ?? [];
    for (const child of kids) {
      max = Math.max(max, walk(child.id, depth + 1));
    }
    return max;
  }

  return walk(categoryId, 1);
}

async function ensureUniqueSlug(
  db: Database,
  baseSlug: string,
  excludeId?: string
): Promise<string> {
  let candidate = baseSlug.slice(0, MAX_SLUG_LENGTH) || 'category';
  let attempt = 0;

  while (attempt < 50) {
    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        excludeId
          ? and(eq(categories.slug, candidate), ne(categories.id, excludeId))
          : eq(categories.slug, candidate)
      )
      .limit(1);

    if (!existing) return candidate;

    attempt += 1;
    const suffix = `-${attempt + 1}`;
    candidate = `${baseSlug.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
  }

  return `${baseSlug.slice(0, MAX_SLUG_LENGTH - 10)}-${nanoid(8)}`;
}

function buildTree(rows: CategoryRow[]): CategoryNode[] {
  const byParent = new Map<string | null, CategoryRow[]>();
  for (const row of rows) {
    const key = row.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }

  // Stable sibling order: position then name
  for (const list of byParent.values()) {
    list.sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.name.localeCompare(b.name);
    });
  }

  function build(parentId: string | null, depth: number): CategoryNode[] {
    if (depth > MAX_CATEGORY_DEPTH) return [];
    const children = byParent.get(parentId) ?? [];
    return children.map((row) => ({
      ...serializeCategory(row, depth),
      children: build(row.id, depth + 1),
    }));
  }

  return build(null, 1);
}

/**
 * Count products that would be left with zero categories if `categoryId`
 * were removed. Covers both junction rows and legacy products.category_id.
 *
 * Efficient: uses EXISTS / correlated counts only for products linked to
 * this category — not a full product table scan for stats.
 */
async function countSoleCategoryProducts(
  db: Database,
  categoryId: string
): Promise<number> {
  // Products linked via product_categories whose only join row is this category
  // (and no other category via junction OR a different legacy primary).
  const [junctionSole] = await db
    .select({ value: count() })
    .from(productCategories)
    .where(
      and(
        eq(productCategories.categoryId, categoryId),
        sql`(
          SELECT COUNT(*) FROM product_categories pc2
          WHERE pc2.product_id = ${productCategories.productId}
        ) = 1`,
        sql`NOT EXISTS (
          SELECT 1 FROM products p
          WHERE p.id = ${productCategories.productId}
            AND p.category_id IS NOT NULL
            AND p.category_id != ${categoryId}
        )`
      )
    );

  // Legacy: products.category_id = this category, no junction rows at all
  const [legacySole] = await db
    .select({ value: count() })
    .from(products)
    .where(
      and(
        eq(products.categoryId, categoryId),
        sql`NOT EXISTS (
          SELECT 1 FROM product_categories pc
          WHERE pc.product_id = ${products.id}
        )`
      )
    );

  return (
    Number(junctionSole?.value ?? 0) + Number(legacySole?.value ?? 0)
  );
}

/**
 * Count products currently linked to this category (junction or legacy primary).
 * Only used during delete confirmation — not on list/tree endpoints.
 */
async function countLinkedProducts(
  db: Database,
  categoryId: string
): Promise<number> {
  const [fromJunction] = await db
    .select({ value: count() })
    .from(productCategories)
    .where(eq(productCategories.categoryId, categoryId));

  // Legacy primaries that are NOT already counted via junction
  const [fromLegacyOnly] = await db
    .select({ value: count() })
    .from(products)
    .where(
      and(
        eq(products.categoryId, categoryId),
        sql`NOT EXISTS (
          SELECT 1 FROM product_categories pc
          WHERE pc.product_id = ${products.id}
            AND pc.category_id = ${categoryId}
        )`
      )
    );

  return (
    Number(fromJunction?.value ?? 0) + Number(fromLegacyOnly?.value ?? 0)
  );
}

async function countDirectChildren(
  db: Database,
  categoryId: string
): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(categories)
    .where(eq(categories.parentId, categoryId));
  return Number(result?.value ?? 0);
}

// ─── Router ───────────────────────────────────────────────────────────────────

const categoriesRouter = new Hono<AppEnv>();

categoriesRouter.use('*', requireAdminMiddleware);

// ─── GET /tree — hierarchical tree (no product counts) ────────────────────────
categoriesRouter.get(
  '/tree',
  requireAnyPermission(
    PERMISSIONS.CATEGORY_TREE_READ,
    PERMISSIONS.CATEGORY_MANAGE
  ),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);

    try {
      const rows = await db
        .select()
        .from(categories)
        .orderBy(asc(categories.position), asc(categories.name));

      const tree = buildTree(rows);
      const capabilities = await resolveActorCapabilities(
        db,
        actor.id,
        actor.role
      );

      return c.json({
        success: true,
        data: tree,
        meta: {
          total: rows.length,
          maxDepth: MAX_CATEGORY_DEPTH,
          currentUserId: actor.id,
          currentUserRole: actor.role,
          canCreate: capabilities.canCreate,
          canUpdate: capabilities.canUpdate,
          canDelete: capabilities.canDelete,
          canManage: capabilities.canManage,
        },
      });
    } catch (error) {
      console.error('Error loading category tree:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load categories.');
    }
  }
);

// ─── GET /all — flat list (no product counts) ─────────────────────────────────
categoriesRouter.get(
  '/all',
  requireAnyPermission(
    PERMISSIONS.CATEGORY_TREE_READ,
    PERMISSIONS.CATEGORY_MANAGE
  ),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);

    try {
      const rows = await db
        .select()
        .from(categories)
        .orderBy(asc(categories.position), asc(categories.name));

      // Compute depths in one pass
      const depthMap = new Map<string, number>();
      const byId = new Map(rows.map((r) => [r.id, r]));

      function depthOf(id: string): number {
        if (depthMap.has(id)) return depthMap.get(id)!;
        const row = byId.get(id);
        if (!row) return 1;
        if (!row.parentId) {
          depthMap.set(id, 1);
          return 1;
        }
        const d = depthOf(row.parentId) + 1;
        depthMap.set(id, d);
        return d;
      }

      const capabilities = await resolveActorCapabilities(
        db,
        actor.id,
        actor.role
      );

      return c.json({
        success: true,
        data: rows.map((row) => serializeCategory(row, depthOf(row.id))),
        meta: {
          total: rows.length,
          maxDepth: MAX_CATEGORY_DEPTH,
          currentUserId: actor.id,
          currentUserRole: actor.role,
          canCreate: capabilities.canCreate,
          canUpdate: capabilities.canUpdate,
          canDelete: capabilities.canDelete,
          canManage: capabilities.canManage,
        },
      });
    } catch (error) {
      console.error('Error listing categories:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load categories.');
    }
  }
);

// ─── GET /:id — single category ───────────────────────────────────────────────
categoriesRouter.get(
  '/:id',
  requireAnyPermission(
    PERMISSIONS.CATEGORY_TREE_READ,
    PERMISSIONS.CATEGORY_MANAGE
  ),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param('id')?.trim() ?? '';

    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid category id.');
    }

    try {
      const [row] = await db
        .select()
        .from(categories)
        .where(eq(categories.id, id))
        .limit(1);

      if (!row) {
        return errorJson(c, 404, 'CATEGORY_NOT_FOUND', 'Category not found.');
      }

      const depth = (await getCategoryDepth(db, id)) ?? 1;
      const childCount = await countDirectChildren(db, id);

      return c.json({
        success: true,
        data: {
          ...serializeCategory(row, depth),
          childCount,
          canAddChild: depth < MAX_CATEGORY_DEPTH,
        },
      });
    } catch (error) {
      console.error('Error fetching category:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load category.');
    }
  }
);

// ─── POST / — create category ─────────────────────────────────────────────────
categoriesRouter.post(
  '/',
  requireAnyPermission(
    PERMISSIONS.CATEGORY_CREATE,
    PERMISSIONS.CATEGORY_MANAGE
  ),
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
        'INVALID_NAME',
        `Name is required (1–${MAX_NAME_LENGTH} characters).`
      );
    }

    let slug =
      sanitizeSlug(body.slug) ??
      (typeof body.slug === 'undefined' ? slugify(name) : null);
    if (!slug) {
      return errorJson(
        c,
        400,
        'INVALID_SLUG',
        'Slug must contain letters or numbers.'
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
        'INVALID_DESCRIPTION',
        `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
      );
    }

    const image = sanitizeOptionalString(body.image, MAX_IMAGE_LENGTH);
    if (image === undefined && body.image !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_IMAGE',
        `Image URL must be at most ${MAX_IMAGE_LENGTH} characters.`
      );
    }

    let parentId: string | null = null;
    if (body.parentId !== undefined && body.parentId !== null) {
      if (typeof body.parentId !== 'string' || !isValidId(body.parentId.trim())) {
        return errorJson(c, 400, 'INVALID_PARENT', 'Invalid parent category id.');
      }
      parentId = body.parentId.trim();
    }

    const position = sanitizePosition(body.position) ?? 0;

    try {
      let depth = 1;

      if (parentId) {
        const [parent] = await db
          .select()
          .from(categories)
          .where(eq(categories.id, parentId))
          .limit(1);

        if (!parent) {
          return errorJson(
            c,
            404,
            'PARENT_NOT_FOUND',
            'Parent category not found.'
          );
        }

        const parentDepth = await getCategoryDepth(db, parentId);
        if (parentDepth === null) {
          return errorJson(
            c,
            400,
            'INVALID_PARENT',
            'Parent category has an invalid hierarchy.'
          );
        }

        depth = parentDepth + 1;
        if (depth > MAX_CATEGORY_DEPTH) {
          return errorJson(
            c,
            400,
            'MAX_DEPTH_EXCEEDED',
            `Categories can only be nested up to ${MAX_CATEGORY_DEPTH} levels (e.g. Fashion → Women → Accessories → Bags).`
          );
        }
      }

      slug = await ensureUniqueSlug(db, slug);
      const now = new Date();
      const id = nanoid();

      const [created] = await db
        .insert(categories)
        .values({
          id,
          name,
          slug,
          description: description ?? null,
          image: image ?? null,
          parentId,
          position,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.CATEGORY_CREATE,
          category: AUDIT_CATEGORIES.CATEGORY,
          description: parentId
            ? `Created category "${created.name}" under parent ${parentId}`
            : `Created root category "${created.name}"`,
          targetType: AUDIT_TARGET_TYPES.CATEGORY,
          targetId: created.id,
          targetLabel: created.name,
          severity: 'info',
          changes: {
            name: { to: created.name },
            slug: { to: created.slug },
            parentId: { to: created.parentId },
            position: { to: created.position },
          },
          metadata: { depth },
        }).then(() => undefined)
      );

      return c.json(
        {
          success: true,
          message: `Category "${created.name}" created.`,
          data: serializeCategory(created, depth),
        },
        201
      );
    } catch (error) {
      console.error('Error creating category:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to create category.');
    }
  }
);

// ─── PATCH /:id — update category ─────────────────────────────────────────────
categoriesRouter.patch(
  '/:id',
  requireAnyPermission(
    PERMISSIONS.CATEGORY_UPDATE,
    PERMISSIONS.CATEGORY_MANAGE
  ),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param('id')?.trim() ?? '';

    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid category id.');
    }

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    try {
      const [existing] = await db
        .select()
        .from(categories)
        .where(eq(categories.id, id))
        .limit(1);

      if (!existing) {
        return errorJson(c, 404, 'CATEGORY_NOT_FOUND', 'Category not found.');
      }

      const updates: Partial<CategoryRow> = {
        updatedAt: new Date(),
      };
      const changes: Record<string, { from?: unknown; to?: unknown }> = {};

      if (body.name !== undefined) {
        const name = sanitizeName(body.name);
        if (!name) {
          return errorJson(
            c,
            400,
            'INVALID_NAME',
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
            'INVALID_SLUG',
            'Slug must contain letters or numbers.'
          );
        }
        const uniqueSlug = await ensureUniqueSlug(db, slug, id);
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
            'INVALID_DESCRIPTION',
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
            'INVALID_IMAGE',
            `Image URL must be at most ${MAX_IMAGE_LENGTH} characters.`
          );
        }
        if (image !== existing.image) {
          updates.image = image;
          changes.image = { from: existing.image, to: image };
        }
      }

      if (body.position !== undefined) {
        const position = sanitizePosition(body.position);
        if (position === undefined) {
          return errorJson(
            c,
            400,
            'INVALID_POSITION',
            'Position must be a non-negative integer.'
          );
        }
        if (position !== existing.position) {
          updates.position = position;
          changes.position = { from: existing.position, to: position };
        }
      }

      // Parent move (optional)
      if (body.parentId !== undefined) {
        let newParentId: string | null = null;
        if (body.parentId !== null) {
          if (
            typeof body.parentId !== 'string' ||
            !isValidId(body.parentId.trim())
          ) {
            return errorJson(
              c,
              400,
              'INVALID_PARENT',
              'Invalid parent category id.'
            );
          }
          newParentId = body.parentId.trim();
        }

        if (newParentId === id) {
          return errorJson(
            c,
            400,
            'INVALID_PARENT',
            'A category cannot be its own parent.'
          );
        }

        if (newParentId !== existing.parentId) {
          if (newParentId) {
            const [parent] = await db
              .select()
              .from(categories)
              .where(eq(categories.id, newParentId))
              .limit(1);

            if (!parent) {
              return errorJson(
                c,
                404,
                'PARENT_NOT_FOUND',
                'Parent category not found.'
              );
            }

            // Prevent moving under own descendant
            let walk: string | null = newParentId;
            const seen = new Set<string>();
            while (walk) {
              if (walk === id) {
                return errorJson(
                  c,
                  400,
                  'INVALID_PARENT',
                  'Cannot move a category under one of its own descendants.'
                );
              }
              if (seen.has(walk)) break;
              seen.add(walk);
              const [p] = await db
                .select({ parentId: categories.parentId })
                .from(categories)
                .where(eq(categories.id, walk))
                .limit(1);
              walk = p?.parentId ?? null;
            }

            const parentDepth = await getCategoryDepth(db, newParentId);
            if (parentDepth === null) {
              return errorJson(
                c,
                400,
                'INVALID_PARENT',
                'Parent category has an invalid hierarchy.'
              );
            }

            const subtreeDepth = await getSubtreeMaxDepth(db, id);
            // After move: newDepthOfRoot = parentDepth + 1
            // Max absolute depth = parentDepth + subtreeDepth
            if (parentDepth + subtreeDepth > MAX_CATEGORY_DEPTH) {
              return errorJson(
                c,
                400,
                'MAX_DEPTH_EXCEEDED',
                `Moving this category would exceed the max nesting of ${MAX_CATEGORY_DEPTH} levels.`
              );
            }
          }

          updates.parentId = newParentId;
          changes.parentId = {
            from: existing.parentId,
            to: newParentId,
          };
        }
      }

      if (Object.keys(changes).length === 0) {
        const depth = (await getCategoryDepth(db, id)) ?? 1;
        return c.json({
          success: true,
          message: 'No changes detected.',
          data: serializeCategory(existing, depth),
        });
      }

      const [updated] = await db
        .update(categories)
        .set(updates)
        .where(eq(categories.id, id))
        .returning();

      const depth = (await getCategoryDepth(db, id)) ?? 1;

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.CATEGORY_UPDATE,
          category: AUDIT_CATEGORIES.CATEGORY,
          description: `Updated category "${updated.name}"`,
          targetType: AUDIT_TARGET_TYPES.CATEGORY,
          targetId: updated.id,
          targetLabel: updated.name,
          severity: 'info',
          changes,
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `Category "${updated.name}" updated.`,
        data: serializeCategory(updated, depth),
      });
    } catch (error) {
      console.error('Error updating category:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to update category.');
    }
  }
);

// ─── DELETE /:id — delete with sole-category protection ───────────────────────
// Body: { confirm?: boolean }
// - Blocks if category has children (delete children first)
// - Blocks if any product has ONLY this category
// - If products are linked but multi-categorized and confirm !== true → 409 CONFIRM_REQUIRED
// - On success: removes join rows (cascade), nulls legacy primary, deletes row
categoriesRouter.delete(
  '/:id',
  requireAnyPermission(
    PERMISSIONS.CATEGORY_DELETE,
    PERMISSIONS.CATEGORY_MANAGE
  ),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param('id')?.trim() ?? '';

    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid category id.');
    }

    let confirm = false;
    // Body is optional for DELETE
    try {
      const contentType = c.req.header('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const body = await c.req.json().catch(() => null);
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          confirm = (body as Record<string, unknown>).confirm === true;
        }
      }
    } catch {
      // ignore — treat as unconfirmed
    }

    // Also allow ?confirm=true for convenience
    if (c.req.query('confirm') === 'true') {
      confirm = true;
    }

    try {
      const [existing] = await db
        .select()
        .from(categories)
        .where(eq(categories.id, id))
        .limit(1);

      if (!existing) {
        return errorJson(c, 404, 'CATEGORY_NOT_FOUND', 'Category not found.');
      }

      const childCount = await countDirectChildren(db, id);
      if (childCount > 0) {
        return errorJson(
          c,
          409,
          'HAS_CHILDREN',
          `This category has ${childCount} subcategor${childCount === 1 ? 'y' : 'ies'}. Delete or move them first.`
        );
      }

      const soleCount = await countSoleCategoryProducts(db, id);
      const linkedCount = await countLinkedProducts(db, id);

      if (soleCount > 0) {
        return c.json(
          {
            success: false,
            error: `Cannot delete: ${soleCount} product${soleCount === 1 ? '' : 's'} ${soleCount === 1 ? 'has' : 'have'} only this category. Assign ${soleCount === 1 ? 'it' : 'them'} to another category first.`,
            code: 'HAS_SOLE_PRODUCTS',
            meta: {
              soleProductCount: soleCount,
              linkedProductCount: linkedCount,
            },
          },
          409
        );
      }

      // Never delete without explicit confirm — UI uses this as a safe preview.
      if (!confirm) {
        return c.json(
          {
            success: false,
            error:
              linkedCount > 0
                ? `${linkedCount} product${linkedCount === 1 ? '' : 's'} currently use this category. Confirm to remove the association and delete.`
                : 'Confirm to permanently delete this category.',
            code: 'CONFIRM_REQUIRED',
            meta: {
              soleProductCount: 0,
              linkedProductCount: linkedCount,
            },
          },
          409
        );
      }

      // Null legacy primary category references, remove join rows, delete category
      await db
        .update(products)
        .set({ categoryId: null, updatedAt: new Date() })
        .where(eq(products.categoryId, id));

      await db
        .delete(productCategories)
        .where(eq(productCategories.categoryId, id));

      const deleted = await db
        .delete(categories)
        .where(eq(categories.id, id))
        .returning();

      if (deleted.length === 0) {
        return errorJson(
          c,
          409,
          'CONFLICT',
          'Could not delete category. It may have changed — refresh and try again.'
        );
      }

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.CATEGORY_DELETE,
          category: AUDIT_CATEGORIES.CATEGORY,
          description: `Deleted category "${existing.name}"`,
          targetType: AUDIT_TARGET_TYPES.CATEGORY,
          targetId: existing.id,
          targetLabel: existing.name,
          severity: linkedCount > 0 ? 'warning' : 'info',
          changes: {
            deleted: { from: existing.name, to: null },
            parentId: { from: existing.parentId, to: null },
          },
          metadata: {
            linkedProductCount: linkedCount,
            slug: existing.slug,
          },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message:
          linkedCount > 0
            ? `Category "${existing.name}" deleted. Removed from ${linkedCount} product${linkedCount === 1 ? '' : 's'}.`
            : `Category "${existing.name}" deleted.`,
        data: { id: existing.id },
        meta: { linkedProductCount: linkedCount },
      });
    } catch (error) {
      console.error('Error deleting category:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to delete category.');
    }
  }
);

categoriesRouter.notFound((c) =>
  errorJson(c, 404, 'NOT_FOUND', 'Category API route not found.')
);

export default categoriesRouter;
