import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Quick Tunnel hostnames change on every run. This option only governs
  // access to dev-only assets/endpoints (including HMR); production routing
  // and the existing deployment remain unchanged.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
