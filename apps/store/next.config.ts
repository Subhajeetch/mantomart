import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	async rewrites() {
		// Proxy same-origin /api/* → API worker so relative fetches work in
		// both local dev and production without CORS for simple GETs.
		// Keep the `/api` prefix — the Hono API mounts routes under /api/*.
		const apiOrigin = (
			process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"
		).replace(/\/$/, "");

		return [
			{
				source: "/api/:path*",
				destination: `${apiOrigin}/api/:path*`,
			},
		];
	},
};

export default nextConfig;

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
