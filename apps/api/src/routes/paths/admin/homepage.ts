import { Hono } from 'hono';
import { asc, count, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  homepageBlocks,
  isHomepageBlockType,
  type Database,
  type HomepageBlock,
  type HomepageBlockType,
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
  buildChanges,
  logAuditFromContext,
} from '@/utils/auditLog';
import {
  assertFeedLastInvariant,
  defaultHomepageConfig,
  invalidateHomepageCache,
  isValidId,
  loadAdminHomepageFromDb,
  loadAvailableHomepageCategories,
  loadCategoryIdSet,
  MAX_BLOCKS,
  MAX_BUTTONS_PER_CTA,
  MAX_FEED_PAGE_SIZE,
  MAX_GRID_LIMIT,
  MAX_SLIDES_PER_SLIDER,
  sanitizeHomepageConfig,
  type BlockOrderRow,
} from '@/utils/homepageContent';
import {
  collectPromoProductIds,
  loadExistingProductIdSet,
  searchHomepageProducts,
} from '@/utils/homepagePromo';
import { requestOriginFromUrl } from '@/utils/productImageHost';

const MAX_BODY_BYTES = 64 * 1024;

const homepage = new Hono<AppEnv>();

homepage.use('*', requireAdminMiddleware);

async function resolveCanUpdate(
  db: Database,
  actorId: string,
  role: string
): Promise<boolean> {
  if (role === 'owner') return true;
  return adminHasPermission(db, actorId, PERMISSIONS.HOMEPAGE_UPDATE);
}

async function bustCache(c: AppContext) {
  c.executionCtx.waitUntil(
    invalidateHomepageCache(c.env.KV).then(() => undefined)
  );
}

function sanitizePosition(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1_000_000, Math.floor(value)));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number.parseInt(value, 10);
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

function payloadTooLarge(c: AppContext) {
  const header = c.req.header('content-length');
  if (!header) return false;
  const n = Number.parseInt(header, 10);
  return Number.isFinite(n) && n > MAX_BODY_BYTES;
}

async function readJsonObject(
  c: AppContext
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  if (payloadTooLarge(c)) {
    return {
      ok: false,
      response: errorJson(
        c,
        413,
        'PAYLOAD_TOO_LARGE',
        'Request body is too large.'
      ),
    };
  }

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

  try {
    const serialized = JSON.stringify(body);
    if (serialized.length > MAX_BODY_BYTES) {
      return {
        ok: false,
        response: errorJson(
          c,
          413,
          'PAYLOAD_TOO_LARGE',
          'Request body is too large.'
        ),
      };
    }
  } catch {
    return {
      ok: false,
      response: errorJson(
        c,
        400,
        'INVALID_BODY',
        'Request body could not be read.'
      ),
    };
  }

  return { ok: true, body: body as Record<string, unknown> };
}

async function loadOrderRows(db: Database): Promise<BlockOrderRow[]> {
  return db
    .select({
      id: homepageBlocks.id,
      blockType: homepageBlocks.blockType,
      position: homepageBlocks.position,
    })
    .from(homepageBlocks)
    .orderBy(asc(homepageBlocks.position), asc(homepageBlocks.id));
}

async function countBlocks(db: Database): Promise<number> {
  const [result] = await db.select({ value: count() }).from(homepageBlocks);
  return Number(result?.value ?? 0);
}

function auditBlockSnapshot(row: HomepageBlock) {
  return {
    id: row.id,
    blockType: row.blockType,
    position: row.position,
    isVisible: row.isVisible,
    config: row.config,
  };
}

function paramId(c: AppContext): string | null {
  const id = c.req.param('id')?.trim() ?? '';
  return isValidId(id) ? id : null;
}

// ─── GET / — all blocks + categories + meta ───────────────────────────────────

