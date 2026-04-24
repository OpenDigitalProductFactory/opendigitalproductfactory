import { fileURLToPath } from "url";

const turbopackRoot = fileURLToPath(new URL("../..", import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@dpf/db", "@dpf/validators"],
  turbopack: {
    root: turbopackRoot,
  },
  outputFileTracingExcludes: {
    "**/*": ["./node_modules/@swc/core*", "./node_modules/esbuild*"],
  },
};

export default config;
