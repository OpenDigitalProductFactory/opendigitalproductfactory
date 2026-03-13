import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // DPF design tokens — overridden per branding config at runtime
        dpf: {
          bg: "#0f0f1a",
          surface1: "#1a1a2e",
          surface2: "#161625",
          accent: "#7c8cf8",
          muted: "#8888a0",
          border: "#2a2a40",
        },
      },
    },
  },
  plugins: [],
};

export default config;
