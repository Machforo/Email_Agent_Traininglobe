import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the user's home directory makes Next guess the wrong
  // workspace root. Pin it to this project.
  outputFileTracingRoot: __dirname,
  /* config options here */
};

export default nextConfig;
