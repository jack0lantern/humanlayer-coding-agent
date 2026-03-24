import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 5_000,
    include: ["src/**/*.{test,spec,eval}.?(c|m)[jt]s?(x)"],
  },
});
