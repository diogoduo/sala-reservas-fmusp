import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_DEV_API_TARGET || "http://localhost:3333";

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    server: {
      port: 5173,
      // Túneis temporários para mostrar o app rodando localmente (Cloudflare
      // quick tunnel e port forwarding do VS Code). Só esses domínios: o Vite
      // recusa outros hosts por segurança (proteção contra DNS rebinding).
      allowedHosts: [".trycloudflare.com", ".devtunnels.ms"],
      // O front chama sempre /api/...; em dev o Vite encaminha ao back-end
      // (mesma origem => cookies de sessão funcionam sem configuração extra).
      proxy: { "/api": { target: apiTarget, changeOrigin: true } },
    },
  };
});
