import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function getServerPort(): string {
  const portFile = path.join(root, ".server-port");
  if (existsSync(portFile)) {
    try {
      const { port } = JSON.parse(readFileSync(portFile, "utf8")) as { port?: number };
      if (typeof port === "number") return String(port);
    } catch {
      // ignored
    }
  }
  return "3000";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  const serverPort = env.SERVER_PORT ?? getServerPort();
  const webPort = parseInt(env.WEB_PORT ?? "5173", 10);

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: webPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
