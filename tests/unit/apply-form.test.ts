/**
 * (2026-10-16 회의: 신청서 자동 채우기) 주민센터 공통 신청서 「사회보장급여 신청(변경)서」
 * (사회보장급여 관련 공통서식에 관한 고시 별지 제1호서식, 2026. 5. 1. 개정)에서 체크할 칸을 사업 이름으로 찾는다.
 */
import { describe, expect, it } from "vitest";
import { COMMON_FORM, formAttachments, formChecks } from "@/lib/client/applyForm";

const labels = (names: string[]) => formChecks(names.map((name) => ({ name }))).map((c) => `${c.section}:${c.label}`);

describe("공통 신청서 체크 칸", () => {
  it("서식 이름·근거", () => {
    expect(COMMON_FORM.title).toBe("사회보장급여 신청(변경)서");
    expect(COMMON_FORM.basis).toContain("별지 제1호서식");
  });
  it("기초생활보장·기초연금·아동수당·부모급여·양육수당", () => {
    expect(labels(["생계급여(맞춤형 급여)", "주거급여", "의료급여 (의료급여)", "기초연금", "아동수당 지급", "부모급여 지원", "가정양육수당 지원"])).toEqual([
      "기초생활보장:생계급여",
      "기초생활보장:의료급여",
      "기초생활보장:주거급여",
      "영유아:부모급여(현금)",
      "영유아:양육수당 — 가정양육수당",
      "아동수당:아동수당",
      "노인:기초연금",
    ]);
  });
  it("이름이 비슷해도 다른 서식·다른 사업은 넣지 않는다", () => {
    expect(labels(["입양아동 양육수당 지원", "의료급여 본인부담 면제(외래)", "기초연금 수급자 확인서", "긴급복지 생계지원", "북한이탈주민 자산형성 지원 (미래행복통장)", "무료 소송대리 서비스(한부모가족)", "영유아보육료 지원"])).toEqual([]);
  });
  it("장애아동수당은 아동수당이 아니라 장애인 칸", () => {
    expect(labels(["장애아동수당"])).toEqual(["장애인:장애아동수당"]);
  });
  it("같은 칸은 한 번만, 어떤 사업 때문인지 함께", () => {
    const c = formChecks([{ name: "생계급여" }, { name: "국민기초생활보장 생계급여" }]);
    expect(c).toHaveLength(1);
    expect(c[0].for).toEqual(["생계급여", "국민기초생활보장 생계급여"]);
  });
  it("함께 낼 서식 (서식 4쪽 '신청시 구비서식' 표)", () => {
    expect(formAttachments(formChecks([{ name: "기초연금" }]))).toEqual(["소득·재산 신고서(별지 제1호의2서식)", "금융정보 등 제공 동의서(별지 제1호의3서식)"]);
    expect(formAttachments(formChecks([{ name: "차상위 본인부담경감" }]))).toEqual(["소득·재산 신고서(별지 제1호의2서식)"]);
    expect(formAttachments(formChecks([{ name: "아동수당" }]))).toEqual([]);
  });
});