homepage.get('/', async (c) => {
  const actor = getActor(c);
  const db = getDb(c);

  try {
    const [blocks, availableCategories, canUpdate] = await Promise.all([
      loadAdminHomepageFromDb(db),
      loadAvailableHomepageCategories(db),
      resolveCanUpdate(db, actor.id, actor.role),
    ]);

    const visibleBlocks = blocks.filter((block) => block.isVisible).length;

    return c.json({
      success: true,
      data: blocks,
      availableCategories,
      meta: {
        totalBlocks: blocks.length,
        visibleBlocks,
        maxBlocks: MAX_BLOCKS,
        maxSlidesPerSlider: MAX_SLIDES_PER_SLIDER,
        maxButtonsPerCta: MAX_BUTTONS_PER_CTA,
        maxGridLimit: MAX_GRID_LIMIT,
        maxFeedPageSize: MAX_FEED_PAGE_SIZE,
        currentUserId: actor.id,
        currentUserRole: actor.role,
        canUpdate,
      },
    });
  } catch (error) {
    console.error('Error loading homepage for admin:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load homepage.');
  }
});

// ─── GET /products — published product search for slide pickers ───────────────

homepage.get('/products', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length > 120) {
    return errorJson(c, 400, 'INVALID_QUERY', 'Search query is too long.');
  }

  try {
    const db = getDb(c);
    const data =
      q.length === 0
        ? []
        : await searchHomepageProducts(db, q, c.env, {
            origin: requestOriginFromUrl(c.req.url),
          });
    return c.json({ success: true, data });
  } catch (error) {
    console.error('Error searching homepage products:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to search products.');
  }
});

// ─── POST / — create a block ──────────────────────────────────────────────────

homepage.post(
  '/',
  requirePermission(PERMISSIONS.HOMEPAGE_UPDATE),
  async (c) => {
    const db = getDb(c);

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    if (!isHomepageBlockType(body.blockType)) {
      return errorJson(
        c,
        400,
        'INVALID_BLOCK_TYPE',
        'blockType must be promo_slider, product_grid, category_cta, or product_feed.'
      );
    }
    const blockType: HomepageBlockType = body.blockType;

    try {
      const total = await countBlocks(db);
      if (total >= MAX_BLOCKS) {
        return errorJson(
          c,
          400,
          'MAX_BLOCKS',
          `You can have at most ${MAX_BLOCKS} homepage blocks.`
        );
      }

      const existing = await loadOrderRows(db);
      if (
        blockType === 'product_feed' &&
        existing.some((row) => row.blockType === 'product_feed')
      ) {
        return errorJson(
          c,
          400,
          'INVALID_BLOCK_ORDER',
          'Only one product feed block is allowed, and it must be last.'
        );
      }

      const configInput =
        body.config === undefined
          ? defaultHomepageConfig(blockType)
          : body.config;
      const [categoryIds, productIds] = await Promise.all([
        loadCategoryIdSet(db),
        loadExistingProductIdSet(db, collectPromoProductIds(configInput)),
      ]);
      const sanitized = sanitizeHomepageConfig(
        blockType,
        configInput,
        categoryIds,
        productIds
      );
      if (!sanitized.ok) {
        return errorJson(c, 400, sanitized.code, sanitized.error);
      }

      const isVisible = sanitizeBoolean(body.isVisible) ?? true;
      let nextPosition = sanitizePosition(body.position);
      const feed = existing.find((row) => row.blockType === 'product_feed');
      const maxPos =
        existing.length === 0
          ? -10
          : Math.max(...existing.map((row) => row.position));

      const now = new Date();
      let feedBumpTo: number | null = null;

      if (blockType === 'product_feed') {
        nextPosition = nextPosition ?? maxPos + 10;
      } else if (nextPosition === undefined) {
        if (feed) {
          nextPosition = feed.position;
          feedBumpTo = feed.position + 10;
        } else {
          nextPosition = maxPos + 10;
        }
      }

      const id = nanoid();
      const proposed: BlockOrderRow[] = existing.map((row) =>
        feed && row.id === feed.id && feedBumpTo !== null
          ? { ...row, position: feedBumpTo }
          : row
      );
      proposed.push({ id, blockType, position: nextPosition });

      const invariant = assertFeedLastInvariant(proposed);
      if (!invariant.ok) {
        return errorJson(c, 400, 'INVALID_BLOCK_ORDER', invariant.message);
      }

      if (feed && feedBumpTo !== null) {
        await db
          .update(homepageBlocks)
          .set({ position: feedBumpTo, updatedAt: now })
          .where(eq(homepageBlocks.id, feed.id));
      }

      const [created] = await db
        .insert(homepageBlocks)
        .values({
          id,
          blockType,
          config: sanitized.config,
          position: nextPosition,
          isVisible,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!created) {
        return errorJson(
          c,
          500,
          'INTERNAL_ERROR',
          'Failed to create homepage block.'
        );
      }

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HOMEPAGE_CREATE,
          category: AUDIT_CATEGORIES.HOMEPAGE,
          description: `Created homepage ${blockType} block`,
          targetType: AUDIT_TARGET_TYPES.HOMEPAGE_BLOCK,
          targetId: created.id,
          targetLabel: blockType,
          severity: 'info',
          changes: buildChanges({}, auditBlockSnapshot(created)),
          metadata: { kind: 'homepage_block' },
        }).then(() => undefined)
      );

      const [adminRow] = (await loadAdminHomepageFromDb(db)).filter(
        (row) => row.id === created.id
      );

      return c.json(
        {
          success: true,
          message: 'Homepage block created.',
          data: adminRow ?? {
            id: created.id,
            blockType: created.blockType,
            config: created.config,
            position: created.position,
            isVisible: created.isVisible,
            needsRepair: false,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          },
        },
        201
      );
    } catch (error) {
      console.error('Error creating homepage block:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to create homepage block.'
      );
    }
  }
);

