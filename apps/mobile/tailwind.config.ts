import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "./dynamic/**/*.{ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        surface: {
          1: "var(--dpf-surface-1)",
          2: "var(--dpf-surface-2)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
