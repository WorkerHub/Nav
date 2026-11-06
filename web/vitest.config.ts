import { readFileSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 与 vite.config.ts 同一口径：版本号从仓库根 package.json 在构建时注入
const rootPackage = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
) as { version: string };

// web 侧单测：jsdom + Testing Library（组件渲染断言）与纯函数/接口层断言。
// 与 vite.config.ts 分开，避免测试配置（setupFiles / environment）混进生产构建。
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPackage.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    css: false,
    restoreMocks: true,
  },
});
