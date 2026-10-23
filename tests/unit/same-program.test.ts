/**
 * (2026-10-16 소유자: '보육료 지원'과 '영유아보육료 지원'이 같은 복지인데 두 개로 나뉘어 보임)
 * 출처(정부24·복지로·복지 백과)마다 이름이 다른 같은 전국 제도는 한 묶음으로 보인다.
 * 같은 이름 아래 실제로 따로 신청하는 세부 항목(의료급여 요양비, 긴급복지 생계·의료 등)은 묶지 않는다.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { variantKey } from "@/lib/client/results";
import { EMPTY_EXTRAS, buildView, scoreV2, type Situation } from "@/lib/client/v2";
import { refineProgram } from "@/lib/data/refine";
import { EMPTY_PROFILE, type Profile } from "@/lib/engine/profile";
import { parseSituation, parsedExtras } from "@/lib/client/parse";
import type { Program, RegionIndex } from "@/lib/data/types";

const load = (f: string): Program[] => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).programs : []);
const regions = JSON.parse(readFileSync("public/bundles/v1/regions.json", "utf8")) as RegionIndex;
const national = load("public/bundles/v1/national.json");

const SAME: string[][] = [
  ["보육료 지원", "영유아보육료 지원"],
  ["그 밖의 연장형 보육료 지원", "그 밖의 연장형 보육료 등 지원"],
  // 정부24 '유아학비 (누리과정) 지원'(000000465790)은 원천에서 빠짐 (2026-10-17 수집분부터) — 복지로 쪽만 남아 묶을 짝이 없음
  ["국민기초생활보장 생계급여", "생계급여", "생계급여(맞춤형 급여)"],
  ["주거급여", "주거급여 (맞춤형 급여)"],
  ["교육급여", "교육급여(맞춤형 급여)"],
  ["의료급여", "의료급여 (의료급여)"],
  ["자활근로", "자활근로(기초, 차상위)"],
  ["자립준비청년 자립수당", "자립준비청년(보호종료아동) 자립수당 지급", "자립준비청년 자립수당 지급"],
  ["통합문화이용권(문화누리카드)", "통합문화이용권(문화누리카드) 서비스", "통합문화이용권"],
  ["매입임대주택", "기존주택 매입임대주택 지원사업", "기존주택등 매입임대주택 지원사업"],
  ["북향민 정착금 지원", "(북한이탈주민)정착금 지원"],
  ["북한이탈주민 자산형성 지원 (미래행복통장)", "북한이탈주민 자산형성지원제도(미래행복통장)"],
  ["건강보험 임신·출산 진료비 지원", "건강보험 임신출산 진료비(국민행복카드)"],
  ["실종아동 보호 및 지원", "실종아동 등 보호 및 지원"],
  ["예술활동준비금 지원 사업(舊 창작준비금 지원 사업)", "예술활동준비금 지원"],
  ["산림복지서비스이용권(바우처) 지급", "산림복지서비스이용권"],
  ["사회보험사각지대해소", "사회보험사각지대해소 사업(두루누리 사회보험료 지원사업)"],
  ["디지털미디어 피해 청소년 회복 지원", "디지털미디어 피해 청소년 회복 지원 사업(청소년 인터넷·스마트폰 과의존 치료비 지원)"],
  ["기부식품등 제공사업(푸드뱅크·푸드마켓)", "기부식품 등 제공사업(푸드뱅크)"],
  ["통합사례관리(희망복지지원단)", "희망복지지원단 통합사례관리"],
  ["법률구조", "법률구조 제도"],
  ["무료 법률상담 서비스(국민)", "무료법률상담"],
  ["발달장애인 주간활동서비스", "성인 발달장애인 주간활동서비스"],
  ["독거노인·장애인 응급안전안심서비스", "응급안전안심서비스"],
  ["노인 안검진 및 개안수술", "노인 안검진·개안수술"],
  ["차상위 본인부담 경감대상자 지원", "차상위 본인부담경감"],
  ["보건소 방문건강관리 서비스", "방문건강관리"],
  ["의료급여 본인부담 면제(외래)", "의료급여본인부담면제"],
  ["중증장애인직업재활 지원(훈련수당)", "중증장애인직업재활지원"],
  ["경남동행론", "경남동행론(직접대출)"],
  ["자산형성지원사업(희망저축계좌Ⅰ, Ⅱ)", "희망저축계좌(Ⅰ·Ⅱ)"],
];

/** 이름은 비슷해도 따로 신청하는 항목 — 서로 묶이면 안 됨 */
const APART: [string, string][] = [
  ["의료급여 (의료급여)", "의료급여 (요양비)"],
  ["의료급여", "의료급여 (임신·출산진료비)"],
  ["긴급복지지원", "긴급복지 생계지원"],
  ["희망저축계좌(Ⅰ·Ⅱ)", "자산형성지원사업(희망저축Ⅰ)"],
  ["저소득층 에너지효율개선(난방지원)", "저소득층 에너지효율개선(냉방지원)"],
  ["치매검진 지원", "치매 치료관리비 지원"],
  ["해산급여", "장제급여"],
  ["법률구조", "무료법률상담"],
  ["보육료 지원", "다문화보육료지원"],
  ["보육료 지원", "그 밖의 연장형 보육료 지원"],
  ["영유아보육료 지원", "유아교육비·보육료 추가지원"],
  ["생계급여", "긴급복지 생계지원"],
];

