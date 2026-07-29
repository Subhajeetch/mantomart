import { Hono } from 'hono';
import { and, asc, count, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  categories,
  headerMenuNodes,
  type Category,
  type Database,
  type HeaderMenuNode,
} from '@repo/db';
import { errorJson, type AppEnv, type AppContext } from '@/utils/errorJson';
import {
  requireAdminMiddleware,
  requirePermission,
  getActor,
  getDb,
} from '@/middleware/permission';
import { adminHasPermission } from '@/utils/permissions';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  logAuditFromContext,
} from '@/utils/auditLog';
import {
  getNodeDepthFromMap,
  invalidateHeaderNavCache,
  loadAdminHeaderFromDb,
  MAX_HEADER_ITEM_DEPTH,
  MAX_VISIBLE_HEADER_COLLECTIONS,
  type HeaderAdminCollection,
} from '@/utils/headerNav';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ID_LENGTH = 128;
const MAX_TOTAL_COLLECTIONS = 20;
const MAX_ITEMS_PER_COLLECTION = 40;
const MAX_TITLE_LENGTH = 120;
const MAX_URL_LENGTH = 2048;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function categoryHref(slug: string): string {
  return `/category/${slug}`;
}

function slugifyFallback(input: string, fallback: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 140);
  return slug || fallback;
}

function sanitizeCategoryId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return isValidId(id) ? id : null;
}

function sanitizeTitle(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const title = value.trim().replace(/\s+/g, ' ');
  if (title.length === 0) return null;
  if (title.length > MAX_TITLE_LENGTH) return undefined;
  return title;
}

function sanitizeUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (url.length === 0) return null;
  if (url.length > MAX_URL_LENGTH) return undefined;
  if (!url.startsWith('/') && !/^https?:\/\//i.test(url)) return undefined;
  return url;
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

function sanitizeBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === '0' || value === 'false') return false;
  if (value === 1 || value === '1' || value === 'true') return true;
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

async function getCategoryBySlug(
  db: Database,
  slug: string
): Promise<Category | null> {
  const [category] = await db
    .select()
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  return category ?? null;
}

async function resolveCategoryFromBody(
  db: Database,
  body: Record<string, unknown>
): Promise<Category | null> {
  const categoryId = sanitizeCategoryId(body.categoryId);
  if (categoryId) return getCategoryById(db, categoryId);

  if (typeof body.slug === 'string') {
    const slug = body.slug.trim();
    if (slug) return getCategoryBySlug(db, slug);
  }

  return null;
}

async function getTopHeaderNodeByCategoryId(
  db: Database,
  categoryId: string,
  excludeId?: string
): Promise<{ id: string } | null> {
  const [existing] = await db
    .select({ id: headerMenuNodes.id })
    .from(headerMenuNodes)
    .where(
      excludeId
        ? and(
            isNull(headerMenuNodes.parentId),
            eq(headerMenuNodes.categoryId, categoryId),
            ne(headerMenuNodes.id, excludeId)
          )
        : and(
            isNull(headerMenuNodes.parentId),
            eq(headerMenuNodes.categoryId, categoryId)
          )
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

async function countVisibleCollections(
  db: Database,
  excludeId?: string
): Promise<number> {
  const rows = await db
    .select({ id: headerMenuNodes.id })
    .from(headerMenuNodes)
    .where(
      and(isNull(headerMenuNodes.parentId), eq(headerMenuNodes.isVisible, true))
    );

  if (!excludeId) return rows.length;
  return rows.filter((r) => r.id !== excludeId).length;
}

async function countAllCollections(db: Database): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(headerMenuNodes)
    .where(isNull(headerMenuNodes.parentId));
  return Number(result?.value ?? 0);
}

async function countDescendants(
  db: Database,
  rootId: string
): Promise<number> {
  const all = await db.select({ id: headerMenuNodes.id, parentId: headerMenuNodes.parentId }).from(headerMenuNodes);
  const childrenByParent = new Map<string, string[]>();
  for (const row of all) {
    if (!row.parentId) continue;
    const list = childrenByParent.get(row.parentId) ?? [];
    list.push(row.id);
    childrenByParent.set(row.parentId, list);
  }

  let total = 0;
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    total += 1;
    const kids = childrenByParent.get(id);
    if (kids) stack.push(...kids);
  }
  return total;
}

