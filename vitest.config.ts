import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.spec.ts"],
          exclude: ["test/e2e/**/*.e2e.spec.ts"],
          environment: "node",
          mockReset: true,
          restoreMocks: true,
        },
      },
      {
        test: {
          name: "e2e",
          include: ["test/e2e/**/*.e2e.spec.ts"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 60_000,
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
