import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "pipeline/tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup-date.ts"],
    // 전국 번들을 읽어 판정하는 테스트는 로컬에서도 1초 안팎 — 자동 재생성(GitHub 실행기, 여러 파일 동시 실행)에서
    // 기본 5초를 넘겨 골라서 찾기 5개가 실패로 나왔다 (2026-10-26 #62)
    testTimeout: 30_000,
  },
});
