import { Hono } from 'hono';
import { and, asc, count, desc, eq, like, or, sql, type SQL } from 'drizzle-orm';
import { PERMISSIONS } from '@repo/auth/permissions';
import { userPermissions, users, type Database } from '@repo/db';
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

type UserRole = 'customer' | 'admin' | 'owner';
type UserStatus = 'active' | 'banned' | 'deleted';
type UserGender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

const ALL_ROLES: UserRole[] = ['customer', 'admin', 'owner'];
const ALL_STATUSES: UserStatus[] = ['active', 'banned', 'deleted'];
const ALL_GENDERS: UserGender[] = [
  'male',
  'female',
  'other',
  'prefer_not_to_say',
];
const SORTABLE_COLUMNS = [
  'name',
  'email',
  'role',
  'createdAt',
  'updatedAt',
  'lastActiveAt',
  'lastLoginAt',
] as const;
type SortColumn = (typeof SORTABLE_COLUMNS)[number];

/** Fields that admins may update via PATCH /:id (never role / stats / ban / delete). */
const EDITABLE_FIELDS = [
  'name',
  'email',
  'emailVerified',
  'image',
  'firstName',
  'lastName',
  'dateOfBirth',
  'gender',
  'phone',
  'phoneVerified',
  'emailNotifications',
  'smsNotifications',
  'currency',
  'locale',
  'timezone',
  'adminNotes',
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

const MAX_ID_LENGTH = 128;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const MAX_BAN_REASON_LENGTH = 500;
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 120;
const MAX_FIRST_LAST_NAME_LENGTH = 80;
const MAX_PHONE_LENGTH = 32;
const MAX_IMAGE_LENGTH = 2048;
const MAX_CURRENCY_LENGTH = 8;
const MAX_LOCALE_LENGTH = 32;
const MAX_TIMEZONE_LENGTH = 64;
const MAX_ADMIN_NOTES_LENGTH = 2000;
const MIN_BIRTH_YEAR = 1900;

function isOwner(role: string | null | undefined): boolean {
  return role === 'owner';
}

function isValidUserId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sanitizeRole(value: unknown): UserRole | null {
  if (typeof value !== 'string') return null;
  const role = value.trim().toLowerCase() as UserRole;
  return ALL_ROLES.includes(role) ? role : null;
}

function sanitizeStatus(value: unknown): UserStatus | null {
  if (typeof value !== 'string') return null;
  const status = value.trim().toLowerCase() as UserStatus;
  return ALL_STATUSES.includes(status) ? status : null;
}

function sanitizeSearch(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const search = value.trim();
  return search.length > 0 && search.length <= 100 ? search : null;
}

function sanitizeSortBy(value: unknown): SortColumn {
  if (typeof value !== 'string') return 'createdAt';
  return (SORTABLE_COLUMNS as readonly string[]).includes(value)
    ? (value as SortColumn)
    : 'createdAt';
}

/** Compact payload for list cards. */
function serializeUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    role: user.role as UserRole,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    isBanned: user.isBanned,
    isDeleted: user.isDeleted,
    bannedReason: user.bannedReason,
    bannedAt: toIso(user.bannedAt),
    bannedBy: user.bannedBy,
    deletedAt: toIso(user.deletedAt),
    lastLoginAt: toIso(user.lastLoginAt),
    lastLoginIp: user.lastLoginIp,
    lastActiveAt: toIso(user.lastActiveAt),
    createdAt: toIso(user.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(user.updatedAt) ?? new Date(0).toISOString(),
  };
}

/** Full payload for view / edit pages. */
function serializeUserDetail(user: typeof users.$inferSelect) {
  return {
    ...serializeUser(user),
    dateOfBirth: toIso(user.dateOfBirth),
    gender: (user.gender as UserGender | null) ?? null,
    phoneVerified: user.phoneVerified,
    defaultAddressId: user.defaultAddressId,
    emailNotifications: user.emailNotifications,
    smsNotifications: user.smsNotifications,
    currency: user.currency,
    locale: user.locale,
    timezone: user.timezone,
    loyaltyPoints: user.loyaltyPoints,
    ragiCoins: user.ragiCoins,
    referralCode: user.referralCode,
    referredBy: user.referredBy,
    totalSpent: user.totalSpent,
    totalOrders: user.totalOrders,
    averageOrderValue: user.averageOrderValue,
    isVipUser: user.isVipUser,
    isVerifiedSeller: user.isVerifiedSeller,
    adminNotes: user.adminNotes,
  };
}

/**
 * Non-owners may only mutate customer accounts (same policy as ban/delete).
 * Owners may act on anyone except they still cannot use this endpoint for role changes.
 */
