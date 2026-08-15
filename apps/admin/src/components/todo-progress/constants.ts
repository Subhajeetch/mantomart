/**
 * Product catalog todo + celebration timings.
 *
 * Counts live in localStorage only (admin UX). Tweak the numbers here —
 * no backend and no settings-page rewrite required.
 */

/** How many products complete the first catalog todo. */
export const PRODUCT_TODO_GOAL = 10;

/** Stable id for the products-added counter (and future todos). */
export const PRODUCT_TODO_ID = 'products-added' as const;

/**
 * Hidden Ctrl+M preview on the product-add page.
 * Change these to preview mid-progress, goal, or over-goal.
 */
export const PRODUCT_TODO_DEMO_FROM = PRODUCT_TODO_GOAL - 1;
export const PRODUCT_TODO_DEMO_TO = PRODUCT_TODO_GOAL;

// ─── Celebration timings (milliseconds) ───────────────────────────────────────

/** Progress bar fill from the previous count to the new one. */
export const TODO_PROGRESS_ANIMATION_MS = 900;

/** Extra time on screen after the bar finishes, before auto-close. */
export const TODO_CELEBRATION_HOLD_MS = 1800;

/**
 * Hard cap for how long the dialog/drawer stays open.
 * Progress + hold is clamped to this.
 */
export const TODO_CELEBRATION_MAX_MS = 3000;

/** Wait for the import wizard overlay to finish closing. */
export const TODO_CELEBRATION_OPEN_DELAY_MS = 220;

/** Confetti burst length. Kept short so it stays light. */
export const TODO_CONFETTI_DURATION_MS = 2200;

export function getCelebrationVisibleMs(): number {
  return Math.min(
    TODO_PROGRESS_ANIMATION_MS + TODO_CELEBRATION_HOLD_MS,
    TODO_CELEBRATION_MAX_MS
  );
}

export function getProgressAnimationMs(): number {
  // Leave a little time after the bar finishes so the last frame is visible.
  return Math.min(
    TODO_PROGRESS_ANIMATION_MS,
    Math.max(400, TODO_CELEBRATION_MAX_MS - 500)
  );
}
