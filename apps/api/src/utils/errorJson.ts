import { type Context } from "hono";
import type Env from "@/types/env";

type AppContext = Context<{ Bindings: Env }>;
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503;

function errorJson(
  c: AppContext,
  status: ErrorStatus,
  code: string,
  message: string
) {
  return c.json(
    {
      success: false,
      error: message,
      code,
    },
    status
  );
}


export { errorJson, type AppContext, type ErrorStatus };