function canActorMutateTarget(
  actorRole: string,
  target: { id: string; role: string },
  actorId: string
): { ok: true } | { ok: false; code: string; message: string } {
  if (isOwner(target.role) && target.id !== actorId) {
    // Allow owners to edit other owners' profile fields; non-owners never may.
    if (!isOwner(actorRole)) {
      return {
        ok: false,
        code: 'CANNOT_MODIFY_OWNER',
        message: 'Cannot modify an owner account.',
      };
    }
  }

  if (!isOwner(actorRole) && target.role === 'admin' && target.id !== actorId) {
    return {
      ok: false,
      code: 'CANNOT_MODIFY_ADMIN',
      message: 'Only owners can modify other admin accounts.',
    };
  }

  return { ok: true };
}

type ParsedUpdate =
  | { ok: true; updates: Partial<Record<EditableField, unknown>>; changes: Record<string, { from: unknown; to: unknown }> }
  | { ok: false; code: string; message: string };

function parseUserUpdate(
  body: Record<string, unknown>,
  current: typeof users.$inferSelect
): ParsedUpdate {
  // Reject unknown keys early so clients cannot probe for writable metadata.
  const unknownKeys = Object.keys(body).filter(
    (key) => !(EDITABLE_FIELDS as readonly string[]).includes(key)
  );
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      code: 'UNKNOWN_FIELDS',
      message: `Unknown or non-editable fields: ${unknownKeys.slice(0, 8).join(', ')}.`,
    };
  }

  const updates: Partial<Record<EditableField, unknown>> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  const setChange = (field: EditableField, from: unknown, to: unknown) => {
    if (from === to) return;
    // Normalize Date equality for timestamps
    if (from instanceof Date && to instanceof Date) {
      if (from.getTime() === to.getTime()) return;
    }
    if (
      (from instanceof Date || to instanceof Date) &&
      toIso(from as Date | null) === toIso(to as Date | null)
    ) {
      return;
    }
    updates[field] = to;
    changes[field] = {
      from: from instanceof Date ? toIso(from) : from,
      to: to instanceof Date ? toIso(to) : to,
    };
  };

  if ('name' in body) {
    if (typeof body.name !== 'string') {
      return { ok: false, code: 'INVALID_NAME', message: 'Name must be a string.' };
    }
    const name = body.name.trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
      return {
        ok: false,
        code: 'INVALID_NAME',
        message: `Name must be between 1 and ${MAX_NAME_LENGTH} characters.`,
      };
    }
    setChange('name', current.name, name);
  }

  if ('email' in body) {
    if (typeof body.email !== 'string') {
      return { ok: false, code: 'INVALID_EMAIL', message: 'Email must be a string.' };
    }
    const email = body.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      return {
        ok: false,
        code: 'INVALID_EMAIL',
        message: 'Please provide a valid email address.',
      };
    }
    setChange('email', current.email, email);
  }

  if ('emailVerified' in body) {
    if (typeof body.emailVerified !== 'boolean') {
      return {
        ok: false,
        code: 'INVALID_EMAIL_VERIFIED',
        message: 'emailVerified must be a boolean.',
      };
    }
    setChange('emailVerified', current.emailVerified, body.emailVerified);
  }

  if ('image' in body) {
    if (body.image !== null && typeof body.image !== 'string') {
      return {
        ok: false,
        code: 'INVALID_IMAGE',
        message: 'Image must be a URL string or null.',
      };
    }
    const image =
      body.image === null || (typeof body.image === 'string' && body.image.trim() === '')
        ? null
        : (body.image as string).trim();
    if (image !== null) {
      if (image.length > MAX_IMAGE_LENGTH) {
        return {
          ok: false,
          code: 'INVALID_IMAGE',
          message: `Image URL must be at most ${MAX_IMAGE_LENGTH} characters.`,
        };
      }
      if (!isValidHttpUrl(image)) {
        return {
          ok: false,
          code: 'INVALID_IMAGE',
          message: 'Image must be a valid http(s) URL.',
        };
      }
    }
    setChange('image', current.image, image);
  }

  if ('firstName' in body) {
    if (body.firstName !== null && typeof body.firstName !== 'string') {
      return {
        ok: false,
        code: 'INVALID_FIRST_NAME',
        message: 'firstName must be a string or null.',
      };
    }
    const firstName =
      body.firstName === null ||
      (typeof body.firstName === 'string' && body.firstName.trim() === '')
        ? null
        : (body.firstName as string).trim().replace(/\s+/g, ' ');
    if (firstName !== null && firstName.length > MAX_FIRST_LAST_NAME_LENGTH) {
      return {
        ok: false,
        code: 'INVALID_FIRST_NAME',
        message: `firstName must be at most ${MAX_FIRST_LAST_NAME_LENGTH} characters.`,
      };
    }
    setChange('firstName', current.firstName, firstName);
  }

  if ('lastName' in body) {
    if (body.lastName !== null && typeof body.lastName !== 'string') {
      return {
        ok: false,
        code: 'INVALID_LAST_NAME',
        message: 'lastName must be a string or null.',
      };
    }
    const lastName =
      body.lastName === null ||
      (typeof body.lastName === 'string' && body.lastName.trim() === '')
        ? null
        : (body.lastName as string).trim().replace(/\s+/g, ' ');
    if (lastName !== null && lastName.length > MAX_FIRST_LAST_NAME_LENGTH) {
      return {
        ok: false,
        code: 'INVALID_LAST_NAME',
        message: `lastName must be at most ${MAX_FIRST_LAST_NAME_LENGTH} characters.`,
      };
    }
    setChange('lastName', current.lastName, lastName);
  }

  if ('dateOfBirth' in body) {
    if (body.dateOfBirth !== null && typeof body.dateOfBirth !== 'string') {
      return {
        ok: false,
        code: 'INVALID_DATE_OF_BIRTH',
        message: 'dateOfBirth must be an ISO date string or null.',
      };
    }
    let dateOfBirth: Date | null = null;
    if (typeof body.dateOfBirth === 'string' && body.dateOfBirth.trim() !== '') {
      const parsed = new Date(body.dateOfBirth.trim());
      if (Number.isNaN(parsed.getTime())) {
        return {
          ok: false,
          code: 'INVALID_DATE_OF_BIRTH',
          message: 'dateOfBirth is not a valid date.',
        };
      }
      const now = new Date();
      if (parsed.getTime() > now.getTime()) {
        return {
          ok: false,
          code: 'INVALID_DATE_OF_BIRTH',
          message: 'dateOfBirth cannot be in the future.',
        };
      }
      if (parsed.getUTCFullYear() < MIN_BIRTH_YEAR) {
        return {
          ok: false,
          code: 'INVALID_DATE_OF_BIRTH',
          message: `dateOfBirth year must be ${MIN_BIRTH_YEAR} or later.`,
        };
      }
      dateOfBirth = parsed;
    }
    setChange('dateOfBirth', current.dateOfBirth, dateOfBirth);
  }

  if ('gender' in body) {
    if (body.gender !== null && typeof body.gender !== 'string') {
      return {
        ok: false,
        code: 'INVALID_GENDER',
        message: 'gender must be a string or null.',
      };
    }
    const gender =
      body.gender === null ||
      (typeof body.gender === 'string' && body.gender.trim() === '')
        ? null
        : (body.gender as string).trim().toLowerCase();
    if (gender !== null && !(ALL_GENDERS as readonly string[]).includes(gender)) {
      return {
        ok: false,
        code: 'INVALID_GENDER',
        message: `gender must be one of: ${ALL_GENDERS.join(', ')}.`,
      };
    }
    setChange('gender', current.gender, gender);
  }

  if ('phone' in body) {
    if (body.phone !== null && typeof body.phone !== 'string') {
      return {
        ok: false,
        code: 'INVALID_PHONE',
        message: 'phone must be a string or null.',
      };
    }
    const phone =
      body.phone === null ||
      (typeof body.phone === 'string' && body.phone.trim() === '')
        ? null
        : (body.phone as string).trim().replace(/\s+/g, ' ');
    if (phone !== null) {
      if (phone.length > MAX_PHONE_LENGTH) {
        return {
          ok: false,
          code: 'INVALID_PHONE',
          message: `phone must be at most ${MAX_PHONE_LENGTH} characters.`,
        };
      }
      // Allow international-ish numbers; reject control chars / letters.
      if (!/^[+]?[\d().\-\s]{5,}$/.test(phone)) {
        return {
          ok: false,
          code: 'INVALID_PHONE',
          message: 'phone does not look like a valid phone number.',
        };
      }
    }
    setChange('phone', current.phone, phone);
  }

  if ('phoneVerified' in body) {
    if (typeof body.phoneVerified !== 'boolean') {
      return {
        ok: false,
        code: 'INVALID_PHONE_VERIFIED',
        message: 'phoneVerified must be a boolean.',
      };
    }
    setChange('phoneVerified', current.phoneVerified, body.phoneVerified);
  }

  if ('emailNotifications' in body) {
    if (typeof body.emailNotifications !== 'boolean') {
      return {
        ok: false,
        code: 'INVALID_EMAIL_NOTIFICATIONS',
        message: 'emailNotifications must be a boolean.',
      };
    }
    setChange(
      'emailNotifications',
      current.emailNotifications,
      body.emailNotifications
    );
  }

  if ('smsNotifications' in body) {
    if (typeof body.smsNotifications !== 'boolean') {
      return {
        ok: false,
        code: 'INVALID_SMS_NOTIFICATIONS',
        message: 'smsNotifications must be a boolean.',
      };
    }
    setChange('smsNotifications', current.smsNotifications, body.smsNotifications);
  }

  if ('currency' in body) {
    if (typeof body.currency !== 'string') {
      return {
        ok: false,
        code: 'INVALID_CURRENCY',
        message: 'currency must be a string.',
      };
    }
    const currency = body.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || currency.length > MAX_CURRENCY_LENGTH) {
      return {
        ok: false,
        code: 'INVALID_CURRENCY',
        message: 'currency must be a 3-letter ISO code (e.g. USD).',
      };
    }
    setChange('currency', current.currency, currency);
  }

  if ('locale' in body) {
    if (typeof body.locale !== 'string') {
      return {
        ok: false,
        code: 'INVALID_LOCALE',
        message: 'locale must be a string.',
      };
    }
    const locale = body.locale.trim();
    if (
      locale.length < 2 ||
      locale.length > MAX_LOCALE_LENGTH ||
      !/^[A-Za-z]{2,3}([_-][A-Za-z0-9]+)*$/.test(locale)
    ) {
      return {
        ok: false,
        code: 'INVALID_LOCALE',
        message: 'locale must look like a BCP 47 tag (e.g. en-US).',
      };
    }
    setChange('locale', current.locale, locale);
  }

  if ('timezone' in body) {
    if (typeof body.timezone !== 'string') {
      return {
        ok: false,
        code: 'INVALID_TIMEZONE',
        message: 'timezone must be a string.',
      };
    }
    const timezone = body.timezone.trim();
    if (timezone.length === 0 || timezone.length > MAX_TIMEZONE_LENGTH) {
      return {
        ok: false,
        code: 'INVALID_TIMEZONE',
        message: `timezone must be between 1 and ${MAX_TIMEZONE_LENGTH} characters.`,
      };
    }
    if (!isValidTimezone(timezone)) {
      return {
        ok: false,
        code: 'INVALID_TIMEZONE',
        message: 'timezone must be a valid IANA timezone (e.g. America/New_York).',
      };
    }
    setChange('timezone', current.timezone, timezone);
  }

  if ('adminNotes' in body) {
    if (body.adminNotes !== null && typeof body.adminNotes !== 'string') {
      return {
        ok: false,
        code: 'INVALID_ADMIN_NOTES',
        message: 'adminNotes must be a string or null.',
      };
    }
    const adminNotes =
      body.adminNotes === null ||
      (typeof body.adminNotes === 'string' && body.adminNotes.trim() === '')
        ? null
        : (body.adminNotes as string).trim();
    if (adminNotes !== null && adminNotes.length > MAX_ADMIN_NOTES_LENGTH) {
      return {
        ok: false,
        code: 'INVALID_ADMIN_NOTES',
        message: `adminNotes must be at most ${MAX_ADMIN_NOTES_LENGTH} characters.`,
      };
    }
    setChange('adminNotes', current.adminNotes, adminNotes);
  }

  if (Object.keys(updates).length === 0) {
    return {
      ok: false,
      code: 'NO_CHANGES',
      message: 'No valid changes were provided.',
    };
  }

  return { ok: true, updates, changes };
}

