import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // 로컬 빌드의 페이지 수집·정적 생성 작업자가 메모리를 과점유하지 않도록 제한
  experimental: { cpus: 2 },
  // /workspace 상위의 package-lock.json 을 루트로 오인하지 않도록 고정
  turbopack: { root: path.resolve(__dirname) },
  async headers() {
    return [
      {
        // 번들은 데이터 버전(v1) 단위로 교체 — 짧게 캐시하고 재검증
        source: "/bundles/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=600, stale-while-revalidate=86400" }],
      },
      // 신청서 원본·HWPX 변환본: 운영(Vercel)이 정적 파일마다 'inline; filename="저장용 이름"'을 붙여
      // 화면의 download="사업 신청서 제목.hwpx"보다 앞서 저장용 이름(ordin-…-27a18064215a.hwpx)으로 받아지던 것 —
      // 이름 없는 inline으로 덮어 미리보기는 그대로, 받을 때는 화면에서 정한 제목으로 (2026-10-25)
      ...["/forms/files/:path*", "/forms/writing/v1/converted/:path*"].map((source) => ({
        source,
        headers: [{ key: "Content-Disposition", value: "inline" }],
      })),
    ];
  },
};

export default nextConfig;
