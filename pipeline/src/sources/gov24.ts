import { fixSwapped } from "../normalize/swap";
import type { SourceRecord } from "./record";
import { financialBadge, isEupmyeondongLevel } from "./record";
import { cleanName, cleanOrg, cleanText, nameKey } from "../normalize/names";
import { gov24Category } from "../normalize/categories";
import type { RegionIndex } from "../normalize/regions";
import { rulesFromSupportConditions, supplementFromText, type Gov24Conditions } from "../rules/fromGov24";
import type { OrgType } from "../../../src/lib/data/types";
import { classifySector } from "../normalize/sector";

/**
 * 공공서비스(혜택) API 캐시(serviceList + supportConditions + serviceDetail) → SourceRecord.
 * 노출 대상: 사용자구분에 '개인' 또는 '가구'가 포함된 서비스 (설계서 4.2, 기획안 18장 결정 10).
 */
export function mapGov24OrgType(orgTypeRaw: string | undefined, orgName: string | undefined, regions: RegionIndex): {
  orgType: OrgType; sidoCode?: string; sigunguCodes?: string[]; regionLabel?: string; regional?: boolean;
} {
  const t = orgTypeRaw ?? "";
  const n = (orgName ?? "").trim();
  if (/교육청|교육지원청/.test(t) || /교육청$/.test(n)) {
    const r = regions.resolveOrgName(n);
    return { orgType: "edu_office", sidoCode: r.sido?.code, regionLabel: r.sido?.name };
  }
  if (t === "공공기관") return { orgType: "public_inst" };
  if (/중앙/.test(t)) return { orgType: "central" };
  if (/지방출자|출연|지방공기업/.test(t)) {
    // 지방 공공기관: 기관명에서 시도/시군구 추정
    const r = regions.resolveOrgName(n);
    if (!r.sido) return { orgType: "public_inst", regional: true } as ReturnType<typeof mapGov24OrgType>;
    if (r.sigungus?.length) return { orgType: "public_inst", sidoCode: r.sido.code, sigunguCodes: r.sigungus.map((g) => g.code), regionLabel: `${r.sido.short} ${r.sigungus[0].name}`, regional: true };
    if (r.sido.code === "36000") return { orgType: "public_inst", sidoCode: "36000", sigunguCodes: ["36110"], regionLabel: "세종", regional: true };
    return { orgType: "public_inst", sidoCode: r.sido.code, regionLabel: r.sido.name, regional: true };
  }
  // 지자체: 기관명에서 시도/시군구 해석 ('경기도', '경기도 수원시', '수원시')
  const parts = n.split(/\s+/);
  const sido = regions.sido(parts[0]);
  if (sido) {
    if (parts.length >= 2) {
      const sggs = regions.resolveSigungu(sido.name, parts.slice(1).join(" "));
      if (sggs.length) return { orgType: "local", sidoCode: sido.code, sigunguCodes: sggs.map((s) => s.code), regionLabel: `${sido.short} ${sggs[0].name}` };
    }
    if (sido.code === "36000") return { orgType: "metro", sidoCode: "36000", sigunguCodes: ["36110"], regionLabel: "세종" };
    return { orgType: "metro", sidoCode: sido.code, regionLabel: sido.name };
  }
  const r = regions.resolveOrgName(n);
  if (r.sigungus?.length && r.sido) return { orgType: "local", sidoCode: r.sido.code, sigunguCodes: r.sigungus.map((g) => g.code), regionLabel: `${r.sido.short} ${r.sigungus[0].name}` };
  return { orgType: /지자체|지방|시군구|광역/.test(t) ? "local" : "other" };
}

/** '교육부/02-6222-6060||0079에듀콜/1544-0079' → 줄바꿈 목록 '교육부 ☎ 02-6222-6060' */
export function formatContacts(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lines = raw.split("||").map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.lastIndexOf("/");
    return i > 0 && /\d/.test(x.slice(i + 1)) ? `${x.slice(0, i).trim()} ☎ ${x.slice(i + 1).trim()}` : x;
  });
  return lines.length ? [...new Set(lines)].join("\n") : undefined;
}

/** 상세 주소 (2026-10-29): 정부24 API가 plus.gov.kr 새 주소를 주기 시작했지만, 서식 연결 검증이 옛 주소와 정확히 같은지로 확인하므로
 * 새 주소의 svcId가 이 서비스ID와 같을 때만 같은 서비스의 옛 주소 형식(지금도 열림)으로 둔다. 그 밖에는 원천 그대로. */
export function gov24DetailUrl(raw: string | undefined, id: string): string | undefined {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (u.hostname === "plus.gov.kr" && u.searchParams.get("svcId") === id) return `https://www.gov.kr/portal/rcvfvrSvc/dtlEx/${encodeURIComponent(id)}`;
  } catch { /* 주소가 아니면 원천 그대로 */ }
  return raw;
}