async function loadAllNodesMap(
  db: Database
): Promise<Map<string, HeaderMenuNode>> {
  const rows = await db.select().from(headerMenuNodes);
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Ensure `parentId` is the collection itself or a descendant of it.
 * Returns the parent node + depth of a *new child* under that parent.
 */
function resolveParentUnderCollection(
  collectionId: string,
  parentId: string,
  nodesById: Map<string, HeaderMenuNode>
):
  | { ok: true; parent: HeaderMenuNode; childDepth: number }
  | { ok: false; code: string; message: string } {
  const parent = nodesById.get(parentId);
  if (!parent) {
    return {
      ok: false,
      code: 'PARENT_NOT_FOUND',
      message: 'Parent menu node was not found.',
    };
  }

  // Confirm parent lives under this collection (or *is* the collection).
  let cursor: HeaderMenuNode | undefined = parent;
  const seen = new Set<string>();

  while (cursor) {
    if (seen.has(cursor.id)) {
      return {
        ok: false,
        code: 'INVALID_PARENT',
        message: 'Parent menu chain is invalid.',
      };
    }
    seen.add(cursor.id);

    if (cursor.id === collectionId) {
      const parentDepth = getNodeDepthFromMap(parentId, nodesById);
      if (parentDepth === null) {
        return {
          ok: false,
          code: 'INVALID_PARENT',
          message: 'Parent menu chain is invalid.',
        };
      }
      // parentDepth 0 = root tab → child depth 1 (subcategory)
      const depth = parentDepth + 1;
      if (depth > MAX_HEADER_ITEM_DEPTH) {
        return {
          ok: false,
          code: 'MAX_DEPTH',
          message: `Header menu supports at most ${MAX_HEADER_ITEM_DEPTH} levels under a tab (subcategory → sub-subcategory).`,
        };
      }
      return { ok: true, parent, childDepth: depth };
    }

    if (cursor.parentId === null) {
      return {
        ok: false,
        code: 'PARENT_OUTSIDE_COLLECTION',
        message: 'Parent must belong to this header tab.',
      };
    }

    cursor = nodesById.get(cursor.parentId);
  }

  return {
    ok: false,
    code: 'PARENT_OUTSIDE_COLLECTION',
    message: 'Parent must belong to this header tab.',
  };
}

function wouldCreateCycle(
  nodeId: string,
  newParentId: string,
  nodesById: Map<string, Pick<HeaderMenuNode, 'id' | 'parentId'>>
): boolean {
  let cursor: string | null = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === nodeId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = nodesById.get(cursor)?.parentId ?? null;
  }
  return false;
}

async function resolveCanUpdate(
  db: Database,
  actorId: string,
  role: string
): Promise<boolean> {
  if (role === 'owner') return true;
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
  usedCategoryIds: Set<string>
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
    .filter((root) => !usedCategoryIds.has(root.id))
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
  row: HeaderMenuNode,
  category: Category | null = null
) {
  const name = row.title?.trim() || category?.name || 'Untitled';
  const slug = category?.slug ?? slugifyFallback(name, row.id);
  const href = row.customUrl?.trim()
    ? row.customUrl
    : category
      ? categoryHref(category.slug)
      : null;
  return {
    id: row.id,
    categoryId: category?.id ?? row.categoryId,
    name,
    slug,
    href,
    position: row.position,
    isVisible: row.isVisible,
    usesCategoryFallback: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: [] as unknown[],
  };
}

function serializeItemRow(
  row: HeaderMenuNode,
  category: Category | null = null,
  depth = 1
) {
  const name = row.title?.trim() || category?.name || 'Untitled';
  const slug = category?.slug ?? slugifyFallback(name, row.id);
  const href = row.customUrl?.trim()
    ? row.customUrl
    : category
      ? categoryHref(category.slug)
      : null;
  return {
    id: row.id,
    parentId: row.parentId,
    categoryId: category?.id ?? row.categoryId,
    name,
    slug,
    href,
    position: row.position,
    isVisible: row.isVisible,
    featured: row.featured,
    depth,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    children: [] as unknown[],
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

const editHeader = new Hono<AppEnv>();

editHeader.use('*', requireAdminMiddleware);

// ─── GET / — full header tree + available root categories ─────────────────────
editHeader.get('/', async (c) => {
  const actor = getActor(c);
  const db = getDb(c);

  try {
    const collections = await loadAdminHeaderFromDb(db);
    const canUpdate = await resolveCanUpdate(db, actor.id, actor.role);
    const visibleCount = collections.filter((col) => col.isVisible).length;
    const usedCategoryIds = new Set(
      collections
        .map((col) => col.categoryId)
        .filter((id): id is string => typeof id === 'string')
    );
    const availableCategories = await loadAvailableRootCategories(
      db,
      usedCategoryIds
    );

    return c.json({
      success: true,
      data: collections,
      availableCategories,
      meta: {
        totalCollections: collections.length,
        visibleCollections: visibleCount,
        maxVisibleCollections: MAX_VISIBLE_HEADER_COLLECTIONS,
        maxTotalCollections: MAX_TOTAL_COLLECTIONS,
        maxItemsPerCollection: MAX_ITEMS_PER_COLLECTION,
        maxItemDepth: MAX_HEADER_ITEM_DEPTH,
        currentUserId: actor.id,
        currentUserRole: actor.role,
        canUpdate,
      },
    });
  } catch (error) {
    console.error('Error loading header for admin:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load header.');
  }
});

// ─── POST /collections — add a root category to the header ────────────────────
editHeader.post(
  '/collections',
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
        'INVALID_CATEGORY_ID',
        'Select an existing category to add to the header.'
      );
    }

    const category = await getCategoryById(db, categoryId);
    if (!category) {
      return errorJson(
        c,
        404,
        'CATEGORY_NOT_FOUND',
        'Selected category was not found.'
      );
    }

    if (category.parentId) {
      return errorJson(
        c,
        400,
        'NOT_ROOT_CATEGORY',
        'Only root categories can be added to the top header navigation.'
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
          'MAX_COLLECTIONS',
          `You can have at most ${MAX_TOTAL_COLLECTIONS} header categories.`
        );
      }

      if (isVisible) {
        const visible = await countVisibleCollections(db);
        if (visible >= MAX_VISIBLE_HEADER_COLLECTIONS) {
          return errorJson(
            c,
            400,
            'MAX_VISIBLE',
            `At most ${MAX_VISIBLE_HEADER_COLLECTIONS} categories can be visible in the navbar. Hide another one first, or add this as hidden.`
          );
        }
      }

      const existing = await getTopHeaderNodeByCategoryId(db, category.id);
      if (existing) {
        return errorJson(
          c,
          409,
          'CATEGORY_ALREADY_ADDED',
          'That category is already in the header.'
        );
      }

      // Append to end when position not provided.
      let nextPosition = position;
      if (nextPosition === undefined) {
        // Prefer max position + 10 for stable ordering gaps.
        const all = await db
          .select({ position: headerMenuNodes.position })
          .from(headerMenuNodes)
          .where(isNull(headerMenuNodes.parentId));
        const maxPos =
          all.length === 0 ? -10 : Math.max(...all.map((row) => row.position));
        nextPosition = maxPos + 10;
      }

      const now = new Date();
      const id = nanoid();

      const [created] = await db
        .insert(headerMenuNodes)
        .values({
          id,
          parentId: null,
          categoryId: category.id,
          customUrl: null,
          title: null,
          layout: 'mega',
          featured: false,
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
          description: `Added category "${category.name}" to store header`,
          targetType: AUDIT_TARGET_TYPES.HEADER_COLLECTION,
          targetId: created.id,
          targetLabel: category.name,
          severity: 'info',
          changes: {
            name: { to: category.name },
            slug: { to: category.slug },
            categoryId: { to: category.id },
            isVisible: { to: created.isVisible },
            position: { to: created.position },
          },
          metadata: {
            kind: 'header_collection',
            categoryId: category.id,
          },
        }).then(() => undefined)
      );

      return c.json(
        {
          success: true,
          message: `"${category.name}" added to the header.`,
          data: serializeCollectionRow(created, category),
        },
        201
      );
    } catch (error) {
      console.error('Error creating header collection:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to add category to the header.'
      );
    }
  }
);

