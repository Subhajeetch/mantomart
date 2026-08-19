# Homepage Editor — Plan & Implementer Prompt

> Status: planning complete, nothing implemented. This doc is the hand-off.
> The **implementer prompt** is the last section — copy that block into a fresh session.

## What we're building

A homepage that is **rendered on the storefront** (`apps/store`) and **edited
drag-and-drop style (like Shopify sections) in the admin panel** (`apps/admin`).

- Storefront homepage: aggressively SEO-optimized, server-rendered, with an
  algorithmic layout (promo slides on top → product grids → "shop by category"
  CTA components → product cards with **infinite scroll** → a footer present in
  the DOM for SEO even though infinite scroll hides it from view).
- Admin homepage editor: a DnD section editor. Admin chooses which blocks show
  and edits each block's config. Admin page does NOT need to be SEO-friendly.
- New admin API: `apps/api/src/routes/paths/admin/homepage.ts` (currently a
  0-byte stub) + a public read route + new DB table + new permission + audit
  logging. Security: permission-gated, input-validated, audit-logged, KV-cache
  invalidated on mutation.

---

## Key findings from codebase exploration (ground truth)

Everything below was read from the actual files, not assumed.

### Stack
- Monorepo: pnpm workspaces + Turbo. `apps/{store,admin,api}`, `packages/{db,auth,types,ui}`.
- API: **Hono** on Cloudflare Workers (D1 + KV + R2). Routes are `new Hono<{ Bindings: Env }>()`, default-exported, mounted with `app.route("/api/...", router)` in `apps/api/src/index.ts`, and imported/exported in `apps/api/src/routes/index.ts`.
- DB: **Drizzle** over **SQLite/D1** in `packages/db`. TS property names `camelCase`, SQL columns `snake_case`; IDs are `text` PK generated in the API with `nanoid()`; timestamps `integer({mode:"timestamp"})`; booleans `integer({mode:"boolean"})`; JSON `text({mode:"json"}).$type<T>()`. Generate migrations via `pnpm db:generate`, apply via `pnpm db:migrate`.
- Storefront: **Next.js 16** App Router, React 19, deployed via `@opennextjs/cloudflare`. UI = **`@base-ui/react`** (NOT Radix) + Tailwind v4 + shadcn, `cn()` from `@/lib/utils`, flat `rounded-none` aesthetic. Primitives live in `apps/store/src/components/ui/*`.
- Admin: Next.js 16, React 19. UI = Radix (`radix-ui`) + Tailwind v4 + shadcn + **`sonner`** toasts. **`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` are ALREADY installed** in `apps/admin`.

### The exact template to mirror: the existing **header nav editor**
The single best precedent — the homepage editor is structurally a copy of it:

- DB table: `packages/db/src/schema/header.ts` (`header_menu_nodes` — `id text PK`, `position integer default 0`, `isVisible boolean default true`, config-ish fields, timestamps, indexes).
- Admin mutation route: `apps/api/src/routes/paths/admin/edit-header.ts` — applies `requireAdminMiddleware` on `*`, `requirePermission(PERMISSIONS.HEADER_UPDATE)` per mutation, manual validation (regex `isValidId`, `MAX_*` constant caps, `sanitize*` helpers — **NO zod in this repo**), `errorJson(c, status, "CODE", msg)` errors, audit via `logAuditFromContext(...)`, cache-bust via `invalidateHeaderNavCache(kv)`. Has GET/POST/PATCH/DELETE + `PUT /reorder` + `POST /invalidate-cache`.
- Public read route: `apps/api/src/routes/paths/store/header.ts` + shared helpers `apps/api/src/utils/headerNav.ts` — **KV-first / D1-on-miss / long `Cache-Control` / `Vary: Origin` / `X-Cache-Source`**, `invalidateHeaderNavCache(kv)`, KV key `store:header:nav`, 5-day TTL.
- Admin editor UI: `apps/admin/src/app/(with-sidebar)/store/edit/header/_components/` — `header-editor.tsx` (DnD context with `onDragStart/Over/End/Cancel`, custom `collisionDetection`, `DragOverlay`, **optimistic updates + rollback via a `useRef` snapshot** + `reorderInFlight` ref, `busyKey` for per-action loading, `sonner` toasts, confirm dialogs, `canUpdate` from `meta` gating), `sortable-tab.tsx`/`sortable-column.tsx`/`sortable-leaf.tsx` (`useSortable`, Discord-style `drag-handle.tsx`), `api.ts` (`ApiError` class + `requestHeaderJson<T>` wrapper with `credentials:"include"`, `cache:"no-store"`, typed wrappers), `types.ts` (`dragId`/`parseDragId`, `DragKind` prefixes to avoid drag-id collisions), `utils.ts` (`arrayMove`, `withPositions` step=10, `reorderList`).

