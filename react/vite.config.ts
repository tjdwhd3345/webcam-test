import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    https: {
      // key: readFileSync(new URL("./.cert/localhost-key.pem", import.meta.url)),
      // cert: readFileSync(new URL("./.cert/localhost-cert.pem", import.meta.url)),
      key: readFileSync(new URL("./.cert/localhost+2-key.pem", import.meta.url)),
      cert: readFileSync(new URL("./.cert/localhost+2.pem", import.meta.url)),
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@lib": fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
});
