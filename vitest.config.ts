import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the SDK's optional peer dep to this app's copy so the test
      // suite's vi.mock of @tauri-apps/api/core applies inside the SDK's
      // transports (the file:-installed SDK cannot see our node_modules).
      "@tauri-apps/api/core": fileURLToPath(
        new URL("./node_modules/@tauri-apps/api/core.js", import.meta.url)
      ),
    },
  },
  test: {
    server: {
      deps: {
        // Process jolt-sdk (do not externalize) so mocks and the alias apply.
        inline: ["jolt-sdk"],
      },
    },
  },
});