### Auth / permissions / audit (exact conventions)
- Permission catalog: `packages/auth/src/permissions.ts` → `PERMISSIONS` (`as const`), `type Permission`, `AUDIT_ACTIONS`, `ROLE_PERMISSIONS`. **`HEADER_UPDATE = 'header:update'` is intentionally NOT on the default `admin` role** (only `owner` gets all perms); it's granted via override. Do the same for homepage.
- Auth middleware: `apps/api/src/middleware/permission.ts` → `requireAdminMiddleware` (sets `actor`+`db` on context), `requirePermission(perm)` (owners auto-pass; admins checked via `adminHasPermission`), `getActor(c)`, `getDb(c)`. Session is better-auth, cookie-based, shared cross-subdomain in prod.
- Audit: `apps/api/src/utils/auditLog.ts` → `logAuditFromContext(c, { action, category, description, targetType, targetId, targetLabel, changes, severity })`, fire-and-forget via `c.executionCtx.waitUntil(...)`. `buildChanges(before, after)` for diffs. `AUDIT_CATEGORIES` + `AUDIT_TARGET_TYPES` are `as const` objects in this file; `AUDIT_ACTIONS` is in `packages/auth/src/permissions.ts`.

### Data reality (important constraints)
- Products: `products` table (`published` = visibility, `featured`, `position`, `slug`, `name`, `images` JSON). **No product-level price** — pricing/discount lives on `product_skus` (variants): `price` (cents) and `compareAtPrice` (cents, nullable). **`compareAtPrice > price` is the ONLY existing "on sale / discount" signal** — no promo/coupon/sale table exists.
- Categories: `categories` tree (`parentId` self-ref, `slug`, `image`, `position`, max depth 4). **Men/women/electronics groupings are modeled entirely through the category tree** — there is NO `product.gender`/audience field. "Shop for men/women" = category navigation.
- **No `orders` table exists yet.** "New user" = `users.totalOrders === 0` (denormalized counter on the users table). Caveat (tell implementer): nothing increments `totalOrders` today; it's a known gap — implement against the field that exists, don't build an orders table.
- Images: R2 upload pipeline. `POST /api/admin/images/upload` (multipart, **WebP-only**, ≤2 MiB, admin-gated; `banner` folder is already allow-listed). Return URL stored in config. Client helper: `apps/admin/src/components/image-upload/upload-api.ts`.
- Storefront session: `useSession()` from `@/lib/auth-client` (better-auth client). The storefront reads the user client-side.
- Both `apps/store/src/app/(with-navbar)/page.tsx` and `apps/admin/src/app/(with-sidebar)/store/edit/homepage/page.tsx` are **stubs** (greenfield). The admin sidebar ALREADY has a "Manage Homepage → `/store/edit/homepage`" entry — no nav work needed.

### Decisions made (to embed in the prompt)
1. **Personalization is client-side on the storefront**, not API-side. The public homepage payload is sessionless and fully KV-cached (identical for all visitors → SEO-stable + caches trivially). The first-order-discount promo slide is shipped in the SSR HTML (good for SEO); the storefront `<PromoSlider>` shows/hides `audience:'new_user'` slides via `useSession()` + `users.totalOrders === 0`. Trade-off accepted: one cheap client check vs. the whole per-audience cache-key bug class.
2. **"New user" = `users.totalOrders === 0`** (only available signal; no orders table).
3. **No new promotions/discounts table.** Slide discount labels are admin free-text in the slide config; product-card discount badges derive from `productSkus.compareAtPrice`.
4. **Infinite scroll = a terminal `product_feed` block** with a composite `(position, id)` cursor. The alternating "products → men/women CTA → products → electronics CTA → products…" vision is realized as an **ordered flat list of blocks**: finite `product_grid` and `category_cta` blocks in any order the admin drags them, followed by exactly one `product_feed` block that streams forever. Admin reorders which finite blocks precede the feed; the storefront renders top-to-bottom.
5. **Block model** (the drag units — a flat ordered list, mirroring `header_menu_nodes`): block types =
   - `promo_slider` — top hero carousel; slide configs incl. an `audience` field (`'all'` | `'new_user'`)
   - `product_grid` — finite N product cards sourced from a category (or "featured")
   - `category_cta` — e.g. "Shop for Men / Women" (2 buttons) or "Shop Electronics"
   - `product_feed` — the infinite-scroll terminal block (max one, must be last)

