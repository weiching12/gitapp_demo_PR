import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  define: {
    "import.meta.env.VITE_DATA_MODE": JSON.stringify(mode === "cloudflare" ? "api" : "demo"),
  },
}));
