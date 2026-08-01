import { createAuthClient } from "better-auth/react";

export { createAuthClient };
export type { Session } from "better-auth";
export type AuthClient = ReturnType<typeof createAuthClient>;

//this is client auth types and functions