// ─── PATCH /:id ───────────────────────────────────────────────────────────────

homepage.patch(
  '/:id',
  requirePermission(PERMISSIONS.HOMEPAGE_UPDATE),
  async (c) => {
    const db = getDb(c);
    const id = paramId(c);
    if (!id) {
      return errorJson(c, 400, 'INVALID_ID', 'A valid block id is required.');
    }

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    try {
      const [before] = await db
        .select()
        .from(homepageBlocks)
        .where(eq(homepageBlocks.id, id))
        .limit(1);

      if (!before) {
        return errorJson(c, 404, 'NOT_FOUND', 'Homepage block was not found.');
      }

      const nextType = isHomepageBlockType(body.blockType)
        ? body.blockType
        : before.blockType;

      if (
        body.blockType !== undefined &&
        !isHomepageBlockType(body.blockType)
      ) {
        return errorJson(
          c,
          400,
          'INVALID_BLOCK_TYPE',
          'blockType must be promo_slider, product_grid, category_cta, or product_feed.'
        );
      }

      const updates: Partial<HomepageBlock> = {
        updatedAt: new Date(),
      };

      if (nextType !== before.blockType) {
        updates.blockType = nextType;
      }

      if (body.config !== undefined) {
        const [categoryIds, productIds] = await Promise.all([
          loadCategoryIdSet(db),
          loadExistingProductIdSet(db, collectPromoProductIds(body.config)),
        ]);
        const sanitized = sanitizeHomepageConfig(
          nextType,
          body.config,
          categoryIds,
          productIds
        );
        if (!sanitized.ok) {
          return errorJson(c, 400, sanitized.code, sanitized.error);
        }
        updates.config = sanitized.config;
      } else if (nextType !== before.blockType) {
        updates.config = defaultHomepageConfig(nextType);
      }

      const nextVisible = sanitizeBoolean(body.isVisible);
      if (nextVisible !== undefined) updates.isVisible = nextVisible;

      const nextPosition = sanitizePosition(body.position);
      if (nextPosition !== undefined) updates.position = nextPosition;

      const existing = await loadOrderRows(db);
      const proposed = existing.map((row) => {
        if (row.id !== id) return row;
        return {
          id: row.id,
          blockType: nextType,
          position: nextPosition ?? row.position,
        };
      });
      const invariant = assertFeedLastInvariant(proposed);
      if (!invariant.ok) {
        return errorJson(c, 400, 'INVALID_BLOCK_ORDER', invariant.message);
      }

      const [after] = await db
        .update(homepageBlocks)
        .set(updates)
        .where(eq(homepageBlocks.id, id))
        .returning();

      if (!after) {
        return errorJson(
          c,
          500,
          'INTERNAL_ERROR',
          'Failed to update homepage block.'
        );
      }

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HOMEPAGE_UPDATE,
          category: AUDIT_CATEGORIES.HOMEPAGE,
          description: `Updated homepage ${after.blockType} block`,
          targetType: AUDIT_TARGET_TYPES.HOMEPAGE_BLOCK,
          targetId: after.id,
          targetLabel: after.blockType,
          severity: 'info',
          changes: buildChanges(
            auditBlockSnapshot(before),
            auditBlockSnapshot(after)
          ),
          metadata: { kind: 'homepage_block' },
        }).then(() => undefined)
      );

      const adminRows = await loadAdminHomepageFromDb(db);
      const adminRow = adminRows.find((row) => row.id === after.id);

      return c.json({
        success: true,
        message: 'Homepage block updated.',
        data: adminRow ?? after,
      });
    } catch (error) {
      console.error('Error updating homepage block:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to update homepage block.'
      );
    }
  }
);

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

