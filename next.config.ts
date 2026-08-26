import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/bot",
        destination: "https://discord.com/oauth2/authorize?client_id=1540460243270635600",
        permanent: true,
      },
      {
        source: "/stats",
        destination: "https://stats.nemtudo.me/public-dashboards/9be4846ec8774ff5888baa7d33862ccc",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
