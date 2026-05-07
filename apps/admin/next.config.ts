import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
	async rewrites() {
		return [
			{
				source: '/api/:path*',
				destination: process.env.NEXT_PUBLIC_API_URL
					? `${process.env.NEXT_PUBLIC_API_URL}/api/:path*`  // Production
					: 'http://localhost:8002/api/:path*',   // Local
			},
		];
	}
};

export default nextConfig;

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