async function resolveActorCapabilities(
  db: Database,
  actorId: string,
  role: string
) {
  if (isOwner(role)) {
    return { canBan: true, canManage: true, canDelete: true };
  }

  const [canBan, canManage, canDelete] = await Promise.all([
    adminHasPermission(db, actorId, PERMISSIONS.USER_BAN),
    adminHasPermission(db, actorId, PERMISSIONS.USER_MANAGE),
    adminHasPermission(db, actorId, PERMISSIONS.USER_DELETE),
  ]);

  return { canBan, canManage, canDelete };
}

function buildWhere(
  search: string | null,
  role: UserRole | null,
  status: UserStatus | null
): SQL | undefined {
  const conditions: SQL[] = [];

  // Default: hide soft-deleted accounts unless explicitly requested.
  if (status === 'deleted') {
    conditions.push(eq(users.isDeleted, true));
  } else if (status === 'banned') {
    conditions.push(eq(users.isBanned, true), eq(users.isDeleted, false));
  } else if (status === 'active') {
    conditions.push(eq(users.isBanned, false), eq(users.isDeleted, false));
  } else {
    conditions.push(eq(users.isDeleted, false));
  }

  if (search) {
    const escaped = search
      .toLowerCase()
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    const likePattern = `%${escaped}%`;
    conditions.push(
      or(
        like(sql`lower(${users.name})`, likePattern),
        like(sql`lower(${users.email})`, likePattern),
        like(sql`lower(${users.id})`, likePattern)
      )!
    );
  }

  if (role) {
    conditions.push(eq(users.role, role));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function buildOrderBy(sortBy: SortColumn, sortOrder: 'asc' | 'desc') {
  const columnMap = {
    name: users.name,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
    lastActiveAt: users.lastActiveAt,
    lastLoginAt: users.lastLoginAt,
  } as const;

  const column = columnMap[sortBy];
  return sortOrder === 'asc' ? asc(column) : desc(column);
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

async function listUsersHandler(c: AppContext) {
  const actor = getActor(c);
  const db = getDb(c);

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      parseInt(c.req.query('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) ||
        DEFAULT_PAGE_SIZE
    )
  );
  const search = sanitizeSearch(c.req.query('search'));
  const role = sanitizeRole(c.req.query('role'));
  const status = sanitizeStatus(c.req.query('status'));
  const sortBy = sanitizeSortBy(c.req.query('sortBy'));
  const sortOrder = c.req.query('sortOrder') === 'asc' ? 'asc' : 'desc';

  try {
    const where = buildWhere(search, role, status);
    const orderBy = buildOrderBy(sortBy, sortOrder);
    const capabilities = await resolveActorCapabilities(
      db,
      actor.id,
      actor.role
    );

    const [totalResult, rows] = await Promise.all([
      db.select({ value: count() }).from(users).where(where),
      db
        .select()
        .from(users)
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(totalResult[0]?.value ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

    return c.json({
      success: true,
      data: rows.map(serializeUser),
      meta: {
        currentUserId: actor.id,
        currentUserRole: actor.role,
        canBan: capabilities.canBan,
        canDelete: capabilities.canDelete,
        canManage: capabilities.canManage,
        total,
        page,
        pageSize,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Error listing users:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load users.');
  }
}

const usersRouter = new Hono<AppEnv>();

// All routes require admin authentication
usersRouter.use('*', requireAdminMiddleware);

// ─── GET /all — paginated list (primary; matches /api/admins/all style) ───────
usersRouter.get('/all', listUsersHandler);

// Alias for clients that call the mount root
usersRouter.get('/', listUsersHandler);

// ─── GET /stats — aggregate counts by role / status ───────────────────────────
usersRouter.get('/stats', async (c) => {
  const db = getDb(c);

  try {
    const [totalResult, roleResults, bannedResult, deletedResult] =
      await Promise.all([
        db
          .select({ value: count() })
          .from(users)
          .where(eq(users.isDeleted, false)),
        db
          .select({ role: users.role, value: count() })
          .from(users)
          .where(eq(users.isDeleted, false))
          .groupBy(users.role),
        db
          .select({ value: count() })
          .from(users)
          .where(and(eq(users.isDeleted, false), eq(users.isBanned, true))),
        db
          .select({ value: count() })
          .from(users)
          .where(eq(users.isDeleted, true)),
      ]);

    const total = Number(totalResult[0]?.value ?? 0);
    const banned = Number(bannedResult[0]?.value ?? 0);
    const deleted = Number(deletedResult[0]?.value ?? 0);
    const byRole: Record<string, number> = {
      customer: 0,
      admin: 0,
      owner: 0,
    };
    for (const row of roleResults) {
      byRole[row.role] = Number(row.value);
    }

    return c.json({
      success: true,
      data: {
        total,
        active: Math.max(0, total - banned),
        banned,
        deleted,
        byRole,
      },
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load stats.');
  }
});

// ─── GET /:id — single user (full detail) ─────────────────────────────────────
usersRouter.get('/:id', async (c) => {
  const actor = getActor(c);
  const db = getDb(c);

  const targetId = c.req.param('id')?.trim() ?? '';
  if (!isValidUserId(targetId)) {
    return errorJson(c, 400, 'INVALID_ID', 'Invalid user id.');
  }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);

    if (!user) {
      return errorJson(c, 404, 'USER_NOT_FOUND', 'User not found.');
    }

    const capabilities = await resolveActorCapabilities(
      db,
      actor.id,
      actor.role
    );

    const isSelf = user.id === actor.id;
    const mutateCheck = canActorMutateTarget(actor.role, user, actor.id);
    // Profile edits require manage (or ban/delete as support staff) + target policy.
    const canEdit =
      !user.isDeleted &&
      mutateCheck.ok &&
      (capabilities.canManage ||
        capabilities.canBan ||
        capabilities.canDelete);

    return c.json({
      success: true,
      data: serializeUserDetail(user),
      meta: {
        canBan: capabilities.canBan,
        canManage: capabilities.canManage,
        canDelete: capabilities.canDelete,
        canEdit,
        isSelf,
        editableFields: EDITABLE_FIELDS,
      },
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load user.');
  }
});

// ─── PATCH /:id — update profile fields (not role / stats / ban state) ────────
// Role promotion lives on /api/admins. Ban/delete have dedicated endpoints.
usersRouter.patch(
  '/:id',
  requireAnyPermission(
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.USER_BAN,
    PERMISSIONS.USER_DELETE
  ),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);

    const targetId = c.req.param('id')?.trim() ?? '';
    if (!isValidUserId(targetId)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid user id.');
    }

    const parsedBody = await readJsonObject(c);
    if (!parsedBody.ok) return parsedBody.response;

    try {
      const [target] = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);

      if (!target) {
        return errorJson(c, 404, 'USER_NOT_FOUND', 'User not found.');
      }

      if (target.isDeleted) {
        return errorJson(
          c,
          409,
          'USER_DELETED',
          'Cannot edit a deleted user. Restore the account first.'
        );
      }

      const mutateCheck = canActorMutateTarget(actor.role, target, actor.id);
      if (!mutateCheck.ok) {
        return errorJson(c, 403, mutateCheck.code, mutateCheck.message);
      }

      const parsed = parseUserUpdate(parsedBody.body, target);
      if (!parsed.ok) {
        const status =
          parsed.code === 'NO_CHANGES' || parsed.code === 'UNKNOWN_FIELDS'
            ? 400
            : 400;
        return errorJson(c, status, parsed.code, parsed.message);
      }

      // Email uniqueness (case-insensitive) when changing email.
      if (
        typeof parsed.updates.email === 'string' &&
        parsed.updates.email !== target.email
      ) {
        const newEmail = parsed.updates.email as string;
        const [conflict] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, newEmail))
          .limit(1);

        if (conflict && conflict.id !== target.id) {
          return errorJson(
            c,
            409,
            'EMAIL_IN_USE',
            'Another account already uses this email address.'
          );
        }
      }

      // If phone is cleared, also clear phoneVerified when not explicitly set.
      if (
        'phone' in parsed.updates &&
        parsed.updates.phone === null &&
        !('phoneVerified' in parsed.updates)
      ) {
        if (target.phoneVerified) {
          parsed.updates.phoneVerified = false;
          parsed.changes.phoneVerified = {
            from: target.phoneVerified,
            to: false,
          };
        }
      }

      const now = new Date();
      const updated = await db
        .update(users)
        .set({
          ...(parsed.updates as Record<string, unknown>),
          updatedAt: now,
        })
        .where(
          and(
            eq(users.id, targetId),
            eq(users.isDeleted, false),
            eq(users.email, target.email)
          )
        )
        .returning();

      if (updated.length === 0) {
        return errorJson(
          c,
          409,
          'CONFLICT',
          'Could not update user. They may have changed — refresh and try again.'
        );
      }

      const updatedUser = updated[0];
      const changedKeys = Object.keys(parsed.changes);
      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.USER_UPDATE,
          category: AUDIT_CATEGORIES.USER,
          description: `Updated user ${updatedUser.name} (${updatedUser.email}): ${changedKeys.join(', ')}`,
          targetType: AUDIT_TARGET_TYPES.USER,
          targetId: updatedUser.id,
          targetLabel: updatedUser.email,
          severity:
            'email' in parsed.changes ||
            'emailVerified' in parsed.changes ||
            'phoneVerified' in parsed.changes
              ? 'warning'
              : 'info',
          changes: parsed.changes,
          metadata: {
            fields: changedKeys,
          },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `Updated ${changedKeys.length} field${changedKeys.length === 1 ? '' : 's'} for ${updatedUser.name}.`,
        data: serializeUserDetail(updatedUser),
        meta: {
          changedFields: changedKeys,
        },
      });
    } catch (error) {
      console.error('Error updating user:', error);
      const message =
        error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('unique') || message.includes('constraint')) {
        return errorJson(
          c,
          409,
          'EMAIL_IN_USE',
          'Another account already uses this email address.'
        );
      }
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to update user.');
    }
  }
);

// ─── PATCH /:id/ban — ban or unban (USER_BAN) ─────────────────────────────────
usersRouter.patch(
  '/:id/ban',
  requireAnyPermission(PERMISSIONS.USER_BAN, PERMISSIONS.USER_MANAGE),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);

    const targetId = c.req.param('id')?.trim() ?? '';
    if (!isValidUserId(targetId)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid user id.');
    }

    const parsedBody = await readJsonObject(c);
    if (!parsedBody.ok) return parsedBody.response;

    const banned = parsedBody.body.banned === true;
    const rawReason =
      typeof parsedBody.body.reason === 'string'
        ? parsedBody.body.reason.trim()
        : '';

    if (banned && rawReason.length === 0) {
      return errorJson(
        c,
        400,
        'MISSING_REASON',
        'A ban reason is required.'
      );
    }

    if (rawReason.length > MAX_BAN_REASON_LENGTH) {
      return errorJson(
        c,
        400,
        'REASON_TOO_LONG',
        `Ban reason must be at most ${MAX_BAN_REASON_LENGTH} characters.`
      );
    }

    try {
      const [target] = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);

      if (!target || target.isDeleted) {
        return errorJson(c, 404, 'USER_NOT_FOUND', 'User not found.');
      }

      if (target.id === actor.id) {
        return errorJson(
          c,
          400,
          'CANNOT_BAN_SELF',
          'You cannot ban yourself.'
        );
      }

      if (isOwner(target.role)) {
        return errorJson(c, 403, 'CANNOT_BAN_OWNER', 'Cannot ban an owner.');
      }

      // Non-owners may only ban customers (not other admins).
      if (!isOwner(actor.role) && target.role === 'admin') {
        return errorJson(
          c,
          403,
          'CANNOT_BAN_ADMIN',
          'Only owners can ban admin accounts.'
        );
      }

      if (target.isBanned === banned) {
        return errorJson(
          c,
          400,
          'STATE_UNCHANGED',
          `User is already ${banned ? 'banned' : 'active'}.`
        );
      }

      const now = new Date();
      const updated = await db
        .update(users)
        .set(
          banned
            ? {
                isBanned: true,
                bannedAt: now,
                bannedBy: actor.id,
                bannedReason: rawReason,
                updatedAt: now,
              }
            : {
                isBanned: false,
                bannedAt: null,
                bannedBy: null,
                bannedReason: null,
                updatedAt: now,
              }
        )
        .where(
          and(
            eq(users.id, targetId),
            eq(users.isDeleted, false),
            eq(users.isBanned, target.isBanned)
          )
        )
        .returning();

      if (updated.length === 0) {
        return errorJson(
          c,
          409,
          'CONFLICT',
          'Could not update ban status. The user may have changed — refresh and try again.'
        );
      }

      const updatedUser = updated[0];
      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: banned ? AUDIT_ACTIONS.USER_BAN : AUDIT_ACTIONS.USER_UNBAN,
          category: AUDIT_CATEGORIES.USER,
          description: banned
            ? `Banned user ${updatedUser.name} (${updatedUser.email})`
            : `Unbanned user ${updatedUser.name} (${updatedUser.email})`,
          targetType: AUDIT_TARGET_TYPES.USER,
          targetId: updatedUser.id,
          targetLabel: updatedUser.email,
          severity: banned ? 'warning' : 'info',
          changes: {
            isBanned: { from: target.isBanned, to: banned },
            bannedReason: {
              from: target.bannedReason,
              to: banned ? rawReason : null,
            },
            bannedBy: {
              from: target.bannedBy,
              to: banned ? actor.id : null,
            },
          },
          metadata: banned ? { reason: rawReason } : undefined,
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: banned
          ? `${updatedUser.name} has been banned.`
          : `${updatedUser.name} has been unbanned.`,
        data: serializeUser(updatedUser),
      });
    } catch (error) {
      console.error('Error banning/unbanning user:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to update ban status.'
      );
    }
  }
);