// ─── PATCH /collections/:id — visibility / category swap only ─────────────────
editHeader.patch(
  '/collections/:id',
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param('id')?.trim() ?? '';

    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid collection id.');
    }

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    try {
      const [existing] = await db
        .select()
        .from(headerMenuNodes)
        .where(eq(headerMenuNodes.id, id))
        .limit(1);

      if (!existing) {
        return errorJson(
          c,
          404,
          'COLLECTION_NOT_FOUND',
          'Header category not found.'
        );
      }
      if (existing.parentId !== null) {
        return errorJson(
          c,
          404,
          'COLLECTION_NOT_FOUND',
          'Header category not found.'
        );
      }

      const existingCategory = existing.categoryId
        ? await getCategoryById(db, existing.categoryId)
        : null;

      const updates: Partial<HeaderMenuNode> = {
        updatedAt: new Date(),
      };
      const changes: Record<string, { from?: unknown; to?: unknown }> = {};
      let resolvedCategory: Category | null = existingCategory;

      // Optional: swap to a different root category.
      if (body.categoryId !== undefined) {
        const categoryId = sanitizeCategoryId(body.categoryId);
        if (!categoryId) {
          return errorJson(
            c,
            400,
            'INVALID_CATEGORY_ID',
            'Invalid category id.'
          );
        }

        const category = await getCategoryById(db, categoryId);
        if (!category) {
          return errorJson(
            c,
            404,
            'CATEGORY_NOT_FOUND',
            'Selected category was not found.'
          );
        }

        if (category.parentId) {
          return errorJson(
            c,
            400,
            'NOT_ROOT_CATEGORY',
            'Only root categories can be used in the top header navigation.'
          );
        }

        const duplicate = await getTopHeaderNodeByCategoryId(
          db,
          category.id,
          id
        );
        if (duplicate) {
          return errorJson(
            c,
            409,
            'CATEGORY_ALREADY_ADDED',
            'That category is already in the header.'
          );
        }

        resolvedCategory = category;

        if (category.id !== existing.categoryId) {
          updates.categoryId = category.id;
          updates.title = null;
          updates.customUrl = null;
          changes.categoryId = {
            from: existing.categoryId,
            to: category.id,
          };
          changes.name = {
            from: existingCategory?.name ?? existing.title ?? null,
            to: category.name,
          };
          changes.slug = {
            from: existingCategory?.slug ?? null,
            to: category.slug,
          };
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

      if (body.isVisible !== undefined) {
        const isVisible = sanitizeBoolean(body.isVisible);
        if (isVisible === undefined) {
          return errorJson(
            c,
            400,
            'INVALID_VISIBLE',
            'isVisible must be a boolean.'
          );
        }
        if (isVisible !== existing.isVisible) {
          if (isVisible) {
            const visible = await countVisibleCollections(db, id);
            if (visible >= MAX_VISIBLE_HEADER_COLLECTIONS) {
              return errorJson(
                c,
                400,
                'MAX_VISIBLE',
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
          .select()
          .from(categories)
          .where(eq(categories.id, existing.categoryId ?? ''))
          .limit(1);

        return c.json({
          success: true,
          message: 'No changes detected.',
          data: serializeCollectionRow(existing, matched ?? null),
        });
      }

      const [updated] = await db
        .update(headerMenuNodes)
        .set(updates)
        .where(eq(headerMenuNodes.id, id))
        .returning();

      if (!resolvedCategory && updated.categoryId) {
        resolvedCategory = await getCategoryById(db, updated.categoryId);
      }

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_UPDATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Updated header category "${
            resolvedCategory?.name ?? updated.title ?? updated.id
          }"`,
          targetType: AUDIT_TARGET_TYPES.HEADER_COLLECTION,
          targetId: updated.id,
          targetLabel: resolvedCategory?.name ?? updated.title ?? updated.id,
          severity: 'info',
          changes,
          metadata: {
            kind: 'header_collection',
            categoryId: resolvedCategory?.id ?? updated.categoryId,
          },
        }).then(() => undefined)
      );

      const updatedLabel =
        resolvedCategory?.name ?? updated.title ?? updated.id;
      return c.json({
        success: true,
        message: `Header category "${updatedLabel}" updated.`,
        data: serializeCollectionRow(updated, resolvedCategory),
      });
    } catch (error) {
      console.error('Error updating header collection:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to update header category.'
      );
    }
  }
);

