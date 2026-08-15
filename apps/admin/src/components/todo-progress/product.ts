import { PRODUCT_TODO_ID } from './constants';
import { recordTodoIncrement } from './store';

/** Persist +1 product and notify celebration hosts. */
export function recordProductAdded(): { from: number; to: number } {
  return recordTodoIncrement(PRODUCT_TODO_ID);
}
