import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ['https://preview-chat-81f9fe3a-1512-4780-ae80-7eb5d2582c1d.space-z.ai'],
};

export default nextConfig;
