'use client';

import type { Session } from '@repo/types/session-client';

import {
  PRODUCT_TODO_DEMO_FROM,
  PRODUCT_TODO_DEMO_TO,
  PRODUCT_TODO_GOAL,
  PRODUCT_TODO_ID,
  TodoCelebration,
  useTodoCelebration,
} from '@/components/todo-progress';
import { useSession } from '@/lib/auth-client';

/**
 * Product-add instance of the reusable todo celebration.
 * Ctrl/Cmd+M plays a demo with PRODUCT_TODO_DEMO_* (does not persist).
 */
export function ProductTodoHost() {
  const { data } = useSession();
  const session = data as Session | null;

  const celebration = useTodoCelebration({
    todoId: PRODUCT_TODO_ID,
    enableHotkey: true,
    demoFrom: PRODUCT_TODO_DEMO_FROM,
    demoTo: PRODUCT_TODO_DEMO_TO,
  });

  const user = session?.user
    ? {
        name: session.user.name,
        email: session.user.email,
        avatar: session.user.image ?? '/avatars/default.jpg',
      }
    : null;

  return (
    <TodoCelebration
      open={celebration.open}
      onOpenChange={celebration.onOpenChange}
      user={user}
      from={celebration.from}
      to={celebration.to}
      goal={PRODUCT_TODO_GOAL}
      nonce={celebration.nonce}
      itemLabel="products"
    />
  );
}
