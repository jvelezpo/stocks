import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./stock-info.ts", "./lib/**/*", "./prompts/**/*"],
  },
};

export default nextConfig;
