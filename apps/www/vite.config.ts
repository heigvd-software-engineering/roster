import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  // Dev only: HMR app on :5173, but proxy /api to the running Worker (:3000)
  // so auth + data work live. Session cookie is localhost-scoped, so it flows.
  // (In production the Worker serves both from one origin — no proxy involved.)
  server: {
    proxy: {
      "/api": {
        target: "https://localhost:3000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
