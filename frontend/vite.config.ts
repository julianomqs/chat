import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: ["frontend"],
    proxy: {
      "/api": "http://backend:3000",
      "/socket.io": {
        target: "http://backend:3000",
        ws: true
      }
    }
  }
});
