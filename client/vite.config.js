import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The server URL is also configurable at runtime from the app itself
// (see src/lib/socket.js), so this proxy is only a convenience for local dev.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expose on the LAN so guests can open the dev server directly
    port: 5173,
    proxy: {
      "/uploads": "http://localhost:4000",
      "/api": "http://localhost:4000",
    },
  },
});
