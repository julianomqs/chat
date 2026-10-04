import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    clearMocks: true,
    restoreMocks: true,
    include: ["tests/**/*.test.tsx"],
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.tsx"],
      exclude: ["src/**/*.d.ts"]
    }
  }
});
