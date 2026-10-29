/** (2026-10-22 보완대책 7) 사이트 데이터 자동 재생성 PR 요약: 바뀐 사업 수(생성 시각은 무시), 페르소나 상위 5개 변화, 머지 가능 여부 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GONE_LIMIT, autoMerge, compareBundles, failedFromVitest, nearName, personaDiff, readiness } from "../../scripts/data-rebuild-summary";

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

describe("(2026-10-28) 원문 오타로 이름이 한두 글자 달라진 사업은 '이름만 바뀜'", () => {
  it("글자 몇 개만 다른 이름 (메뉴판 PDF 원문 오타 42개)", () => {
    expect(nearName("노인치과임플란트비용지원", "노인치과임플라트비용지원")).toBe(true);
    expect(nearName("AIIoT기반어르신건강관리", "AIloT기반어르신건강관리")).toBe(true);
    expect(nearName("방문운동지원", "방문문동지원")).toBe(true);
    expect(nearName("노인장기요양주야간보호기관내단기보호시범사업", "노인장기요양주야간보호기관내단기보험시법사업")).toBe(true);
    expect(nearName("주야간보호기관내단기보호서비스", "주야간보호관리내단기보호서비스")).toBe(true);
  });
  it("짧은 이름이나 다른 사업은 아님", () => {
    expect(nearName("주거지원", "주거환경")).toBe(false);
    expect(nearName("방문요양", "방문간호")).toBe(false);
    expect(nearName("노인맞춤돌봄서비스", "장애인활동지원")).toBe(false);
    // 붙은 두 글자가 바뀐 짧은 이름은 다른 세부 사업
    expect(nearName("장기요양재가급여방문요양", "장기요양재가급여방문간호")).toBe(false);
  });
  it("번들 비교에서 같은 지역의 오타 이름은 renamed로", () => {
    const a = dir({ "national.json": { programs: [] }, "sigungu/11200.json": { programs: [p("g11200.icare-1", "노인 치과 임플란트 비용지원")] } });
    const b = dir({ "national.json": { programs: [] }, "sigungu/11200.json": { programs: [p("g11200.icare-9", "노인 치과 임플라트 비용지원")] } });
    expect(compareBundles(a, b).removedBy.renamed.map((x) => x.name)).toEqual(["노인 치과 임플란트 비용지원"]);
  });
});

describe("(2026-10-28) 하나였던 항목이 세부 항목으로 나뉘어 전국 사업 운영 정보로 옮겨진 경우", () => {
  it("'장기요양서비스' → 운영 정보 '장기요양서비스 (방문요양)'·'(방문간호)'면 ops", () => {
    const a = dir({ "national.json": { programs: [] }, "sigungu/11290.json": { programs: [p("g11290.icare-1", "장기요양서비스")] } });
    const b = dir({
      "national.json": { programs: [p("n.ltc", "노인장기요양보험")] },
      "sigungu/11290.json": { programs: [], localOps: { "n.ltc": [{ name: "장기요양서비스 (방문요양)" }, { name: "장기요양서비스 (방문간호)" }] } },
    });
    expect(compareBundles(a, b).removedBy.ops.map((x) => x.name)).toEqual(["장기요양서비스"]);
  });
});
