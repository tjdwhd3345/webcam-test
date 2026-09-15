import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@asis": fileURLToPath(new URL("./src/asis", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
  },
});