// ─── PATCH /:id/undelete — restore a deleted account ───────────────────────
usersRouter.patch(
  '/:id/undelete',
  requireAnyPermission(PERMISSIONS.USER_DELETE, PERMISSIONS.USER_MANAGE),
  async (c) => {
    const db = getDb(c);
    const actor = getActor(c);

    const targetId = c.req.param('id')?.trim() ?? '';
    if (!isValidUserId(targetId)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid user id.');
    }

    if (targetId === actor.id) {
      return errorJson(
        c,
        400,
        'CANNOT_UNDELETE_SELF',
        'You cannot undelete yourself.'
      );
    }

    try {
      const [target] = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);

      if (!target) {
        return errorJson(c, 404, 'USER_NOT_FOUND', 'User not found.');
      }

      if (!target.isDeleted) {
        return errorJson(
          c,
          409,
          'USER_NOT_DELETED',
          'User is not deleted and does not need to be restored.'
        );
      }

      if (isOwner(target.role)) {
        return errorJson(
          c,
          403,
          'CANNOT_UNDELETE_OWNER',
          'Cannot undelete an owner.'
        );
      }

      if (!isOwner(actor.role) && target.role === 'admin') {
        return errorJson(
          c,
          403,
          'CANNOT_UNDELETE_ADMIN',
          'Only owners can undelete admin accounts.'
        );
      }

      const now = new Date();
      const updated = await db
        .update(users)
        .set({
          isDeleted: false,
          deletedAt: null,
          isBanned: false,
          bannedAt: null,
          bannedBy: null,
          bannedReason: null,
          updatedAt: now,
        })
        .where(
          and(eq(users.id, targetId), eq(users.isDeleted, true), eq(users.role, target.role))
        )
        .returning();

      if (updated.length === 0) {
        return errorJson(
          c,
          409,
          'CONFLICT',
          'Could not undelete user. They may have changed — refresh and try again.'
        );
      }

      const restored = updated[0];
      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.USER_UNDELETE,
          category: AUDIT_CATEGORIES.USER,
          description: `Restored user ${restored.name} (${restored.email})`,
          targetType: AUDIT_TARGET_TYPES.USER,
          targetId: restored.id,
          targetLabel: restored.email,
          severity: 'warning',
          changes: {
            isDeleted: { from: true, to: false },
            isBanned: { from: target.isBanned, to: false },
            deletedAt: { from: target.deletedAt, to: null },
          },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `${target.name} has been restored.`,
        data: serializeUser(restored),
      });
    } catch (error) {
      console.error('Error undeleting user:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to undelete user.');
    }
  }
);

