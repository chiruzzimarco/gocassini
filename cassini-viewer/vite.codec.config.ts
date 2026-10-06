import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// The codec as a standalone static site: codec.html and its assets, with
// public/ copied alongside (including any local codec-sfx/ recordings). Serve
// it next to a catalog.json and the meetings it lists.
export default defineConfig({
  plugins: [svelte()],
  base: "./",
  build: {
    outDir: "dist/codec",
    emptyOutDir: true,
    rollupOptions: {
      input: "codec.html",
    },
  },
});
