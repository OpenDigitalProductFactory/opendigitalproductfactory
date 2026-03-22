/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@dpf/db"],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default config;
