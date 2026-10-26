/**
 * 메뉴판 '전국' 사업 처리 (2026-10-22 외부 점검 P1-1): 중앙부처 사업이 메뉴판을 낸 지역에만 붙던 문제.
 * 소유자가 검토표에서 정한 결정(pipeline/curated/menu-national.json)을 통합돌봄 메뉴판 '전국' 행에 붙인다.
 *  - same: 정한 전국 사업(원천:ID)의 '우리 지역 운영 정보'로 묶는다 (이름이 달라도) → dedup.mergeAcrossSources
 *  - promote: 메뉴판 원문으로 전국 사업 하나를 만들고, 각 지역 행은 그 사업의 운영 정보로
 *  - 정하지 않았거나 지역 사업·보류: 지금처럼 그 지역 사업
 * 만든 전국 사업의 설명·대상은 지역 행 중 가장 많이 쓴 원문 그대로 (지어내지 않음).
 */
import type { SourceRecord } from "./sources/record";
import { nameKey } from "./normalize/names";

export interface MenuDecisions {
  same: { key: string; names: string[]; target: string }[];
  promote: { slug: string; name: string; keys: string[]; names: string[] }[];
}

/** 검토표의 이름 묶음 열쇠: 괄호 설명을 떼고 띄어쓰기·가운뎃점·쉼표 등을 뺀다 */
/** 보건복지부 지방정부 통합돌봄 서비스 메뉴판 목록 (시·도 게시판 17곳의 첫 화면) */
export const MENU_INDEX_URL = "https://www.mohw.go.kr/menu.es?mid=a60600000000";

export const menuKey = (name: string) => name.replace(/\([^)]*\)/g, "").replace(/[^가-힣A-Za-z0-9.:]/g, "");

/** 가장 많이 쓴 (설명, 대상) 원문의 행 — 같으면 행 ID가 앞선 것 */
function representative(rows: SourceRecord[]): SourceRecord {
  const count = new Map<string, number>();
  const k = (r: SourceRecord) => `${r.summary}\u0000${r.target ?? ""}`;
  for (const r of rows) count.set(k(r), (count.get(k(r)) ?? 0) + 1);
  return [...rows].sort((a, b) => (count.get(k(b)) ?? 0) - (count.get(k(a)) ?? 0) || a.sourceId.localeCompare(b.sourceId))[0];
}

export function applyMenuDecisions(records: SourceRecord[], dec: MenuDecisions): { records: SourceRecord[]; promoted: SourceRecord[] } {
  const same = new Map(dec.same.map((d) => [d.key, d.target]));
  const promote = new Map(dec.promote.flatMap((p) => p.keys.map((k) => [k, p] as const)));
  const groups = new Map<string, SourceRecord[]>();
  for (const r of records) {
    if (r.source !== "icare" || r.icareType !== "전국") continue;
    const key = menuKey(r.name);
    const target = same.get(key);
    if (target) { r.menuTarget = target; continue; }
    const p = promote.get(key);
    if (p) {
      r.menuTarget = `icare:${p.slug}`;
      groups.set(p.slug, [...(groups.get(p.slug) ?? []), r]);
    }
  }
  const promoted = dec.promote.filter((p) => groups.has(p.slug)).map((p): SourceRecord => {
    const rows = groups.get(p.slug)!;
    const rep = representative(rows);
    const updated = rows.map((r) => r.updatedAt).filter((x): x is string => !!x).sort().at(-1);
    return {
      // 원문 주소는 보건복지부 통합돌봄 메뉴판 목록 — 지역 행마다 다른 글이라 한 곳을 고르지 않는다
      source: "icare", sourceId: p.slug, name: p.name, key: nameKey(p.name), url: MENU_INDEX_URL,
      summary: rep.summary, target: rep.target,
      orgType: "central", scope: "national", owner: "중앙부처 (전국 공통 사업)",
      category: rep.category, tags: rep.tags, updatedAt: updated, fetchedAt: rep.fetchedAt,
      trust: rep.trust, badges: [], draft: rep.draft, icareType: "전국",
      aliases: [...new Set(rows.map((r) => r.name))].filter((n) => n !== p.name).sort(),
    };
  });
  return { records: [...promoted, ...records], promoted };
}