---

## Architecture (all layers, in order of implementation per the prompt)

1. **DB** — `packages/db/src/schema/homepage.ts` (`homepage_blocks` table) → re-export in `schema/index.ts` + composite types in `types.ts`. Generate + apply migration.
2. **Shared constants** — `PERMISSIONS.HOMEPAGE_UPDATE` + `AUDIT_ACTIONS.HOMEPAGE_*` in `packages/auth/src/permissions.ts`; `AUDIT_CATEGORIES.HOMEPAGE` + `AUDIT_TARGET_TYPES.HOMEPAGE_BLOCK` in `apps/api/src/utils/auditLog.ts`.
3. **Public read helper** — `apps/api/src/utils/homepageContent.ts` (mirror `headerNav.ts`: KV key `store:homepage`, TTL, `loadPublicHomepageFromDb`, `getPublicHomepage`, `invalidateHomepageCache`, block-type enum + config TS types, a paginated feed loader with composite cursor).
4. **Admin mutation API** — fill `apps/api/src/routes/paths/admin/homepage.ts` (perms, manual validation+caps, audit, KV invalidation; endpoints GET, POST, PATCH/:id, DELETE/:id, PUT /reorder, POST /invalidate-cache). Wire in `routes/index.ts` + `apps/api/src/index.ts`.
5. **Public read API** — `apps/api/src/routes/paths/store/homepage.ts` (GET / returns SSR blocks; GET /feed returns next cursor page). Mount in `index.ts`.
6. **Storefront components + homepage** — `apps/store/src/components/homepage/*` (PromoSlider, ProductCard, ProductGrid, CategoryCta, ProductFeed+infinite-scroll hook, SeoFooter) + SSR `api.ts` mirroring `components/navbar/api.ts`; rewrite `(with-navbar)/page.tsx` as an SEO-centric server component.
7. **Admin editor** — fill `apps/admin/.../store/edit/homepage/page.tsx` + `_components/*` mirroring the header editor (DnD sorted block list, per-type block config dialogs, add/delete, reorder, visibility toggle, optimistic+rollback, sonner, `canUpdate` gating, cache-invalidate button).

---

## IMPLEMENTER PROMPT (copy from the line below into a fresh session)

