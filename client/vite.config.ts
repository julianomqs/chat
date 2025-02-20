import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react({ jsxImportSource: "@emotion/react" })],
  server: {
    host: "0.0.0.0",
    port: 8080,
    proxy: {
      "/api": {
        target: "http://server:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      },
      "/socket.io": {
        target: "http://server:3000/socket.io",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/socket.io/, ""),
        ws: true
      }
    }
  }
});
