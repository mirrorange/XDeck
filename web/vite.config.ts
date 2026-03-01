import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:9210",
        ws: true,
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:9210",
        changeOrigin: true,
      },
    },
  },
});