```
# Task: Build a Shopify-style Homepage Editor for "ragimart"

Monorepo (pnpm + Turbo). Build a storefront homepage that is edited
drag-and-drop style (Shopify "sections") in the admin panel. The STOREFRONT
homepage must be aggressively SEO-optimized (server-rendered, semantic HTML,
SSR content, proper metadata). The ADMIN editor page does NOT need to be
SEO-friendly. Do not skip error handling — handle every bug/error path.

This feature is greenfield: both `apps/store/src/app/(with-navbar)/page.tsx` and
`apps/admin/src/app/(with-sidebar)/store/edit/homepage/page.tsx` are stubs, and
`apps/api/src/routes/paths/admin/homepage.ts` is an empty 0-byte file. The admin
sidebar already links to `/store/edit/homepage` — no nav work needed.

## STEP 0 — READ BEFORE WRITING ANY CODE (these are the exact templates)
Do not invent new patterns. Match these files precisely:

- packages/db/src/schema/header.ts        — Drizzle table shape to copy (id text PK, position integer, isVisible boolean, timestamps, indexes)
- packages/db/src/schema/index.ts         — barrel re-export pattern (add homepage.ts here)
- packages/db/src/types.ts                — composite TS types pattern
- packages/auth/src/permissions.ts        — PERMISSIONS, AUDIT_ACTIONS, ROLE_PERMISSIONS (HEADER_UPDATE is the precedent: NOT on default admin role)
- apps/api/src/middleware/permission.ts   — requireAdminMiddleware (on "*"), requirePermission(), getActor(c), getDb(c)
- apps/api/src/utils/auditLog.ts          — logAuditFromContext(c,{...}) via c.executionCtx.waitUntil; buildChanges(before,after); AUDIT_CATEGORIES; AUDIT_TARGET_TYPES
- apps/api/src/utils/headerNav.ts         — KV-first/D1-on-miss public read + invalidate (THE blueprint for the public helper)
- apps/api/src/routes/paths/admin/edit-header.ts — admin mutation route conventions: perms, MANUAL validation (regex isValidId + MAX_* caps + sanitize* helpers, NO zod in this repo), errorJson, audit, reorder endpoints, invalidate-cache
- apps/api/src/routes/paths/store/header.ts — public read route (Cache-Control, Vary: Origin, X-Cache-Source)
- apps/api/src/utils/errorJson.ts         — errorJson(c,status,"CODE",msg) + AppEnv/AppContext types + AdminActor
- apps/api/src/routes/index.ts + apps/api/src/index.ts — how routes are imported/exported and mounted (app.route("/api/...", router))
- apps/store/src/components/navbar/api.ts  — storefront SSR fetch template (next:{revalidate,tags:[...]}, defensive normalize, "Never throws")
- apps/store/src/app/(with-navbar)/layout.tsx — layout/server-component pattern
- apps/store/src/components/ui/*          — storefront UI primitives (@base-ui/react + Tailwind v4 + shadcn + cn() from @/lib/utils, flat rounded-none look)
- apps/admin/src/app/(with-sidebar)/store/edit/header/_components/* — THE admin DnD editor template: header-editor.tsx (DndContext, onDragStart/Over/End/Cancel, collisionDetection, DragOverlay, optimistic+rollback via useRef snapshot, busyKey, sonner toasts, confirm dialogs, canUpdate gating), sortable-tab.tsx (useSortable), drag-handle.tsx, api.ts (ApiError + requestHeaderJson with credentials:"include", cache:"no-store"), types.ts (dragId/parseDragId, DragKind prefixes), utils.ts (arrayMove, withPositions, reorderList)
- apps/store/src/lib/auth-client.ts — useSession() storefront client
- packages/db/src/schema/products.ts — products (published/featured/position/slug/name/images), productSkus (price + compareAtPrice = the ONLY discount signal), productCategories join
- packages/db/src/schema/categories.ts — categories tree (slug/image/position/parentId); men/women/electronics are CATEGORIES (no product.gender field)
- packages/db/src/schema/auth.ts — users.totalOrders === 0 means "new user" (NO orders table exists; do not build one)
- apps/api/src/utils/imageUpload.ts + apps/api/src/routes/paths/admin/image-upload-api.ts — R2 image upload (WebP-only, "banner" folder already allow-listed)
- apps/admin/src/components/image-upload/upload-api.ts — admin upload client helper

## STEP 1 — Database schema

Create `packages/db/src/schema/homepage.ts` with a Drizzle `sqliteTable`
"homepage_blocks" mirroring `header.ts`:
- id: text PK (generated with nanoid() in the API, like header)
- blockType: text enum ["promo_slider","product_grid","category_cta","product_feed"]
- config: text({ mode: "json" }).$type<HomepageBlockConfig>() NOT NULL — holds per-type config (see types below)
- position: integer notNull default 0
- isVisible: integer({mode:"boolean"}) notNull default true
- createdAt / updatedAt: integer({mode:"timestamp"}) notNull
- indexes on position, isVisible, blockType

Define and export (from homepage.ts) a discriminated-union TS config type:
- PromoSlideConfig { slides: Array<{ id; imageUrl; mobileImageUrl?; title?; subtitle?; ctaLabel?; ctaHref?; audience: "all"|"new_user"; discountLabel? }> }
- ProductGridConfig { source: "category"|"featured"; categoryId?: string; limit: number }  // limit capped server-side
- CategoryCtaConfig { title?; subtitle?; buttons: Array<{ id; label; categoryId; href? }> }  // e.g. Men / Women, or Electronics
- ProductFeedConfig { pageSize: number }  // infinite scroll terminal block
- HomepageBlockConfig = PromoSlideConfig | ProductGridConfig | CategoryCtaConfig | ProductFeedConfig
  (use a `type`/`kind` discriminator that lines up with blockType)

Re-export the new table + types in `packages/db/src/schema/index.ts` and add any
composite types to `packages/db/src/types.ts` following the existing pattern.
Run `pnpm db:generate` to create the migration, then `pnpm db:migrate`.

Hard invariant (enforce in API): at most ONE `product_feed` block, and it MUST be
the last block by position. All other block types may repeat.

## STEP 2 — Permission + audit constants

In `packages/auth/src/permissions.ts`:
- Add `PERMISSIONS.HOMEPAGE_UPDATE = 'homepage:update'` (same style as HEADER_UPDATE). Do NOT add it to the default `admin` role in ROLE_PERMISSIONS (mirror HEADER_UPDATE's "intentionally NOT on default admin role" comment) — it's owner-only by default, grantable via override.
- Add `AUDIT_ACTIONS.HOMEPAGE_CREATE = 'homepage.create'`, `HOMEPAGE_UPDATE = 'homepage.update'`, `HOMEPAGE_DELETE = 'homepage.delete'`, `HOMEPAGE_REORDER = 'homepage.reorder'`.

In `apps/api/src/utils/auditLog.ts`:
- Add `HOMEPAGE: 'homepage'` to `AUDIT_CATEGORIES`.
- Add `HOMEPAGE_BLOCK: 'homepage_block'` to `AUDIT_TARGET_TYPES`.

## STEP 3 — Public read helper (apps/api/src/utils/homepageContent.ts)

Mirror `headerNav.ts` exactly:
- KV key `HOMEPAGE_KV_KEY = 'store:homepage'`, `HOMEPAGE_CACHE_TTL_SECONDS = 5*24*60*60`.
- Define public-portal block types (slim, SSR-friendly) + a `HomepagePayload`.
- `loadPublicHomepageFromDb(db)`: SELECT visible homepage_blocks ordered by asc(position), asc(id); validate/normalize each block's config by type (drop/repair malformed blocks — never throw on bad config, skip with a console.warn and exclude);
  for `product_grid`/`category_cta` blocks, hydrate category slugs/names/images by joining `categories`;
  return `{ blocks, updatedAt, cachedAt }`.
- `getPublicHomepage(db, kv)`: try KV JSON first (validate shape); on miss load from D1 and re-seed KV; return `{ data, source: 'kv'|'db' }`. Wrap all KV ops in try/catch (KV failures must NEVER break the read — fall back to D1, like headerNav).
- `invalidateHomepageCache(kv)`: delete the KV key (try/catch, log on failure).
- `loadProductFeedPage(db, cursor, pageSize)`: returns product cards (id, slug, name, primary image, min price, min compareAtPrice across published SKUs, discount flag, href) for INFINITE SCROLL. Composite cursor = base64 of `${position}:${id}`; query `products where published=true order by asc(position),asc(id)`, paginating after the cursor; dedupe; cap pageSize server-side (e.g. min(pageSize, 24) with fallback 12). Never throw — return `{ items: [], nextCursor: null }` on error.
- A `normalizePublicPayload` that is defensive about old/missing fields (mirror `normalizePublicPayload` in headerNav).

## STEP 4 — Public read route (apps/api/src/routes/paths/store/homepage.ts)

Mirror `store/header.ts`. `new Hono<{ Bindings: Env }>()`.
- `GET /` → `getPublicHomepage(db, c.env.KV)`; set `Cache-Control: public, max-age=..., s-maxage=..., stale-while-revalidate=86400`, `Vary: Origin`, `X-Cache-Source`; return `{ success:true, data:{ blocks, updatedAt, cachedAt }, meta:{ source } }`. Wrap in try/catch → `errorJson(c,500,"INTERNAL_ERROR","Failed to load homepage.")` on failure. This is the SESSIONLESS public payload (identical for all visitors → cacheable + SEO-stable).
- `GET /feed?cursor=&pageSize=` → `loadProductFeedPage`; same cache headers; return `{ success:true, data:{ items, nextCursor } }`. Defensive on bad cursor (treat as start).
Register in `routes/index.ts` and mount `app.route("/api/store/homepage", storeHomepage)` in `apps/api/src/index.ts` (next to the existing `app.route("/api/store/header", storeHeader)`).

## STEP 5 — Admin mutation route (apps/api/src/routes/paths/admin/homepage.ts)

Mirror `edit-header.ts`. `new Hono<AppEnv>()`. Apply `homepage.use('*', requireAdminMiddleware)`.

Validation style: MANUAL, exactly like edit-header.ts (regex `isValidId`,
`MAX_*` constants, `sanitize*` helpers). NO zod (it's not in this repo).
Define caps: `MAX_BLOCKS = 40`, `MAX_SLIDES_PER_SLIDER = 12`, `MAX_BUTTONS_PER_CTA = 6`, `MAX_GRID_LIMIT = 24`, `MAX_FEED_PAGE_SIZE = 24`, length caps for strings, URL length cap 2048, etc. Reject oversized payloads with `errorJson(c, 413, "PAYLOAD_TOO_LARGE", ...)`.

Sanitize every nested config field server-side (trim, length-cap, validate
image URLs start with http/https or match the R2 served path, validate
categoryIds against the `categories` table for existence). Coerce numbers with
NaN guards and clamp to ranges.

Behavior:
- `GET /` (requireAdminMiddleware): return ALL blocks (incl. hidden) ordered by position, plus `availableCategories` (id/name/slug/image/position, mirroring header's) and a `meta` object: `{ totalBlocks, visibleBlocks, maxBlocks, maxSlidesPerSlider, maxButtonsPerCta, maxGridLimit, maxFeedPageSize, canUpdate: boolean (role owner OR has HOMEPAGE_UPDATE), currentUserRole }`. Compute `canUpdate` exactly like edit-header (owner, or `adminHasPermission(db, actor.id, PERMISSIONS.HOMEPAGE_UPDATE)`).
- `POST /` (requirePermission(HOMEPAGE_UPDATE)): validate body; reject if `MAX_BLOCKS` reached; new `position` defaults to `maxPosition + 10` (the header +10 gap convention); reject a second `product_feed` or any block after a `product_feed` (invariant); insert; compute `changes` via buildChanges(null, newRow); audit `logAuditFromContext` fired with `c.executionCtx.waitUntil` (action HOMEPAGE_CREATE, category HOMEPAGE, targetType HOMEPAGE_BLOCK, targetId, targetLabel=blockType, changes, severity 'info'); `invalidateHomepageCache(kv)` (also waitUntil); return the created block.
- `PATCH /:id` (requirePermission): fetch before; validate partial config; update `updatedAt`; audit with `buildChanges(before, after)`; invalidate cache; respond.
- `DELETE /:id` (requirePermission): fetch before; delete; audit HOMEPAGE_DELETE with the deleted block in `changes`; invalidate cache. Deleting the `product_feed` is allowed; deleting other blocks is allowed. After delete, if any `product_feed` remains it must still be last — the invariant only needs re-checking on CREATE/PATCH; document this.
- `PUT /reorder` (requirePermission): accept BOTH shapes like header's reorder: `{ orderedIds: string[] }` (apply `position = i*10`) OR `{ items: { id, position }[] }` sparse. Validate all ids reference existing blocks from the requesting user's view; reject unknown ids with 400. Re-assert the single-feed/last invariant against the final order — if violated, reject with `errorJson(c,400,"INVALID_BLOCK_ORDER",...)` and DO NOT persist. Audit HOMEPAGE_REORDER. Invalidate cache.
- `POST /invalidate-cache` (requirePermission or requireAdminMiddleware per your judgment — match header's choice): force-drop the KV key; respond `{ success:true, message }`.

Audit every mutation (never let an audit-log failure break the business action — that's how `createAuditLog` is built; it swallows errors). Always invalidate KV on every mutation, fire-and-forget.

Error responses always via `errorJson(c, status, "CODE", readable message)`. Codes from errorJson's allowlist (400 INVALID_*, 401 UNAUTHORIZED, 403 INSUFFICIENT_PERMISSION/FORBIDDEN, 404 NOT_FOUND, 413 PAYLOAD_TOO_LARGE, 500 INTERNAL_ERROR).

Register in `routes/index.ts` and mount `app.route("/api/admin/homepage", homepage)` in `apps/api/src/index.ts`.

## STEP 6 — Storefront homepage (apps/store)

Build ALL components from scratch (none exist today). Put them in
`apps/store/src/components/homepage/`. Use `@base-ui/react` primitives where
helpful, Tailwind v4, `cn()` from `@/lib/utils`, the existing `apps/store/src/components/ui/*` primitives (Button, Card, Badge). Keep the flat `rounded-none` aesthetic. Every component must handle loading/empty/error states gracefully (never crash the page).

Client/server split:
- `api.ts` (server-usable): `getHomepage()` — SSR fetch of `/api/store/homepage` mirroring `components/navbar/api.ts` (absolute `${NEXT_PUBLIC_API_URL}/api/store/homepage` else same-origin `/api/store/homepage`, `next:{ revalidate: 5*24*60*60, tags:['store-homepage'] }`, `Accept:'application/json'`, try/catch returning `{ blocks: [] }` on any failure — NEVER throws). Also `fetchFeedPage(cursor)` for client-side infinite scroll (same-origin `/api/store/homepage/feed`, throw-safe returning `{ items:[], nextCursor:null }` on failure).
- Components:
  - `promo-slider.tsx` ("use client"): accessible carousel of slides; reads `useSession()` from `@/lib/auth-client`; a slide with `audience:'new_user'` is only rendered when the signed-in user has `totalOrders === 0` (no session or unknown → treat as NOT a new user → hide new-user slides but STILL render the `audience:'all'` slides). Handle empty/no-slides (render nothing, not a blank box). Prefers `mobileImageUrl` on small screens. Disabled-js fallback: first slide visible (SEO + no-JS friendly).
  - `product-card.tsx`: shows image, name, price (min sku price), discount badge when compareAtPrice>price (derive `was`/`% off` client-side), link to `/product/[slug]`. Skeleton fallback.
  - `product-grid.tsx`: finite grid of ProductCard from hydrated grid blocks. Empty state.
  - `category-cta.tsx`: renders the configured buttons → `/category/[slug]` (or custom href). For "Men/Women" 2-button layouts the admin just configures 2 buttons; this component is generic.
  - `product-feed.tsx` ("use client" wrapper + server boundary): renders the initial batch (provided by SSR) then infinite-scrolls via `fetchFeedPage` using IntersectionObserver; appends cards; shows a loading skeleton at the bottom; stops when `nextCursor` is null; guards against duplicate items (dedupe by product id) and against duplicate in-flight requests (ref flag); ignores mutations to a stale page. SSR-safe (renders the initial batch even with JS off — content is in the HTML for SEO).
  - `seo-footer.tsx`: a real `<footer>` with links/categories — present in DOM (SEO) though visually below the infinite feed. Server component, static content derived from the same categories used by the navbar (reuse `getHeaderNav()`'s data is fine, or accept props). Ensure at least one `<h1>`/semantic landmark on the page from the server layout (page.tsx below).
- `page.tsx` (`apps/store/src/app/(with-navbar)/page.tsx`) becomes an async SERVER component: `export const revalidate = ...; export const dynamic = 'force-static' or 'force-dynamic' as appropriate`; set metadata via `export const metadata = {...}` (title, description, openGraph, robots index/follow); call `await getHomepage()`; render blocks top-to-bottom in semantic HTML (`<section>` per block with a hidden `<h2>` for non-product sections; product cards in `<ul>`/`<li>` or `<article>`). The SSR HTML must contain real product names/links/prices (not just client-fetched) for the initial grid blocks + first feed page. The infinite feed's later pages are client-fetched (acceptable; first paint is SEO-complete).

## STEP 7 — Admin editor (apps/admin/.../store/edit/homepage)

Mirror the header editor file-for-file. Create `_components/`:
- `homepage-editor.tsx` ("use client"): the DnD editor. Load blocks+meta+availableCategories via api; `canUpdate` gating; DndContext with `onDragStart/Over/End/Cancel`, the same `collisionDetection` as header-editor, `DragOverlay`; one flat sortable list of blocks (each row = a block: drag handle + type badge + a brief config summary + visibility toggle + edit + delete). Reorder via `PUT /reorder` with optimistic update + rollback via a `useRef` snapshot + `reorderInFlight` ref (copy header-editor's `persistReorder`/`onDragCancel`). Add-block button opens a dialog to pick blockType; per-block "edit" opens a config dialog specialized by type (slider editor with add/remove/reorder slides + image upload via the existing R2 upload helper + audience select + CTA fields; grid editor with source select + category pick + limit; cta editor with title/subtitle + add/remove buttons each linking to a category or href; feed editor with pageSize). Visibility toggle optimistic + rollback. Delete with confirm dialog (sonner). A toolbar with refresh + "invalidate cache" + counts (like header). All buttons disabled logic uses a `busyKey` map like header-editor.
- `api.ts`: `ApiError` class + `requestHomepageJson<T>(path, options)` mirroring `header/_components/api.ts` exactly (`credentials:"include"`, `cache:"no-store"`, base `${NEXT_PUBLIC_API_URL}/api/admin/homepage`). Typed wrappers: loadHomepage, createBlock, updateBlock, deleteBlock, reorderHomepage, invalidateHomepageCache, plus loadCategoryTree (reuse `${NEXT_PUBLIC_API_URL}/api/categories/tree` like header) and the upload client (reuse `apps/admin/src/components/image-upload/upload-api.ts`).
- `types.ts`: admin block types, `dragId`/`parseDragId` with a single DragKind "block" (flat list), reorder payload types, `ApiErrorBody`.
- `utils.ts`: `arrayMove`, `withPositions` (step 10), `reorderList`, `normalizeBlocks`, block-summary helpers.
- `page.tsx`: keep the existing breadcrumb shell; render `<HomepageEditor />` in `<main>` (mirror `store/edit/header/page.tsx`).

UX/security details that prevent bugs:
- All mutations disabled when `!canUpdate` AND show the same permission callout header-editor shows.
- Optimistic UI always paired with a load-on-failure rollback (re-fetch). Never leave the list in a half-applied state if a request fails (rollback to the `useRef` snapshot, like header-editor).
- Disable simultaneous reorders/dragging during any in-flight mutation (`busyKey`/`disabled`).
- The admin editor must never crash on a malformed block config from the server (read fields defensively; show a "needs repair" badge).

## STEP 8 — Wire everything & verify
- `pnpm db:generate` then `pnpm db:migrate` (confirm the migration applies cleanly; if the migration has an error, fix it — do not hand-edit applied migrations; drop+regenerate if it hasn't been applied).
- Wire both routes in `apps/api/src/routes/index.ts` (import + export) and `apps/api/src/index.ts` (`app.route("/api/admin/homepage", homepage)` and `app.route("/api/store/homepage", storeHomepage)`).
- Run `pnpm check-types` (or `tsc --noEmit` per app) and fix ALL type errors — do not leave any `any` leaks where the templates use real types. Do not silence errors with `@ts-ignore`.
- Run `pnpm lint` and fix lint errors.
- Smoke-test mentally / with the dev servers: admin can create+reorder+edit+delete+toggle-visibility blocks; storefront renders them top-to-bottom SSR; feed infinite-scrolls; first-order slide hides for existing users on the storefront; cache invalidation propagates (admin "Invalidate cache" → next storefront load reflects changes).

## HARD REQUIREMENTS (do not skip)
- Permission check `HOMEPAGE_UPDATE` on EVERY admin mutation (owners pass automatically like header). 403 INSUFFICIENT_PERMISSION otherwise.
- Audit log EVERY admin mutation via `logAuditFromContext` + `c.executionCtx.waitUntil`; include `buildChanges(before, after)` diffs on create/update/delete; target type HOMEPAGE_BLOCK.
- Invalidate the `store:homepage` KV cache on every admin mutation (fire-and-forget).
- Manual validation everywhere — NO zod (it's not in this repo). Caps + regex + sanitize, exactly like edit-header.ts.
- Public read is SESSIONLESS, fully cached, SEO-first (real product data in SSR HTML; semantic landmarks; metadata on page.tsx).
- Personalization (new-user slide) is CLIENT-SIDE on the storefront via `useSession()` + `users.totalOrders === 0`. The API payload is identical for everyone.
- "New user" = `users.totalOrders === 0`. Do NOT build an orders table.
- One `product_feed` block max, and it MUST be last — enforced on CREATE, PATCH, and PUT /reorder (reject + do NOT persist if violated).
- Errors never crash the storefront page (defensive fetch, empty-state components). Errors from the admin editor show sonner toasts and rollback optimistic state.
- No `any` leaks, no `@ts-ignore`, no unhandled promise rejections, no unguarded array access without bounds checks, no missing keys in lists.
```