// ─── DELETE /:id — soft-delete (USER_MANAGE) ──────────────────────────────────
// Role promotion lives on /api/admins — not here.
usersRouter.delete(
  '/:id',
  requireAnyPermission(PERMISSIONS.USER_DELETE, PERMISSIONS.USER_MANAGE),
  async (c) => {
    const db = getDb(c);
    const actor = getActor(c);

    const targetId = c.req.param('id')?.trim() ?? '';
    if (!isValidUserId(targetId)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid user id.');
    }

    if (targetId === actor.id) {
      return errorJson(
        c,
        400,
        'CANNOT_DELETE_SELF',
        'You cannot delete yourself.'
      );
    }

    try {
      const [target] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, targetId), eq(users.isDeleted, false)))
        .limit(1);

      if (!target) {
        return errorJson(c, 404, 'USER_NOT_FOUND', 'User not found.');
      }

      if (isOwner(target.role)) {
        return errorJson(
          c,
          403,
          'CANNOT_DELETE_OWNER',
          'Cannot delete an owner.'
        );
      }

      // Non-owners may only delete customers.
      if (!isOwner(actor.role) && target.role === 'admin') {
        return errorJson(
          c,
          403,
          'CANNOT_DELETE_ADMIN',
          'Only owners can delete admin accounts.'
        );
      }

      const now = new Date();
      const updated = await db
        .update(users)
        .set({
          isDeleted: true,
          deletedAt: now,
          isBanned: true,
          bannedAt: now,
          bannedBy: actor.id,
          bannedReason: 'Account deleted by admin',
          role: 'customer',
          updatedAt: now,
        })
        .where(
          and(
            eq(users.id, targetId),
            eq(users.isDeleted, false),
            eq(users.role, target.role)
          )
        )
        .returning();

      if (updated.length === 0) {
        return errorJson(
          c,
          409,
          'CONFLICT',
          'Could not delete user. They may have changed — refresh and try again.'
        );
      }

      // Drop permission overrides for soft-deleted accounts.
      await db
        .delete(userPermissions)
        .where(eq(userPermissions.userId, targetId));

      const deletedUser = updated[0];
      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.USER_DELETE,
          category: AUDIT_CATEGORIES.USER,
          description: `Soft-deleted user ${target.name} (${target.email})`,
          targetType: AUDIT_TARGET_TYPES.USER,
          targetId: target.id,
          targetLabel: target.email,
          severity: 'critical',
          changes: {
            isDeleted: { from: false, to: true },
            isBanned: { from: target.isBanned, to: true },
            role: { from: target.role, to: 'customer' },
            bannedReason: {
              from: target.bannedReason,
              to: 'Account deleted by admin',
            },
          },
          metadata: {
            previousRole: target.role,
            previousName: target.name,
          },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `${target.name} has been deleted.`,
        data: serializeUser(deletedUser),
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to delete user.');
    }
  }
);

// JSON 404 for unknown paths under /api/users/*
usersRouter.notFound((c) =>
  errorJson(c, 404, 'NOT_FOUND', 'User API route not found.')
);

export default usersRouter;