export function loadGov24(
  list: Record<string, unknown>[], conditions: Record<string, unknown>[], details: Record<string, unknown>[],
  fetchedAt: string, regions: RegionIndex, log: (m: string) => void,
): SourceRecord[] {
  const condById = new Map(conditions.map((c) => [String(c["서비스ID"]), c as Gov24Conditions]));
  const detailById = new Map(details.map((d) => [String(d["서비스ID"]), d]));
  const out: SourceRecord[] = [];
  let unresolved = 0;
  for (const s of list) {
    const id = String(s["서비스ID"]);
    const d = detailById.get(id) ?? {};
    const str = (k: string, o: Record<string, unknown> = s) => cleanText(o[k] as string | undefined);
    const name = cleanName(String(s["서비스명"] ?? d["서비스명"] ?? ""));
    const users = String(s["사용자구분"] ?? "");
    const org = mapGov24OrgType(str("소관기관유형"), str("소관기관명"), regions);
    const isRegional = org.orgType === "local" || org.orgType === "metro" || org.orgType === "edu_office" || !!org.regional;
    if (isRegional && !org.sidoCode) unresolved++;
    const scope: SourceRecord["scope"] = org.sigunguCodes ? "sigungu" : org.sidoCode ? "sido" : "national";
    const cond = condById.get(id);
    const draft = cond ? rulesFromSupportConditions(cond) : null;
    // 지원조건 코드가 하나라도 있을 때만 원문 보완 (코드가 전혀 없으면 '구조화 조건 없음'으로 둔다)
    // (QA 8차) 원천에서 지원대상·지원내용 칸이 뒤바뀐 경우 바로잡은 뒤 원문 보완에 쓴다
    const tb = fixSwapped({ target: str("지원대상", d) ?? str("지원대상"), benefit: str("지원내용", d) ?? str("지원내용") });
    const sup = draft?.logic ? supplementFromText(draft.logic, [tb.target, str("선정기준", d), str("서비스목적요약")].filter(Boolean).join(" ")) : null;
    const rec: SourceRecord = {
      source: "gov24",
      sourceId: id,
      name,
      key: nameKey(name),
      summary: str("서비스목적요약") ?? str("서비스목적", d) ?? "",
      target: tb.target,
      criteria: str("선정기준", d) ?? str("선정기준"),
      benefit: tb.benefit,
      applyMethod: str("신청방법", d) ?? str("신청방법"),
      applyChannel: str("신청방법"),
      supportType: str("지원유형", d) ?? str("지원유형"),
      documents: [str("구비서류", d), str("본인확인필요구비서류", d) && `본인 확인 필요: ${str("본인확인필요구비서류", d)}`, str("공무원확인구비서류", d) && `담당 공무원이 확인: ${str("공무원확인구비서류", d)}`].filter(Boolean).join("\n") || undefined,
      contact: formatContacts(str("문의처", d) ?? str("전화문의")),
      deadline: str("신청기한", d) ?? str("신청기한"),
      orgType: org.orgType,
      scope,
      sidoCode: org.sidoCode,
      sigunguCodes: org.sigunguCodes,
      regionLabel: org.regionLabel,
      owner: cleanOrg(str("소관기관명")),
      provider: str("접수기관명", d) ?? str("접수기관"),
      category: gov24Category(str("서비스분야")),
      tags: [str("서비스분야"), str("지원유형")].filter(Boolean) as string[],
      url: gov24DetailUrl(str("상세조회URL"), id),
      applyUrl: str("온라인신청사이트URL", d),
      laws: [str("법령", d), str("자치법규", d), str("행정규칙", d)].filter(Boolean).flatMap((x) => String(x).split("||")).map((x) => x.trim()).filter(Boolean),
      updatedAt: (str("수정일시", d) ?? str("수정일시"))?.slice(0, 10),
      fetchedAt,
      trust: "A",
      badges: [...(draft?.badges ?? []), ...(financialBadge(name) ? (["financial"] as const) : [])],
      draft: {
        origin: draft?.logic ? "gov24_conditions" : "none",
        logic: sup?.logic ?? draft?.logic ?? null,
        unstructured: [...(draft?.unstructured ?? []), ...(draft?.logic ? ["재산·세부 요건은 원문에서 확인하세요"] : [])],
        core: sup?.core ?? false,
      },
    };
    rec.sector = classifySector({ name, target: rec.target, gov24Field: str("서비스분야"), users });
    if (!/개인|가구/.test(users)) rec.excluded = "not_individual";
    else if (draft?.businessOnly) rec.excluded = "business_only";
    else if (isRegional && !org.sidoCode) rec.excluded = "region_unresolved";
    else if (org.orgType === "local" && isEupmyeondongLevel(name)) rec.excluded = "eupmyeondong_level";
    out.push(rec);
  }
  if (unresolved) log(`[gov24] 지역 해석 실패: ${unresolved}건`);
  return out;
}
