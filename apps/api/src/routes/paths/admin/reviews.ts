import { Hono } from 'hono';
import { and, asc, count, desc, eq, like, or, sql } from 'drizzle-orm';
import { PERMISSIONS } from '@repo/auth/permissions';
import { products, reviews, users } from '@repo/db';
import { getActor, getDb, requirePermission } from '@/middleware/permission';
import { errorJson, type AppEnv } from '@/utils/http/errorJson';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  logAuditFromContext,
} from '@/utils/admin/auditLog';
import { invalidateHomepageCache } from '@/utils/store-ui/homepageContent';
import { resolveProductImagesForClient } from '@/utils/images/productImageHost';

const MAX_ID_LENGTH = 128;
const MAX_SEARCH_LENGTH = 100;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 24;
const SORT_KEYS = [
  'reviewDate',
  'createdAt',
  'rating',
  'reviewerName',
] as const;
type SortKey = (typeof SORT_KEYS)[number];

const reviewsRouter = new Hono<AppEnv>();
reviewsRouter.use('*', requirePermission(PERMISSIONS.REVIEW_READ));
reviewsRouter.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

function validId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  max: number
): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max
    ? parsed
    : null;
}

function parseSearch(value: string | undefined): string | null | false {
  if (value === undefined || value.trim() === '') return null;
  const search = value.trim();
  return search.length <= MAX_SEARCH_LENGTH ? search : false;
}

