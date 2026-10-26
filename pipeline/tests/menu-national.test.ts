/**
 * (2026-10-22 외부 점검 P1-1) 중앙부처 사업이 메뉴판을 낸 지역에만 붙던 문제 — 소유자 검토표 결정 반영.
 * same = 그 전국 사업의 '우리 지역 운영 정보'로 묶음 / promote = 메뉴판 원문으로 전국 사업 하나를 만들고 지역 행은 운영 정보로.
 * 정하지 않았거나 지역 사업·보류는 지금처럼 그 지역 사업.
 */
import { describe, expect, it } from "vitest";
import { mergeAcrossSources, type DedupStats } from "../src/dedup";
import { applyMenuDecisions, menuKey, type MenuDecisions } from "../src/menuNational";
import type { SourceRecord } from "../src/sources/record";
import { nameKey } from "../src/normalize/names";

// 검증용 최소 레코드 (실제 사업 데이터 아님)
const rec = (o: Partial<SourceRecord>): SourceRecord => ({
  source: "gov24", sourceId: Math.random().toString(36).slice(2), name: "x", key: nameKey(o.name ?? "x"), summary: "", orgType: "central", scope: "national",
  category: "신체건강", tags: [], fetchedAt: "2026-10-22", trust: "A", badges: [], draft: { origin: "none", logic: null, unstructured: [], core: false }, ...o,
});
const menu = (name: string, sgg: string, o: Partial<SourceRecord> = {}) =>
  rec({ source: "icare", sourceId: `0075:1:${sgg}`, name, orgType: "local", scope: "sigungu", sidoCode: "41000", sigunguCodes: [sgg], icareType: "전국", trust: "B", url: `https://www.mohw.go.kr/${sgg}`, ...o });
const fresh = (): DedupStats => ({ d1Exact: 0, d2Substantive: 0, crossMerged: [], absorbedAsLocalOps: 0, blockedByLevel: 0 });

const DEC: MenuDecisions = {
  same: [{ key: "노인맞춤돌봄서비스", names: ["노인맞춤돌봄 서비스"], target: "gov24:SSE000000050" }],
  promote: [{ slug: "national-health-screening", name: "국가건강검진", keys: ["국가건강검진"], names: ["국가건강검진"] }],
};

describe("검토표 이름 묶음 열쇠", () => {
  it("괄호 설명과 띄어쓰기·가운뎃점을 뗀다", () => {
    expect(menuKey("노인맞춤돌봄 서비스(퇴원환자 단기집중 서비스)")).toBe("노인맞춤돌봄서비스");
    expect(menuKey("국가건강검진 (출장건강검진)")).toBe("국가건강검진");
    expect(menuKey("독거노인·장애인 응급안전안심서비스")).toBe("독거노인장애인응급안전안심서비스");
  });
});

describe("검토표 결정 반영", () => {
  it("같은 사업: 메뉴판 '전국' 행이 이름이 달라도 정한 전국 사업의 지역 운영 정보로", () => {
    const nat = rec({ sourceId: "SSE000000050", name: "노인맞춤돌봄서비스" });
    const row = menu("노인맞춤돌봄 서비스(퇴원환자 단기집중 서비스)", "41110");
    const { records: input } = applyMenuDecisions([nat, row], DEC);
    const s = fresh();
    const { records, localOps } = mergeAcrossSources(input, s);
    expect(records).toEqual([nat]);
    expect(localOps.get(nat)?.get("41110")?.[0].name).toBe("노인맞춤돌봄 서비스(퇴원환자 단기집중 서비스)");
  });
  it("같은 사업: 정한 전국 사업이 다른 원천 사업에 병합돼 있어도 그 사업으로 찾는다", () => {
    const g = rec({ source: "gov24", sourceId: "G9", name: "재가급여", owner: "보건복지부" });
    const b = rec({ source: "bokjiro", sourceId: "WLF9", name: "재가급여", owner: "보건복지부" });
    const row = menu("장기요양 재가급여", "41110");
    const dec: MenuDecisions = { same: [{ key: "장기요양재가급여", names: ["장기요양 재가급여"], target: "bokjiro:WLF9" }], promote: [] };
    const { records, localOps } = mergeAcrossSources(applyMenuDecisions([g, b, row], dec).records, fresh());
    expect(records).toHaveLength(1);
    expect(localOps.get(records[0])?.has("41110")).toBe(true);
  });
  it("같은 사업: 정한 전국 사업이 이번 데이터에 없으면 지금처럼 지역 사업으로 두고 센다", () => {
    const row = menu("노인맞춤돌봄 서비스", "41110");
    const s = fresh();
    const { records } = mergeAcrossSources(applyMenuDecisions([row], DEC).records, s);
    expect(records).toEqual([row]);
    expect(s.menuTargetMissing).toEqual(["노인맞춤돌봄 서비스 → gov24:SSE000000050"]);
  });
  it("전국으로 올림: 메뉴판 원문으로 전국 사업 하나, 각 지역 행은 그 사업의 운영 정보", () => {
    const rows = [
      menu("국가건강검진", "41110", { summary: "고혈압, 당뇨병 등 조기 치료 유도", target: "노인, 장애인", sourceId: "0075:1:1:1:1" }),
      menu("국가건강검진(장애친화 검진기관)", "41130", { summary: "장애친화 검진기관 운영", target: "장애인", sourceId: "0076:2:1:1:1" }),
      menu("국가건강검진", "41150", { summary: "고혈압, 당뇨병 등 조기 치료 유도", target: "노인, 장애인", sourceId: "0077:3:1:1:1" }),
    ];
    const { records: input, promoted } = applyMenuDecisions(rows, DEC);
    expect(promoted).toHaveLength(1);
    const p = promoted[0];
    // 이름은 정한 이름(원문 표기 중 하나), 설명·대상은 가장 많이 쓴 원문 그대로, 지역 없음
    expect(p).toMatchObject({ source: "icare", sourceId: "national-health-screening", name: "국가건강검진", scope: "national", orgType: "central", summary: "고혈압, 당뇨병 등 조기 치료 유도", target: "노인, 장애인" });
    expect(p.sidoCode).toBeUndefined();
    expect(p.sigunguCodes).toBeUndefined();
    // 원문 주소: 한 지역 메뉴판 글이 아니라 보건복지부 통합돌봄 메뉴판 목록 (2026-10-26 재생성에서 주소 없는 출처 7개)
    expect(p.url).toBe("https://www.mohw.go.kr/menu.es?mid=a60600000000");
    const { records, localOps } = mergeAcrossSources(input, fresh());
    expect(records).toEqual([p]);
    expect([...(localOps.get(p)?.keys() ?? [])].sort()).toEqual(["41110", "41130", "41150"]);
  });
  it("정하지 않은 사업·'전국'이 아닌 행은 그대로", () => {
    const other = menu("건강백세운동교실", "41110");
    const regional = menu("국가건강검진", "41110", { icareType: "지역특화" });
    const { records, promoted } = applyMenuDecisions([other, regional], DEC);
    expect(promoted).toHaveLength(0);
    expect(records).toEqual([other, regional]);
    expect(records.every((r) => !r.menuTarget)).toBe(true);
  });
});
