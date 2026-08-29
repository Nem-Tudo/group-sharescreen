import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // The Discord screenshots on /discord-bot live on the project's own CDN.
    // next/image refuses any remote host that is not declared here, so this
    // is what lets that page use it instead of a plain <img>.
    remotePatterns: [{ protocol: "https", hostname: "cdn.nemtudo.me" }],
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
      {
        source: "/github",
        destination: "https://github.com/Nem-Tudo/group-sharescreen",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;