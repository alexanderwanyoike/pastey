import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const daemonUrl = env.VITE_JOLT_DAEMON_URL || "http://127.0.0.1:9862";

  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        "/app/v1": {
          target: daemonUrl,
          changeOrigin: true
        },
        "/api/v1": {
          target: daemonUrl,
          changeOrigin: true
        }
      }
    }
  };
});
