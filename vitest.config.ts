import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

function workspaceSource(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      "@pi-web/protocol/prompt-images": workspaceSource(
        "./packages/protocol/src/prompt-images.ts"
      ),
      "@pi-web/protocol/theme-tokens": workspaceSource(
        "./packages/protocol/src/theme-tokens.ts"
      ),
      "@pi-web/protocol": workspaceSource("./packages/protocol/src/index.ts"),
      "@pi-web/config": workspaceSource("./packages/config/src/index.ts"),
      "@pi-web/shared": workspaceSource("./packages/shared/src/index.ts"),
      "@pi-web/pi-rpc": workspaceSource("./packages/pi-rpc/src/index.ts"),
      "@pi-web/pi-session-reader": workspaceSource(
        "./packages/pi-session-reader/src/index.ts",
      ),
      "@pi-web/sessiond": workspaceSource("./apps/sessiond/src/index.ts"),
      "@pi-web/server": workspaceSource("./apps/server/src/index.ts"),
    },
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "tests/**/*.test.ts"
    ],
    exclude: ["tests/e2e/**", "**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/dist/**", "apps/web/**", "tests/fixtures/**"]
    },
    testTimeout: 15_000
  }
});