describe("출처마다 이름이 다른 같은 전국 제도", () => {
  it("목록의 이름이 모두 전국 데이터에 있다", () => {
    const names = new Set(national.map((p) => p.name));
    for (const n of [...SAME.flat(), ...APART.flat()]) expect(names.has(n), n).toBe(true);
  });
  for (const set of SAME) {
    it(`한 묶음: ${set.join(" = ")}`, () => {
      expect(new Set(set.map(variantKey)).size).toBe(1);
    });
  }
  for (const [a, b] of APART) {
    it(`따로: ${a} ≠ ${b}`, () => {
      expect(variantKey(a)).not.toBe(variantKey(b));
    });
  }
  it("묶음끼리는 서로 섞이지 않는다", () => {
    expect(new Set(SAME.map((s) => variantKey(s[0]))).size).toBe(SAME.length);
  });
});

const viewOf = (text: string) => {
  const r = parseSituation(text, regions, { year: 2026, month: 10, day: 16 });
  const p: Profile = { ...EMPTY_PROFILE };
  for (const [k, v] of Object.entries(r.profile)) if (v !== null && v !== "unknown" && !(Array.isArray(v) && !v.length)) (p as unknown as Record<string, unknown>)[k] = v;
  const ex = parsedExtras(r);
  const sit: Situation = { profile: p, x: { ...EMPTY_EXTRAS, benefits: {}, traits: {}, ...ex, ageSpan: ex.ageSpan ?? null }, mode: r.mode ?? "self" };
  const progs = [...load(`public/bundles/v1/sigungu/${p.sigungu}.json`), ...load(`public/bundles/v1/sido/${p.sido}.json`), ...national].map(refineProgram);
  return buildView(scoreV2(progs, sit), sit, 12);
};
const groupsOf = (view: ReturnType<typeof viewOf>, re: RegExp) =>
  (["fit", "office", "ask", "no"] as const).flatMap((b) => view[b].filter((g) => g.some((i) => re.test(i.s.program.name))).map((g) => ({ b, g })));

describe("결과 화면: 같은 제도가 두 번 나오지 않음", () => {
  it("전국 별칭과 이름이 겹쳐도 동작구 법률상담의 미응답 조건을 없애지 않는다", () => {
    const view = viewOf("서울 동작구 살아요");
    const regional = groupsOf(view, /^동작구 무료법률 상담 지원$/);
    expect(regional).toHaveLength(1);
    expect(regional[0].b).toBe("ask");
    expect(view.questions.some((q) => q.keys.includes(regional[0].g[0].s.group))).toBe(true);
  });
  it("고양시 4살 아이(어린이집) 엄마 — 보육료 지원/영유아보육료 지원이 한 카드", () => {
    expect(groupsOf(viewOf("고양시 사는 35살 엄마, 4살 아이 하나 어린이집 다녀요"), /^(영유아)?보육료 지원$/).length).toBe(1);
  });
  it("출처마다 판정이 갈리면 조건이 맞은 쪽으로 — 임신 5개월: 건강보험 임신출산 진료비가 '답하면 정해져요'로 밀리지 않음", () => {
    const found = groupsOf(viewOf("임신 5개월이에요 성남"), /^건강보험 임신.?출산 진료비/);
    expect(found.length).toBe(1);
    expect(found[0].b).not.toBe("ask");
    expect(found[0].g[0].s.program.name).toBe("건강보험 임신출산 진료비(국민행복카드)");
  });
});
