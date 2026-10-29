/**
 * (2026-10-28) 메뉴판 PDF 원문의 사업명 오타 — 화면은 원문 이름 그대로, 바른 표기는 검색 별칭으로만 (소유자 결정 ②).
 * 성동구 '노인 치과 임플라트 비용지원'을 '임플란트'로 찾을 수 있어야 한다.
 */
import { describe, expect, it } from "vitest";
import fixesJson from "../curated/menu-name-fixes.json";
import { menuNameAlias, type MenuNameFix } from "../src/sources/icare";

const fixes = fixesJson.fixes as MenuNameFix[];

describe("메뉴판 사업명 오타 → 검색 별칭", () => {
  it("원문 이름이 목록에 있으면 바른 표기를 별칭으로 (띄어쓰기·호환 문자 차이는 무시)", () => {
    expect(menuNameAlias("노인 치과 임플라트 비용지원", fixes)).toBe("노인 치과 임플란트 비용지원");
    expect(menuNameAlias("노인 치과  임플라트비용지원", fixes)).toBe("노인 치과 임플란트 비용지원");
    expect(menuNameAlias("노인 치과 임플란트 비용지원", fixes)).toBeUndefined();
    expect(menuNameAlias("방문건강관리", fixes)).toBeUndefined();
  });
  it("목록의 모든 항목: 원문과 별칭이 다르고, 지역과 근거(예전 수집본 사업 ID)가 있음", () => {
    expect(fixes.length).toBeGreaterThan(0);
    for (const f of fixes) {
      expect(f.alias.replace(/\s/g, "")).not.toBe(f.name.replace(/\s/g, ""));
      expect(f.where).toBeTruthy();
      expect(f.evidence).toMatch(/^g\d{5}\.icare-/);
    }
  });
});