// ─── DELETE /collections/:id ──────────────────────────────────────────────────
editHeader.delete(
  '/collections/:id',
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param('id')?.trim() ?? '';

    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid collection id.');
    }

    try {
      const [existing] = await db
        .select()
        .from(headerMenuNodes)
        .where(eq(headerMenuNodes.id, id))
        .limit(1);

      if (!existing) {
        return errorJson(
          c,
          404,
          'COLLECTION_NOT_FOUND',
          'Header category not found.'
        );
      }
      if (existing.parentId !== null) {
        return errorJson(
          c,
          404,
          'COLLECTION_NOT_FOUND',
          'Header category not found.'
        );
      }

      const existingCategory = existing.categoryId
        ? await getCategoryById(db, existing.categoryId)
        : null;
      const existingLabel =
        existingCategory?.name ?? existing.title ?? existing.id;
      const existingSlug =
        existingCategory?.slug ?? slugifyFallback(existingLabel, existing.id);

      // Cascade deletes child menu nodes via FK.
      await db.delete(headerMenuNodes).where(eq(headerMenuNodes.id, id));

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_DELETE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Removed category "${existingLabel}" from store header`,
          targetType: AUDIT_TARGET_TYPES.HEADER_COLLECTION,
          targetId: existing.id,
          targetLabel: existingLabel,
          severity: 'warning',
          changes: {
            name: { from: existingLabel },
            slug: { from: existingSlug },
          },
          metadata: { kind: 'header_collection' },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `"${existingLabel}" removed from the header.`,
      });
    } catch (error) {
      console.error('Error deleting header collection:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to remove category from the header.'
      );
    }
  }
);

// ─── POST /collections/:id/items — add a nested menu node ────────────────────
// Body: { categoryId? | slug? | name?, parentId?, position?, isVisible?, featured?, href? }
// parentId defaults to the root tab. Pass a subcategory id to create a sub-sub item.
editHeader.post(
  '/collections/:id/items',
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);
    const collectionId = c.req.param('id')?.trim() ?? '';

    if (!isValidId(collectionId)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid collection id.');
    }

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    try {
      const nodesById = await loadAllNodesMap(db);
      const collection = nodesById.get(collectionId);

      if (!collection || collection.parentId !== null) {
        return errorJson(
          c,
          404,
          'COLLECTION_NOT_FOUND',
          'Header category not found.'
        );
      }

      const totalDescendants = await countDescendants(db, collectionId);
      if (totalDescendants >= MAX_ITEMS_PER_COLLECTION) {
        return errorJson(
          c,
          400,
          'MAX_ITEMS',
          `You can have at most ${MAX_ITEMS_PER_COLLECTION} items under a header tab.`
        );
      }

      const requestedParentId =
        typeof body.parentId === 'string' && body.parentId.trim()
          ? body.parentId.trim()
          : collectionId;

      if (!isValidId(requestedParentId)) {
        return errorJson(c, 400, 'INVALID_PARENT', 'Invalid parent id.');
      }

      const parentResolved = resolveParentUnderCollection(
        collectionId,
        requestedParentId,
        nodesById
      );
      if (!parentResolved.ok) {
        return errorJson(
          c,
          400,
          parentResolved.code,
          parentResolved.message
        );
      }

      const category = await resolveCategoryFromBody(db, body);
      const title = category ? null : sanitizeTitle(body.name);
      if (title === undefined) {
        return errorJson(
          c,
          400,
          'INVALID_NAME',
          `Item name must be 1–${MAX_TITLE_LENGTH} characters.`
        );
      }
      if (!category && !title) {
        return errorJson(
          c,
          400,
          'INVALID_ITEM',
          'Select a category or provide an item name.'
        );
      }

      if (category) {
        // Same category cannot appear twice under the same parent.
        const [duplicate] = await db
          .select({ id: headerMenuNodes.id })
          .from(headerMenuNodes)
          .where(
            and(
              eq(headerMenuNodes.parentId, requestedParentId),
              eq(headerMenuNodes.categoryId, category.id)
            )
          )
          .limit(1);

        if (duplicate) {
          return errorJson(
            c,
            409,
            'ITEM_ALREADY_ADDED',
            'That category is already under this menu parent.'
          );
        }
      }

      const position = sanitizePosition(body.position);
      const isVisible = sanitizeBoolean(body.isVisible) ?? true;
      const featured = sanitizeBoolean(body.featured) ?? false;
      const customUrl = category ? null : sanitizeUrl(body.href);

      if (customUrl === undefined) {
        return errorJson(
          c,
          400,
          'INVALID_URL',
          'URL must be a relative path (starting with /) or an absolute http(s) URL.'
        );
      }

      let nextPosition = position;
      if (nextPosition === undefined) {
        const siblings = await db
          .select({ position: headerMenuNodes.position })
          .from(headerMenuNodes)
          .where(eq(headerMenuNodes.parentId, requestedParentId));
        const maxPos =
          siblings.length === 0
            ? -10
            : Math.max(...siblings.map((row) => row.position));
        nextPosition = maxPos + 10;
      }

      const now = new Date();
      const [created] = await db
        .insert(headerMenuNodes)
        .values({
          id: nanoid(),
          parentId: requestedParentId,
          categoryId: category?.id ?? null,
          customUrl: customUrl ?? null,
          title: title ?? null,
          layout: parentResolved.childDepth === 1 ? 'dropdown' : 'simple',
          featured,
          position: nextPosition,
          isVisible,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await bustCache(c);

      const label = category?.name ?? title ?? created.id;
      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_CREATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Added item "${label}" to store header`,
          targetType: AUDIT_TARGET_TYPES.HEADER_ITEM,
          targetId: created.id,
          targetLabel: label,
          severity: 'info',
          changes: {
            name: { to: label },
            categoryId: { to: category?.id ?? null },
            parentId: { to: requestedParentId },
            isVisible: { to: created.isVisible },
            featured: { to: created.featured },
            position: { to: created.position },
            depth: { to: parentResolved.childDepth },
          },
          metadata: {
            kind: 'header_item',
            collectionId,
            parentId: requestedParentId,
            categoryId: category?.id ?? null,
            depth: parentResolved.childDepth,
          },
        }).then(() => undefined)
      );

      return c.json(
        {
          success: true,
          message: `"${label}" added to the header.`,
          data: serializeItemRow(created, category, parentResolved.childDepth),
        },
        201
      );
    } catch (error) {
      console.error('Error creating header item:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to add item to the header.'
      );
    }
  }
);