homepage.delete(
  '/:id',
  requirePermission(PERMISSIONS.HOMEPAGE_UPDATE),
  async (c) => {
    const db = getDb(c);
    const id = paramId(c);
    if (!id) {
      return errorJson(c, 400, 'INVALID_ID', 'A valid block id is required.');
    }

    try {
      const [before] = await db
        .select()
        .from(homepageBlocks)
        .where(eq(homepageBlocks.id, id))
        .limit(1);

      if (!before) {
        return errorJson(c, 404, 'NOT_FOUND', 'Homepage block was not found.');
      }

      await db.delete(homepageBlocks).where(eq(homepageBlocks.id, id));

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HOMEPAGE_DELETE,
          category: AUDIT_CATEGORIES.HOMEPAGE,
          description: `Deleted homepage ${before.blockType} block`,
          targetType: AUDIT_TARGET_TYPES.HOMEPAGE_BLOCK,
          targetId: before.id,
          targetLabel: before.blockType,
          severity: 'info',
          changes: buildChanges(auditBlockSnapshot(before), {}),
          metadata: { kind: 'homepage_block' },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: 'Homepage block deleted.',
      });
    } catch (error) {
      console.error('Error deleting homepage block:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to delete homepage block.'
      );
    }
  }
);

// ─── PUT /reorder ─────────────────────────────────────────────────────────────

