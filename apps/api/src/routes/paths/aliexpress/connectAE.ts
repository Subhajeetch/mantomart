import { connectAliExpress } from "@/utils/manageAEauthTokens";
import type Env from "@/types/env";
import { Hono } from "hono";

const aeAuth = new Hono<{ Bindings: Env }>();

aeAuth.get("/connect", async (c) => {
  const code = c.req.query("code");

  if (!code) {
    return c.json({ error: "Missing code" }, 400);
  }

  try {
    const tokens = await connectAliExpress(c.env, code);
    return c.json({ success: true, tokens });
    } catch (error) {
    console.error("Error connecting AliExpress:", error);
    
    let message = "Unknown error occurred";
    if (error instanceof Error) {
      try {
        const parsed = JSON.parse(error.message.replace(/^AliExpress token create error: /, ""));
        message = parsed.message ?? error.message;
      } catch {
        message = error.message;
      }
    }

    return c.json({ success: false, error: message }, 500);
  }
});

export default aeAuth;