/** (2026-10-22 보완대책 7) 사이트 데이터 자동 재생성 PR 요약: 바뀐 사업 수(생성 시각은 무시), 페르소나 상위 5개 변화, 머지 가능 여부 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GONE_LIMIT, autoMerge, compareBundles, failedFromVitest, personaDiff, readiness } from "../../scripts/data-rebuild-summary";

const dir = (files: Record<string, unknown>) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bundles-"));
  for (const [f, j] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), JSON.stringify(j));
  }
  return d;
};
const p = (id: string, name: string, extra: object = {}) => ({ id, name, ...extra });

describe("번들 비교", () => {
  it("생성 시각만 다르면 바뀐 것 없음", () => {
    const a = dir({ "national.json": { generatedAt: "2026-10-08", programs: [p("n.a", "가")] } });
    const b = dir({ "national.json": { generatedAt: "2026-10-23", programs: [p("n.a", "가")] } });
    expect(compareBundles(a, b)).toMatchObject({ added: [], removed: [], changed: [], changedFiles: 0 });
  });
  it("사업 추가·삭제·변경을 id로 (시군구 파일까지)", () => {
    const a = dir({ "national.json": { programs: [p("n.a", "가"), p("n.b", "나")] }, "sigungu/41110.json": { programs: [p("g.c", "다", { target: "노인" })] } });
    const b = dir({ "national.json": { programs: [p("n.a", "가"), p("n.d", "라")] }, "sigungu/41110.json": { programs: [p("g.c", "다", { target: "노인·장애인" })] } });
    const r = compareBundles(a, b);
    expect(r.added.map((x) => x.name)).toEqual(["라"]);
    expect(r.removed.map((x) => x.name)).toEqual(["나"]);
    expect(r.changed.map((x) => x.name)).toEqual(["다"]);
    expect(r.changedFiles).toBe(2);
  });
});

describe("페르소나 상위 5개 변화", () => {
  it("바뀐 페르소나만", () => {
    expect(personaDiff({ a: ["1", "2"], b: ["3"] }, { a: ["1", "2"], b: ["4"] })).toEqual([{ persona: "b", before: ["3"], after: ["4"] }]);
  });
});

describe("머지 가능 여부", () => {
  it("테스트 실패·복지로 상세 남음이면 초안, 이유를 적는다", () => {
    expect(readiness({ failedTests: [], bokjiroRemaining: 0 })).toEqual({ ready: true, reasons: [] });
    const r = readiness({ failedTests: ["forms-catalog > accounts for every …"], bokjiroRemaining: 120 });
    expect(r.ready).toBe(false);
    expect(r.reasons.join(" ")).toContain("서식");
    expect(r.reasons.join(" ")).toContain("120");
  });
});

describe("(2026-10-25) 빠진 사업이 어디로 갔는지", () => {
  it("운영 정보로 옮김 · 같은 원천 ID로 합쳐짐 · 이름만 바뀜 · 새 결과에 없음", () => {
    const src = (source: string, id: string) => ({ sources: [{ source, id }] });
    const a = dir({
      "national.json": { programs: [] },
      "sigungu/41110.json": { programs: [p("g41110.icare-1", "다제약물 관리사업"), p("g41110.bokjiro-W1", "효행수당", src("bokjiro", "W1")), p("g41110.icare-2", "가사지원"), p("g41110.icare-3", "도시락 배달")] },
    });
    const b = dir({
      "national.json": { programs: [p("n.icare-poly", "다제약물 관리사업")] },
      "sigungu/41110.json": {
        programs: [p("g41110.gov24-9", "효행지원금", { sources: [{ source: "gov24", id: "9" }, { source: "bokjiro", id: "W1" }] }), p("g41110.icare-7", "함께돌봄 가사지원")],
        localOps: { "n.icare-poly": [{ name: "다제약물 관리 사업" }] },
      },
    });
    const r = compareBundles(a, b);
    expect(Object.fromEntries(Object.entries(r.removedBy).map(([k, v]) => [k, v.map((x) => x.name)]))).toEqual({
      ops: ["다제약물 관리사업"], merged: ["효행수당"], renamed: ["가사지원"], gone: ["도시락 배달"],
    });
  });
});

describe("(2026-10-26) 실패한 테스트에 이유 첫 줄", () => {
  it("시간 초과처럼 이유가 보이게, 색 코드는 지움", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vitest-")), "v.json");
    fs.writeFileSync(f, JSON.stringify({ testResults: [{ name: "/x/tests/unit/guided.test.ts", assertionResults: [
      { status: "failed", fullName: "경로 1", failureMessages: ["\u001b[31mError: Test timed out in 5000ms.\u001b[39m\nIf this is a long-running test…"] },
      { status: "passed", fullName: "경로 2" },
    ] }] }));
    expect(failedFromVitest(f)).toEqual(["guided > 경로 1 — Error: Test timed out in 5000ms."]);
  });
});

describe("(2026-10-27) 자동 머지 — 점검을 모두 통과한 날만", () => {
  const ok = { ready: { ready: true, reasons: [] }, personaChanged: 0, gone: 0 };
  it("테스트 통과 · 페르소나 그대로 · 없어진 사업 기준 이하면 자동 머지", () => {
    expect(autoMerge(ok)).toEqual({ ok: true, reasons: [] });
    expect(autoMerge({ ...ok, gone: GONE_LIMIT }).ok).toBe(true);
  });
  it("하나라도 걸리면 보류, 이유를 모두 적는다", () => {
    const r = autoMerge({ ready: { ready: false, reasons: ["테스트 2개 실패"] }, personaChanged: 3, gone: GONE_LIMIT + 1 });
    expect(r.ok).toBe(false);
    expect(r.reasons).toHaveLength(3);
    expect(r.reasons[0]).toBe("테스트 2개 실패");
    expect(r.reasons[1]).toContain("페르소나 3개");
    expect(r.reasons[2]).toContain(String(GONE_LIMIT + 1));
  });
});
