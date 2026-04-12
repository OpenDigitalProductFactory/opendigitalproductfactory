/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@dpf/db", "@dpf/validators"],
  outputFileTracingExcludes: {
    "**/*": ["./node_modules/@swc/core*", "./node_modules/esbuild*"],
  },
};

export default config;