// ─── POST /collections/:id/import-tree — materialize category children ────────
editHeader.post(
  '/collections/:id/import-tree',
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);
    const collectionId = c.req.param('id')?.trim() ?? '';

    if (!isValidId(collectionId)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid collection id.');
    }

    try {
      const [collection] = await db
        .select()
        .from(headerMenuNodes)
        .where(eq(headerMenuNodes.id, collectionId))
        .limit(1);

      if (!collection || collection.parentId !== null) {
        return errorJson(
          c,
          404,
          'COLLECTION_NOT_FOUND',
          'Header category not found.'
        );
      }

      if (!collection.categoryId) {
        return errorJson(
          c,
          400,
          'NO_CATEGORY',
          'This tab is not linked to a category, so there is nothing to import.'
        );
      }

      const existingChildren = await db
        .select({ id: headerMenuNodes.id })
        .from(headerMenuNodes)
        .where(eq(headerMenuNodes.parentId, collectionId))
        .limit(1);

      if (existingChildren.length > 0) {
        return errorJson(
          c,
          409,
          'ALREADY_HAS_ITEMS',
          'This tab already has explicit menu items. Clear them first, or add more manually.'
        );
      }

      const allCategories = await db
        .select()
        .from(categories)
        .orderBy(asc(categories.position), asc(categories.name));

      const byParent = new Map<string | null, Category[]>();
      for (const cat of allCategories) {
        const list = byParent.get(cat.parentId) ?? [];
        list.push(cat);
        byParent.set(cat.parentId, list);
      }

      const level1 = byParent.get(collection.categoryId) ?? [];
      if (level1.length === 0) {
        return errorJson(
          c,
          400,
          'NO_CHILDREN',
          'The linked category has no child categories to import.'
        );
      }

      const now = new Date();
      let createdCount = 0;
      let position = 0;

      for (const sub of level1) {
        if (createdCount >= MAX_ITEMS_PER_COLLECTION) break;
        const subId = nanoid();
        await db.insert(headerMenuNodes).values({
          id: subId,
          parentId: collectionId,
          categoryId: sub.id,
          customUrl: null,
          title: null,
          layout: 'dropdown',
          featured: false,
          position,
          isVisible: true,
          createdAt: now,
          updatedAt: now,
        });
        createdCount += 1;
        position += 10;

        const level2 = byParent.get(sub.id) ?? [];
        let childPos = 0;
        for (const leaf of level2) {
          if (createdCount >= MAX_ITEMS_PER_COLLECTION) break;
          await db.insert(headerMenuNodes).values({
            id: nanoid(),
            parentId: subId,
            categoryId: leaf.id,
            customUrl: null,
            title: null,
            layout: 'simple',
            featured: false,
            position: childPos,
            isVisible: true,
            createdAt: now,
            updatedAt: now,
          });
          createdCount += 1;
          childPos += 10;
        }
      }

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_CREATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Imported ${createdCount} category nodes into header tab`,
          targetType: AUDIT_TARGET_TYPES.HEADER_COLLECTION,
          targetId: collectionId,
          targetLabel: collection.title ?? collection.categoryId,
          severity: 'info',
          metadata: {
            kind: 'header_import_tree',
            createdCount,
          },
        }).then(() => undefined)
      );

      const collections = await loadAdminHeaderFromDb(db);
      const updated = collections.find((col) => col.id === collectionId);

      return c.json({
        success: true,
        message: `Imported ${createdCount} menu item${createdCount === 1 ? '' : 's'} from the category tree.`,
        data: updated ?? null,
        meta: { createdCount },
      });
    } catch (error) {
      console.error('Error importing header tree:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to import category tree into the header.'
      );
    }
  }
);

// ─── PATCH /items/:id ────────────────────────────────────────────────────────
editHeader.patch(
  '/items/:id',
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param('id')?.trim() ?? '';

    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid item id.');
    }

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    try {
      const nodesById = await loadAllNodesMap(db);
      const existing = nodesById.get(id);

      if (!existing || existing.parentId === null) {
        return errorJson(c, 404, 'ITEM_NOT_FOUND', 'Header item not found.');
      }

      const existingCategory = existing.categoryId
        ? await getCategoryById(db, existing.categoryId)
        : null;
      const updates: Partial<HeaderMenuNode> = { updatedAt: new Date() };
      const changes: Record<string, { from?: unknown; to?: unknown }> = {};
      let resolvedCategory = existingCategory;

      // Optional re-parent within the same root tab.
      if (body.parentId !== undefined) {
        if (typeof body.parentId !== 'string' || !isValidId(body.parentId)) {
          return errorJson(c, 400, 'INVALID_PARENT', 'Invalid parent id.');
        }
        const newParentId = body.parentId.trim();
        if (newParentId === id) {
          return errorJson(
            c,
            400,
            'INVALID_PARENT',
            'An item cannot be its own parent.'
          );
        }
        if (wouldCreateCycle(id, newParentId, nodesById)) {
          return errorJson(
            c,
            400,
            'CYCLE_DETECTED',
            'That move would create a circular menu structure.'
          );
        }

        let rootId: string | null = existing.parentId;
        let walk: HeaderMenuNode | undefined = existing;
        const seen = new Set<string>();
        while (walk && walk.parentId !== null) {
          if (seen.has(walk.id)) {
            rootId = null;
            break;
          }
          seen.add(walk.id);
          rootId = walk.parentId;
          walk = nodesById.get(walk.parentId);
        }
        if (!rootId) {
          return errorJson(
            c,
            400,
            'INVALID_PARENT',
            'Could not resolve the root tab for this item.'
          );
        }

        const parentCheck = resolveParentUnderCollection(
          rootId,
          newParentId,
          nodesById
        );
        if (!parentCheck.ok) {
          return errorJson(c, 400, parentCheck.code, parentCheck.message);
        }

        if (parentCheck.childDepth >= MAX_HEADER_ITEM_DEPTH) {
          const hasKids = [...nodesById.values()].some(
            (n) => n.parentId === id
          );
          if (hasKids) {
            return errorJson(
              c,
              400,
              'MAX_DEPTH',
              'Cannot move a parent item to the deepest level while it still has children.'
            );
          }
        }

        if (newParentId !== existing.parentId) {
          updates.parentId = newParentId;
          changes.parentId = { from: existing.parentId, to: newParentId };
        }
      }

      if (body.categoryId !== undefined || body.slug !== undefined) {
        const category = await resolveCategoryFromBody(db, body);
        if (!category) {
          if (body.categoryId !== undefined) {
            return errorJson(
              c,
              404,
              'CATEGORY_NOT_FOUND',
              'Selected category was not found.'
            );
          }
        } else {
          if (category.id !== existing.categoryId) {
            const [duplicate] = await db
              .select({ id: headerMenuNodes.id })
              .from(headerMenuNodes)
              .where(
                and(
                  eq(headerMenuNodes.parentId, existing.parentId),
                  eq(headerMenuNodes.categoryId, category.id),
                  ne(headerMenuNodes.id, id)
                )
              )
              .limit(1);

            if (duplicate) {
              return errorJson(
                c,
                409,
                'ITEM_ALREADY_ADDED',
                'That category is already in this header menu.'
              );
            }
          }

          resolvedCategory = category;
          if (category.id !== existing.categoryId) {
            updates.categoryId = category.id;
            updates.title = null;
            updates.customUrl = null;
            changes.categoryId = { from: existing.categoryId, to: category.id };
            changes.name = {
              from: existingCategory?.name ?? existing.title ?? null,
              to: category.name,
            };
            changes.slug = {
              from: existingCategory?.slug ?? null,
              to: category.slug,
            };
          }
        }
      }

      if (body.name !== undefined) {
        const title = sanitizeTitle(body.name);
        if (title === undefined) {
          return errorJson(c, 400, 'INVALID_NAME', 'Invalid item name.');
        }
        const normalizedTitle =
          resolvedCategory && title === resolvedCategory.name ? null : title;
        if (normalizedTitle !== existing.title) {
          updates.title = normalizedTitle;
          changes.name = {
            from: existing.title ?? existingCategory?.name ?? null,
            to: normalizedTitle ?? resolvedCategory?.name ?? null,
          };
        }
      }

      if (body.href !== undefined) {
        const customUrl = sanitizeUrl(body.href);
        if (customUrl === undefined) {
          return errorJson(c, 400, 'INVALID_URL', 'Invalid item URL.');
        }
        const categoryHrefValue = resolvedCategory
          ? categoryHref(resolvedCategory.slug)
          : null;
        const normalizedUrl =
          categoryHrefValue && customUrl === categoryHrefValue
            ? null
            : customUrl;
        if (normalizedUrl !== existing.customUrl) {
          updates.customUrl = normalizedUrl;
          changes.href = { from: existing.customUrl, to: normalizedUrl };
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

      if (body.isVisible !== undefined) {
        const isVisible = sanitizeBoolean(body.isVisible);
        if (isVisible === undefined) {
          return errorJson(
            c,
            400,
            'INVALID_VISIBLE',
            'isVisible must be a boolean.'
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
            'INVALID_FEATURED',
            'featured must be a boolean.'
          );
        }
        if (featured !== existing.featured) {
          updates.featured = featured;
          changes.featured = { from: existing.featured, to: featured };
        }
      }

      if (Object.keys(changes).length === 0) {
        const depth =
          getNodeDepthFromMap(existing.id, nodesById) ?? 1;
        return c.json({
          success: true,
          message: 'No changes detected.',
          data: serializeItemRow(existing, resolvedCategory, depth),
        });
      }

      const [updated] = await db
        .update(headerMenuNodes)
        .set(updates)
        .where(eq(headerMenuNodes.id, id))
        .returning();

      if (!resolvedCategory && updated.categoryId) {
        resolvedCategory = await getCategoryById(db, updated.categoryId);
      }

      // Refresh map entry for accurate depth after parent change.
      nodesById.set(updated.id, updated);
      const depth = getNodeDepthFromMap(updated.id, nodesById) ?? 1;

      await bustCache(c);

      const label = resolvedCategory?.name ?? updated.title ?? updated.id;
      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_UPDATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Updated header item "${label}"`,
          targetType: AUDIT_TARGET_TYPES.HEADER_ITEM,
          targetId: updated.id,
          targetLabel: label,
          severity: 'info',
          changes,
          metadata: {
            kind: 'header_item',
            collectionId: updated.parentId,
            categoryId: resolvedCategory?.id ?? updated.categoryId,
            depth,
          },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `Header item "${label}" updated.`,
        data: serializeItemRow(updated, resolvedCategory, depth),
      });
    } catch (error) {
      console.error('Error updating header item:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to update header item.'
      );
    }
  }
);

