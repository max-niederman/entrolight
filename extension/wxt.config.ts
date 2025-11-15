import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-svelte"],
  manifest: {
    host_permissions: ["http://127.0.0.1:8000/*"],
  },
});
