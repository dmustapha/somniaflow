import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand:        "#EC4899",
        "sf-bg":      "#06020a",
        "sf-surface": "#0d0812",
        "sf-surf2":   "#160d1e",
        "sf-border":  "#221730",
        "sf-ok":      "#4ade80",
        "sf-cyan":    "#22d3ee",
        "sf-hi":      "#fce7f3",
        "sf-mid":     "#9a869e",
        "sf-lo":      "#4a3a52",
      },
      fontFamily: {
        mono:  ["var(--font-mono)", "ui-monospace", "monospace"],
        sans:  ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