function parseDate(
  value: string | undefined,
  endOfDay = false
): Date | null | false {
  if (value === undefined || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(
    `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
  );
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? false
    : date;
}

reviewsRouter.get('/', async (c) => {
  const db = getDb(c);
  const query = c.req.query();
  const search = parseSearch(query.search);
  const page = parsePositiveInt(query.page, 1, 1_000_000);
  const pageSize = parsePositiveInt(
    query.pageSize,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const rating =
    query.rating === undefined || query.rating === 'all'
      ? null
      : parsePositiveInt(query.rating, 0, 5);
  const sortBy = (SORT_KEYS as readonly string[]).includes(query.sortBy ?? '')
    ? (query.sortBy as SortKey)
    : 'reviewDate';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
  const startDate = parseDate(query.startDate);
  const endDate = parseDate(query.endDate, true);

  if (search === false) {
    return errorJson(
      c,
      400,
      'INVALID_SEARCH',
      `Search must be ${MAX_SEARCH_LENGTH} characters or fewer.`
    );
  }
  if (page === null || pageSize === null) {
    return errorJson(
      c,
      400,
      'INVALID_PAGINATION',
      'Page and pageSize must be valid positive integers.'
    );
  }
  if (query.rating !== undefined && query.rating !== 'all' && rating === null) {
    return errorJson(
      c,
      400,
      'INVALID_RATING',
      'Rating must be between 1 and 5.'
    );
  }
  if (
    query.isAe !== undefined &&
    query.isAe !== 'all' &&
    query.isAe !== 'true' &&
    query.isAe !== 'false'
  ) {
    return errorJson(
      c,
      400,
      'INVALID_SOURCE_FILTER',
      'isAe must be true, false, or all.'
    );
  }
  if (
    query.hasImages !== undefined &&
    query.hasImages !== 'all' &&
    query.hasImages !== 'true' &&
    query.hasImages !== 'false'
  ) {
    return errorJson(
      c,
      400,
      'INVALID_IMAGE_FILTER',
      'hasImages must be true, false, or all.'
    );
  }
  if (query.productId && !validId(query.productId)) {
    return errorJson(c, 400, 'INVALID_PRODUCT_ID', 'Product id is invalid.');
  }
  if (startDate === false || endDate === false) {
    return errorJson(
      c,
      400,
      'INVALID_DATE_FILTER',
      'Dates must be valid YYYY-MM-DD values.'
    );
  }
  if (startDate && endDate && startDate > endDate) {
    return errorJson(
      c,
      400,
      'INVALID_DATE_RANGE',
      'Start date must be on or before end date.'
    );
  }
  if (
    query.sortOrder !== undefined &&
    query.sortOrder !== 'asc' &&
    query.sortOrder !== 'desc'
  ) {
    return errorJson(
      c,
      400,
      'INVALID_SORT_ORDER',
      'Sort order must be asc or desc.'
    );
  }
  if (
    query.sortBy &&
    !(SORT_KEYS as readonly string[]).includes(query.sortBy)
  ) {
    return errorJson(
      c,
      400,
      'INVALID_SORT_FIELD',
      'The requested review sort field is not supported.'
    );
  }

  const filters = [];
  if (search) {
    const pattern = `%${search}%`;
    filters.push(
      or(like(reviews.reviewerName, pattern), like(reviews.comment, pattern))!
    );
  }
  if (rating !== null) filters.push(eq(reviews.rating, rating));
  if (query.isAe === 'true') filters.push(eq(reviews.isAe, true));
  if (query.isAe === 'false') filters.push(eq(reviews.isAe, false));
  if (query.productId) filters.push(eq(reviews.productId, query.productId));
  if (query.hasImages === 'true') {
    filters.push(
      sql`json_array_length(coalesce(${reviews.imageUrls}, '[]')) > 0`
    );
  }
  if (query.hasImages === 'false') {
    filters.push(
      sql`json_array_length(coalesce(${reviews.imageUrls}, '[]')) = 0`
    );
  }
  const dateColumn = sql`coalesce(${reviews.reviewDate}, ${reviews.createdAt})`;
  if (startDate) {
    filters.push(
      sql`${dateColumn} >= ${Math.floor(startDate.getTime() / 1000)}`
    );
  }
  if (endDate) {
    filters.push(sql`${dateColumn} <= ${Math.floor(endDate.getTime() / 1000)}`);
  }

  const where = filters.length ? and(...filters) : undefined;
  const pageOffset = (page - 1) * pageSize;
  const orderColumn = {
    reviewDate: dateColumn,
    createdAt: reviews.createdAt,
    rating: reviews.rating,
    reviewerName: reviews.reviewerName,
  }[sortBy];
  const order = sortOrder === 'asc' ? asc(orderColumn) : desc(orderColumn);
  try {
    const result = await (async () => {
      const [[totalRow], [filteredRow], rows] = await Promise.all([
        db.select({ total: count() }).from(reviews),
        db.select({ total: count() }).from(reviews).where(where),
        db
          .select({
            id: reviews.id,
            productId: reviews.productId,
            reviewerId: reviews.reviewerId,
            reviewerName: reviews.reviewerName,
            rating: reviews.rating,
            comment: reviews.comment,
            imageUrls: reviews.imageUrls,
            isAe: reviews.isAe,
            sourceReviewId: reviews.sourceReviewId,
            reviewDate: reviews.reviewDate,
            createdAt: reviews.createdAt,
            accountName: users.name,
          })
          .from(reviews)
          .leftJoin(users, eq(reviews.reviewerId, users.id))
          .where(where)
          .orderBy(order, desc(reviews.id))
          .limit(pageSize)
          .offset(pageOffset),
      ]);

      const filteredTotal = filteredRow?.total ?? 0;
      return {
        success: true as const,
        data: rows.map((review) => ({
          ...review,
          comment: review.comment ?? '',
          imageUrls: Array.isArray(review.imageUrls)
            ? review.imageUrls.filter(
                (url): url is string => typeof url === 'string'
              )
            : [],
          isAe: Boolean(review.isAe),
          reviewDate: (review.reviewDate ?? review.createdAt).toISOString(),
          createdAt: review.createdAt.toISOString(),
        })),
        meta: {
          totalReviews: totalRow?.total ?? 0,
          filteredTotal,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(filteredTotal / pageSize)),
        },
      };
    })();
    return c.json(result);
  } catch (error) {
    console.error('Error listing admin reviews:', error);
    return errorJson(
      c,
      500,
      'INTERNAL_ERROR',
      'Unable to load reviews right now. Please try again.'
    );
  }
});

reviewsRouter.get('/:id', async (c) => {
  const db = getDb(c);
  const id = c.req.param('id');
  if (!validId(id)) {
    return errorJson(c, 400, 'INVALID_REVIEW_ID', 'Review id is invalid.');
  }

  try {
    const [row] = await db
      .select({
        id: reviews.id,
        productId: reviews.productId,
        reviewerId: reviews.reviewerId,
        reviewerName: reviews.reviewerName,
        rating: reviews.rating,
        comment: reviews.comment,
        imageUrls: reviews.imageUrls,
        isAe: reviews.isAe,
        sourceReviewId: reviews.sourceReviewId,
        reviewDate: reviews.reviewDate,
        createdAt: reviews.createdAt,
        accountName: users.name,
        productName: products.name,
        productSlug: products.slug,
        productImages: products.images,
        defaultPrice: products.defaultPrice,
        defaultEstProfit: products.defaultEstProfit,
      })
      .from(reviews)
      .innerJoin(products, eq(reviews.productId, products.id))
      .leftJoin(users, eq(reviews.reviewerId, users.id))
      .where(eq(reviews.id, id))
      .limit(1);

    if (!row) {
      return errorJson(c, 404, 'REVIEW_NOT_FOUND', 'Review not found.');
    }
    const images = Array.isArray(row.productImages) ? row.productImages : [];
    const result = {
      success: true as const,
      data: {
        id: row.id,
        productId: row.productId,
        reviewerId: row.reviewerId,
        reviewerName: row.reviewerName,
        rating: row.rating,
        comment: row.comment ?? '',
        imageUrls: Array.isArray(row.imageUrls)
          ? row.imageUrls.filter(
              (url): url is string => typeof url === 'string'
            )
          : [],
        isAe: Boolean(row.isAe),
        sourceReviewId: row.sourceReviewId,
        reviewDate: (row.reviewDate ?? row.createdAt).toISOString(),
        createdAt: row.createdAt.toISOString(),
        accountName: row.accountName,
        product: {
          id: row.productId,
          slug: row.productSlug,
          name: row.productName,
          images: resolveProductImagesForClient(images, c.env, {
            origin: new URL(c.req.url).origin,
          }),
          defaultPrice: row.defaultPrice,
          defaultEstProfit: row.defaultEstProfit,
        },
      },
    };
    return c.json(result);
  } catch (error) {
    console.error('Error loading admin review details:', error);
    return errorJson(
      c,
      500,
      'INTERNAL_ERROR',
      'Unable to load review details right now. Please try again.'
    );
  }
});

reviewsRouter.get('/products', async (c) => {
  const db = getDb(c);
  const search = parseSearch(c.req.query('search'));
  if (search === false) {
    return errorJson(
      c,
      400,
      'INVALID_SEARCH',
      `Search must be ${MAX_SEARCH_LENGTH} characters or fewer.`
    );
  }

  const query = search ?? '';
  try {
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        reviewCount: products.reviewCount,
        averageReview: products.averageReview,
      })
      .from(products)
      .where(
        query
          ? or(
              like(products.name, `%${query}%`),
              like(products.slug, `%${query}%`)
            )
          : undefined
      )
      .orderBy(asc(products.name), asc(products.id))
      .limit(20);
    return c.json({ success: true as const, data: rows });
  } catch (error) {
    console.error('Error searching products for review filters:', error);
    return errorJson(
      c,
      500,
      'INTERNAL_ERROR',
      'Unable to search products right now. Please try again.'
    );
  }
});

reviewsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.REVIEW_DELETE),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);
    const id = c.req.param('id');
    if (!validId(id)) {
      return errorJson(c, 400, 'INVALID_REVIEW_ID', 'Review id is invalid.');
    }

    try {
      const [review] = await db
        .select({
          id: reviews.id,
          productId: reviews.productId,
          reviewerName: reviews.reviewerName,
        })
        .from(reviews)
        .where(eq(reviews.id, id))
        .limit(1);
      if (!review) {
        return errorJson(
          c,
          404,
          'REVIEW_NOT_FOUND',
          'This review no longer exists.'
        );
      }

      await db.batch([
        db.delete(reviews).where(eq(reviews.id, id)),
        db
          .update(products)
          .set({
            reviewCount: sql`(SELECT COUNT(*) FROM reviews WHERE product_id = ${review.productId})`,
            averageReview: sql`(SELECT AVG(rating) FROM reviews WHERE product_id = ${review.productId})`,
            updatedAt: new Date(),
          })
          .where(eq(products.id, review.productId)),
      ]);

      c.executionCtx.waitUntil(
        Promise.all([
          invalidateHomepageCache(c.env.KV),
          logAuditFromContext(c, {
            action: AUDIT_ACTIONS.REVIEW_DELETE,
            category: AUDIT_CATEGORIES.REVIEW,
            description: `Deleted review by "${review.reviewerName}"`,
            targetType: AUDIT_TARGET_TYPES.REVIEW,
            targetId: review.id,
            targetLabel: review.reviewerName,
            metadata: {
              productId: review.productId,
              deletedBy: {
                id: actor.id,
                name: actor.name,
                email: actor.email,
                role: actor.role,
              },
            },
          }).then(() => undefined),
        ]).then(() => undefined)
      );

      c.header('Cache-Control', 'no-store');
      return c.json({
        success: true,
        message: 'Review deleted successfully.',
        data: { id: review.id, productId: review.productId },
      });
    } catch (error) {
      console.error('Error deleting admin review:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Unable to delete this review. Please try again.'
      );
    }
  }
);

reviewsRouter.notFound((c) =>
  errorJson(c, 404, 'NOT_FOUND', 'Review management endpoint not found.')
);

export default reviewsRouter;