homepage.put(
  '/reorder',
  requirePermission(PERMISSIONS.HOMEPAGE_UPDATE),
  async (c) => {
    const db = getDb(c);

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;

    const existing = await loadOrderRows(db);
    const existingIds = new Set(existing.map((row) => row.id));
    const byId = new Map(existing.map((row) => [row.id, row]));

    const proposed = new Map(existing.map((row) => [row.id, { ...row }]));

    try {
      if (Array.isArray(body.orderedIds)) {
        const orderedIds: string[] = [];
        const seen = new Set<string>();
        for (const entry of body.orderedIds) {
          if (typeof entry !== 'string' || !isValidId(entry.trim())) {
            return errorJson(
              c,
              400,
              'INVALID_ID',
              'orderedIds must be an array of existing block ids.'
            );
          }
          const id = entry.trim();
          if (seen.has(id)) continue;
          if (!existingIds.has(id)) {
            return errorJson(
              c,
              400,
              'INVALID_ID',
              'orderedIds contains an unknown block id.'
            );
          }
          seen.add(id);
          orderedIds.push(id);
        }
        if (orderedIds.length !== existing.length) {
          return errorJson(
            c,
            400,
            'INVALID_BODY',
            'orderedIds must include every homepage block exactly once.'
          );
        }
        orderedIds.forEach((id, index) => {
          const current = proposed.get(id);
          if (current) current.position = index * 10;
        });
      } else if (Array.isArray(body.items)) {
        if (body.items.length === 0) {
          return errorJson(
            c,
            400,
            'INVALID_BODY',
            'Provide a non-empty `orderedIds` or `items` array.'
          );
        }
        const seen = new Set<string>();
        for (const entry of body.items) {
          if (
            entry === null ||
            typeof entry !== 'object' ||
            Array.isArray(entry)
          ) {
            return errorJson(
              c,
              400,
              'INVALID_BODY',
              'Each reorder item must be { id, position }.'
            );
          }
          const row = entry as Record<string, unknown>;
          const id = typeof row.id === 'string' ? row.id.trim() : '';
          const position = sanitizePosition(row.position);
          if (!isValidId(id) || position === undefined) {
            return errorJson(
              c,
              400,
              'INVALID_BODY',
              'Each reorder item must include a valid id and position.'
            );
          }
          if (!existingIds.has(id)) {
            return errorJson(
              c,
              400,
              'INVALID_ID',
              'Reorder payload contains an unknown block id.'
            );
          }
          if (seen.has(id)) continue;
          seen.add(id);
          const current = proposed.get(id);
          if (current) current.position = position;
        }
      } else {
        return errorJson(
          c,
          400,
          'INVALID_BODY',
          'Provide `orderedIds: string[]` or `items: { id, position }[]`.'
        );
      }

      const proposedRows = [...proposed.values()];
      const invariant = assertFeedLastInvariant(proposedRows);
      if (!invariant.ok) {
        return errorJson(c, 400, 'INVALID_BLOCK_ORDER', invariant.message);
      }

      const now = new Date();
      let updated = 0;
      for (const row of proposedRows) {
        const before = byId.get(row.id);
        if (!before || before.position === row.position) continue;
        const result = await db
          .update(homepageBlocks)
          .set({ position: row.position, updatedAt: now })
          .where(eq(homepageBlocks.id, row.id))
          .returning({ id: homepageBlocks.id });
        if (result.length > 0) updated += 1;
      }

      if (updated === 0) {
        const blocks = await loadAdminHomepageFromDb(db);
        return c.json({
          success: true,
          message: 'Homepage order unchanged.',
          data: blocks,
          meta: { updated: 0 },
        });
      }

      await bustCache(c);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HOMEPAGE_REORDER,
          category: AUDIT_CATEGORIES.HOMEPAGE,
          description: `Reordered store homepage (${updated} blocks)`,
          targetType: AUDIT_TARGET_TYPES.HOMEPAGE_BLOCK,
          targetLabel: 'homepage',
          severity: 'info',
          metadata: { kind: 'homepage_reorder', updated },
        }).then(() => undefined)
      );

      const blocks = await loadAdminHomepageFromDb(db);
      return c.json({
        success: true,
        message: 'Homepage order updated.',
        data: blocks,
        meta: { updated },
      });
    } catch (error) {
      console.error('Error reordering homepage:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to reorder homepage.');
    }
  }
);

// ─── POST /invalidate-cache ───────────────────────────────────────────────────

homepage.post(
  '/invalidate-cache',
  requirePermission(PERMISSIONS.HOMEPAGE_UPDATE),
  async (c) => {
    try {
      await invalidateHomepageCache(c.env.KV);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.HOMEPAGE_UPDATE,
          category: AUDIT_CATEGORIES.HOMEPAGE,
          description: 'Invalidated storefront homepage cache',
          targetType: AUDIT_TARGET_TYPES.HOMEPAGE_BLOCK,
          targetLabel: 'homepage_cache',
          severity: 'info',
          metadata: { kind: 'homepage_cache_invalidate' },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: 'Homepage cache invalidated.',
      });
    } catch (error) {
      console.error('Error invalidating homepage cache:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to invalidate homepage cache.'
      );
    }
  }
);

export default homepage;
