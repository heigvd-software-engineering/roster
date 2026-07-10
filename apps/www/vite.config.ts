import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  // basicSsl is DEV-ONLY (https://localhost:3000, the origin SWITCH knows).
  // `react-router build` prerenders the shell through an internal vite
  // PREVIEW server (resolved with command "serve" too) that must stay
  // http: — hence the isPreview guard, not just the command.
  plugins: [
    tailwindcss(),
    reactRouter(),
    ...(command === "serve" && !isPreview ? [basicSsl()] : []),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  // Dev only: Vite owns https://localhost:3000 (the origin SWITCH redirect
  // URIs and cookies are registered for) so the SPA gets HMR, and /api is
  // proxied to the Worker on :8788. In production the Worker serves both
  // from one origin — no proxy involved.
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8788",
        changeOrigin: true,
      },
    },
  },
}));
