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
          surface3: "#121220",
          accent: "#7c8cf8",
          muted: "#8888a0",
          border: "#2a2a40",
          success: "#4ade80",
          warning: "#fbbf24",
          error: "#f87171",
          info: "#38bdf8",
          "text-secondary": "#b8b8cc",
        },
      },
      boxShadow: {
        "dpf-xs": "0 1px 2px rgba(0, 0, 0, 0.15)",
        "dpf-sm": "0 1px 3px rgba(0, 0, 0, 0.2)",
        "dpf-md": "0 4px 6px rgba(0, 0, 0, 0.2)",
        "dpf-lg": "0 10px 15px rgba(0, 0, 0, 0.25)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.25s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