// ─── DELETE /items/:id ───────────────────────────────────────────────────────
editHeader.delete(
  '/items/:id',
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param('id')?.trim() ?? '';

    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid item id.');
    }

    try {
      const [existing] = await db
        .select()
        .from(headerMenuNodes)
        .where(eq(headerMenuNodes.id, id))
        .limit(1);

      if (!existing || existing.parentId === null) {
        return errorJson(c, 404, 'ITEM_NOT_FOUND', 'Header item not found.');
      }

      const category = existing.categoryId
        ? await getCategoryById(db, existing.categoryId)
        : null;
      const label = category?.name ?? existing.title ?? existing.id;
      const slug = category?.slug ?? slugifyFallback(label, existing.id);

      await db.delete(headerMenuNodes).where(eq(headerMenuNodes.id, id));
      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_DELETE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Removed item "${label}" from store header`,
          targetType: AUDIT_TARGET_TYPES.HEADER_ITEM,
          targetId: existing.id,
          targetLabel: label,
          severity: 'warning',
          changes: {
            name: { from: label },
            slug: { from: slug },
          },
          metadata: {
            kind: 'header_item',
            collectionId: existing.parentId,
            categoryId: category?.id ?? existing.categoryId,
          },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `"${label}" removed from the header.`,
      });
    } catch (error) {
      console.error('Error deleting header item:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to remove item from the header.'
      );
    }
  }
);

// ─── PUT /reorder — batch reorder roots + nested items (optional parent moves) ─
// Body:
//   collections?: { id, position }[]
//   items?: { id, position, parentId? }[]
editHeader.put(
  '/reorder',
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    const db = getDb(c);

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    const collectionOrder = Array.isArray(body.collections)
      ? (body.collections as unknown[])
      : [];
    const itemOrder = Array.isArray(body.items)
      ? (body.items as unknown[])
      : [];

    if (collectionOrder.length === 0 && itemOrder.length === 0) {
      return errorJson(
        c,
        400,
        'INVALID_BODY',
        'Provide a non-empty `collections` or `items` array of { id, position, parentId? }.'
      );
    }

    try {
      const now = new Date();
      let updatedCollections = 0;
      let updatedItems = 0;
      const nodesById = await loadAllNodesMap(db);
      const seenCollections = new Set<string>();

      for (const entry of collectionOrder) {
        if (
          entry === null ||
          typeof entry !== 'object' ||
          Array.isArray(entry)
        ) {
          continue;
        }
        const row = entry as Record<string, unknown>;
        const id = typeof row.id === 'string' ? row.id.trim() : '';
        const position = sanitizePosition(row.position);
        if (!isValidId(id) || position === undefined) continue;
        if (seenCollections.has(id)) continue;
        seenCollections.add(id);

        const existing = nodesById.get(id);
        if (!existing || existing.parentId !== null) continue;

        const result = await db
          .update(headerMenuNodes)
          .set({ position, updatedAt: now })
          .where(
            and(eq(headerMenuNodes.id, id), isNull(headerMenuNodes.parentId))
          )
          .returning({ id: headerMenuNodes.id });

        if (result.length > 0) {
          updatedCollections += 1;
          existing.position = position;
          existing.updatedAt = now;
        }
      }

      const seenItems = new Set<string>();
      for (const entry of itemOrder) {
        if (
          entry === null ||
          typeof entry !== 'object' ||
          Array.isArray(entry)
        ) {
          continue;
        }
        const row = entry as Record<string, unknown>;
        const id = typeof row.id === 'string' ? row.id.trim() : '';
        const position = sanitizePosition(row.position);
        if (!isValidId(id) || position === undefined) continue;
        if (seenItems.has(id)) continue;
        seenItems.add(id);

        const existing = nodesById.get(id);
        if (!existing || existing.parentId === null) continue;

        const updates: Partial<HeaderMenuNode> = {
          position,
          updatedAt: now,
        };

        // Optional re-parent (drag across groups).
        if (row.parentId !== undefined) {
          if (typeof row.parentId !== 'string' || !isValidId(row.parentId)) {
            continue;
          }
          const newParentId = row.parentId.trim();
          if (newParentId === id) continue;
          if (wouldCreateCycle(id, newParentId, nodesById)) continue;

          const newParent = nodesById.get(newParentId);
          if (!newParent) continue;

          // Find root tab for the existing node.
          let rootId: string | null = existing.parentId;
          let walk: HeaderMenuNode | undefined = existing;
          const seen = new Set<string>();
          while (walk && walk.parentId !== null) {
            if (seen.has(walk.id)) {
              rootId = null;
              break;
            }
            seen.add(walk.id);
            rootId = walk.parentId;
            walk = nodesById.get(walk.parentId);
          }
          if (!rootId) continue;

          const parentCheck = resolveParentUnderCollection(
            rootId,
            newParentId,
            nodesById
          );
          if (!parentCheck.ok) continue;

          // Moving a node that already has children cannot exceed max depth.
          // Approximate: if new child depth is 2, node must be a leaf.
          if (parentCheck.childDepth >= MAX_HEADER_ITEM_DEPTH) {
            const hasKids = [...nodesById.values()].some(
              (n) => n.parentId === id
            );
            if (hasKids) continue;
          }
          // If new depth would put grandchildren over max, skip.
          if (parentCheck.childDepth > MAX_HEADER_ITEM_DEPTH) continue;

          updates.parentId = newParentId;
        }

        const result = await db
          .update(headerMenuNodes)
          .set(updates)
          .where(
            and(eq(headerMenuNodes.id, id), isNotNull(headerMenuNodes.parentId))
          )
          .returning({ id: headerMenuNodes.id });

        if (result.length > 0) {
          updatedItems += 1;
          existing.position = position;
          existing.updatedAt = now;
          if (updates.parentId !== undefined) {
            existing.parentId = updates.parentId;
            nodesById.set(id, existing);
          }
        }
      }

      if (updatedCollections === 0 && updatedItems === 0) {
        return errorJson(
          c,
          400,
          'NOTHING_REORDERED',
          'No valid header entries were reordered.'
        );
      }

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_UPDATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: `Reordered store header (${updatedCollections} categories, ${updatedItems} items)`,
          targetType: AUDIT_TARGET_TYPES.SYSTEM,
          targetLabel: 'header',
          severity: 'info',
          metadata: {
            kind: 'header_reorder',
            updatedCollections,
            updatedItems,
          },
        }).then(() => undefined)
      );

      const collections = await loadAdminHeaderFromDb(db);

      return c.json({
        success: true,
        message: 'Header order updated.',
        data: collections,
        meta: { updatedCollections, updatedItems },
      });
    } catch (error) {
      console.error('Error reordering header:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to reorder header.');
    }
  }
);

// ─── POST /invalidate-cache — force bust public nav cache ─────────────────────
editHeader.post(
  '/invalidate-cache',
  requirePermission(PERMISSIONS.HEADER_UPDATE),
  async (c) => {
    try {
      await invalidateHeaderNavCache(c.env.KV);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HEADER_UPDATE,
          category: AUDIT_CATEGORIES.HEADER,
          description: 'Invalidated storefront header nav cache',
          targetType: AUDIT_TARGET_TYPES.SYSTEM,
          targetLabel: 'header_cache',
          severity: 'info',
          metadata: { kind: 'header_cache_invalidate' },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: 'Header navigation cache invalidated.',
      });
    } catch (error) {
      console.error('Error invalidating header cache:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to invalidate header cache.'
      );
    }
  }
);

export default editHeader;
export type { HeaderAdminCollection };
