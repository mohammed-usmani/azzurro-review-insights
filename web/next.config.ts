import type { NextConfig } from "next";

// The dashboard calls /api/*; Next.js forwards it to the FastAPI server, so there is one origin and no CORS.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
