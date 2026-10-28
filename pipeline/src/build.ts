/**
 * 복지나침반 데이터 파이프라인: 수집 캐시 → 정규화 → 중복 제거·교차 병합 → 규칙 → 번들.
 *
 * 입력
 *  - 공공서비스(혜택) API 캐시: pipeline/raw/gov24/ (npm run ingest:gov24 로 채움, 키가 없거나 거부되면 건너뜀)
 *  - 복지로 색인·통합돌봄 메뉴판: ICDASH_DIR (기본 /workspace/icdash)
 * 출력
 *  - public/bundles/v1/national.json, sido/{code}.json, sigungu/{code}.json, regions.json, meta.json
 *  - pipeline/out/report.json · report.md · review-queue-gyeonggi.csv · review-curated.csv
 */
import { OWNER_FIX, refineRule } from "../../src/lib/data/refine";
import applyPlacesJson from "../curated/apply-places.json";
import menuNationalJson from "../curated/menu-national.json";
import menuNameFixesJson from "../curated/menu-name-fixes.json";
/** 수동 보강 신청처 (id → 창구·방법·문의·출처) */
const APPLY_PLACES = new Map(applyPlacesJson.items.map((x: { id: string; place: string; applyMethod: string; contact: string; applyUrl?: string; source: string; override?: boolean }) => [x.id, x]));
import fs from "node:fs";
import path from "node:path";
import { RegionIndex, PILOT_SIDO } from "./normalize/regions";
import { loadWelfare100 } from "./sources/welfare100";
import { loadIcare, type MenuNameFix } from "./sources/icare";
import { applyMenuDecisions, type MenuDecisions } from "./menuNational";
import { loadGov24 } from "./sources/gov24";
import { loadManual } from "./sources/manual";
import { applyBokjiroApi } from "./sources/bokjiroApi";
import type { SourceRecord } from "./sources/record";
import { dedupWithinIcare, mergeAcrossSources, regionDisplayName, type DedupStats } from "./dedup";
import { readCached, readCachedStatus } from "./gov24/ingest";
import { CURATED } from "../rules/curated";
import { classifyOperator, classifySector } from "./normalize/sector";
import { classifyApplyType, type ApplyResult } from "./normalize/applyType";
import { normalizeUrl } from "./normalize/names";
import { extractMoney } from "./normalize/money";
import { extractDue } from "./normalize/due";
import { detailBucket } from "../../src/lib/data/bucket";
import type { Bundle, BuildMeta, LocalOperation, Program, RegionIndex as RegionIndexJson, SourceRef } from "../../src/lib/data/types";
import type { Cond, Rule } from "../../src/lib/engine/types";
import { normalizeDeep, normalizeText } from "../../src/lib/data/text";

const ROOT = path.resolve(__dirname, "../..");
const ICDASH = process.env.ICDASH_DIR ?? "/workspace/icdash";
const OUT = path.join(ROOT, "public/bundles/v1");
const REPORT = path.join(ROOT, "pipeline/out");
const GENERATED_AT = new Date().toISOString();

const logs: string[] = [];
const log = (m: string) => { logs.push(m); };

function readLedger(): Map<string, { status: string; reviewer: string; reviewedAt: string; note: string }> {
  const f = path.join(ROOT, "pipeline/rules/review-ledger.csv");
  const m = new Map();
  if (!fs.existsSync(f)) return m;
  const lines = fs.readFileSync(f, "utf8").split("\n").slice(1).filter((l) => l.trim());
  for (const l of lines) {
    const [rule_id, status, reviewer, reviewed_at, ...note] = l.split(",");
    m.set(rule_id.trim(), { status: status.trim(), reviewer: reviewer?.trim(), reviewedAt: reviewed_at?.trim(), note: note.join(",").trim() });
  }
  return m;
}

export function condToText(c: Cond | null): string {
  if (!c) return "(구조화 조건 없음)";
  if ("all" in c) return c.all.length ? c.all.map((x) => wrap(x, condToText(x))).join(" 그리고 ") : "(조건 없음: 누구나)";
  if ("any" in c) return c.any.map((x) => wrap(x, condToText(x))).join(" 또는 ");
  const flags = [c.soft ? "참고" : "", c.capU ? "가능성" : ""].filter(Boolean).join(",");
  return flags ? `${c.label}[${flags}]` : c.label;
}
const wrap = (c: Cond, s: string) => ("all" in c || "any" in c) && (("all" in c ? c.all : c.any).length > 1) ? `(${s})` : s;

const csvCell = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;

function main() {
  const regions = RegionIndex.load();
  const gov24Status = readCachedStatus();

  // 1. 수집 캐시 읽기
  const w100Index = loadWelfare100(path.join(ICDASH, "data"), regions, log);
  // 복지로 OpenAPI(중앙·지자체) 캐시로 색인 보강 + 신규 서비스 추가
  const { records: w100, stats: bokjiroApi } = applyBokjiroApi(w100Index, regions, log);
  log(`[bokjiro-api] 목록 중앙 ${bokjiroApi.list.central} · 지자체 ${bokjiroApi.list.local} / 상세 중앙 ${bokjiroApi.detail.central} · 지자체 ${bokjiroApi.detail.local} / 보강 ${bokjiroApi.enriched} · 신규 ${bokjiroApi.added} · 색인에만 있음 ${bokjiroApi.indexOnly}`);
  // 통합돌봄 메뉴판: 보건복지부 원문에서 직접 읽은 것(npm run ingest:mohw → parse:mohw)을 먼저, 없으면 선행 대시보드 수집본 (2026-10-17)
  const mohwCsv = path.join(ROOT, "pipeline/raw/mohw/policies.csv");
  const useMohw = fs.existsSync(mohwCsv);
  const icareFetched = (() => {
    try {
      if (useMohw) return new Date(JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline/raw/mohw/index.json"), "utf8")).checkedAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
      const j = JSON.parse(fs.readFileSync(path.join(ICDASH, "data/api_summary.json"), "utf8"));
      return new Date(j.fetchedAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    } catch { return "2026-10-01"; }
  })();
  log(`[icare] 메뉴판 출처: ${useMohw ? "보건복지부 원문 (pipeline/raw/mohw)" : "선행 대시보드 수집본 (ICDASH_DIR)"}`);
  // 메뉴판 '전국' 행: 소유자 검토표 결정(같은 사업으로 묶기 · 전국으로 올리기) 반영 (2026-10-22 P1-1)
  const { records: icare, promoted } = applyMenuDecisions(loadIcare(useMohw ? mohwCsv : path.join(ICDASH, "policies.csv"), icareFetched, regions, log, menuNameFixesJson.fixes as MenuNameFix[]), menuNationalJson as MenuDecisions);
  log(`[icare] 검토표 결정: 전국으로 올림 ${promoted.length}개 (${promoted.map((p) => p.name).join(", ")}) · 같은 사업으로 묶을 행 ${icare.filter((r) => r.menuTarget && !r.menuTarget.startsWith("icare:")).length}`);
  const g24list = readCached("serviceList");
  const gov24 = g24list.rows.length
    ? loadGov24(g24list.rows, readCached("supportConditions").rows, readCached("serviceDetail").rows,
      (g24list.fetchedAt ?? GENERATED_AT).slice(0, 10), regions, log)
    : [];

  const manual = loadManual(path.join(ROOT, "pipeline/curated"), regions, log);

  const raw = { gov24: gov24.length, bokjiro: w100.filter((r) => r.source === "bokjiro").length, welfare100: w100.filter((r) => r.source === "welfare100").length, icare: icare.length, manual: manual.length };

  // 2. 노출 제외 (읍면동 단독·개인 대상 아님 등)
  const all = [...gov24, ...w100, ...icare, ...manual];
  const excluded: Record<string, number> = {};
  const excludedSamples: string[] = [];
  const kept = all.filter((r) => {
    if (!r.excluded) return true;
    excluded[r.excluded] = (excluded[r.excluded] ?? 0) + 1;
    if (r.excluded === "eupmyeondong_level" && excludedSamples.length < 15) excludedSamples.push(`${r.regionLabel} · ${r.name}`);
    return false;
  });

  // 3. 중복 제거 · 교차 병합
  const stats: DedupStats = { d1Exact: 0, d2Substantive: 0, crossMerged: [], absorbedAsLocalOps: 0, blockedByLevel: 0 };
  const deduped = dedupWithinIcare(kept, stats);
  const tokensFor = (r: SourceRecord): string[] => {
    const t = new Set<string>();
    const sd = r.sidoCode ? regions.sidoByCode(r.sidoCode) : undefined;
    if (sd) { t.add(sd.name); t.add(sd.short); }
    for (const c of r.sigunguCodes ?? []) {
      const g = regions.sigunguByCode(c);
      if (g) { t.add(g.name); if (g.name.length >= 3) t.add(g.name.replace(/(시|군|구)$/, "")); }
    }
    return [...t].filter(Boolean);
  };
  const { records, localOps } = mergeAcrossSources(deduped, stats, tokensFor);

  // 4. 규칙 + 프로그램 생성
  const ledger = readLedger();
  const programs: { p: Program; rec: SourceRecord; sigungu?: string }[] = [];
  const reviewCounts: Record<string, number> = {};
  const originCounts: Record<string, number> = {};

  for (const rec of records) {
    const members = [rec, ...(rec.merged ?? [])];
    const curatedKey = members.map((m) => m.sourceId).find((id) => CURATED[id]);
    const curatedMember = curatedKey ? members.find((m) => m.sourceId === curatedKey)! : undefined;
    const gov24Member = members.find((m) => m.source === "gov24" && m.draft.logic);
    const draftMember = gov24Member ?? members.find((m) => m.draft.logic) ?? rec;

    const sources: SourceRef[] = members.map((m) => ({ source: m.source, id: m.sourceId, url: m.url, updatedAt: m.updatedAt, fetchedAt: m.fetchedAt }));
    const uniqSources = sources.filter((s, i) => sources.findIndex((x) => x.source === s.source && x.id === s.id) === i);

    const sector = members.find((m) => m.source === "gov24")?.sector ?? (members.some((m) => m.source === "gov24") ? undefined : classifySector({ name: rec.name, target: rec.target }));
    const uniqJoin = (k: "applyMethod" | "applyChannel" | "supportType", sep: string) =>
      [...new Set(members.map((m) => m[k]).filter(Boolean) as string[])].join(sep) || undefined;
    const apply: ApplyResult = classifyApplyType({
      name: rec.name, summary: rec.summary, scope: rec.scope, owner: rec.owner,
      target: rec.target ?? members.find((m) => m.target)?.target,
      criteria: rec.criteria ?? members.find((m) => m.criteria)?.criteria,
      benefit: rec.benefit ?? members.find((m) => m.benefit)?.benefit,
      applyMethod: uniqJoin("applyMethod", "\n"), applyChannel: uniqJoin("applyChannel", "||"),
      supportType: [uniqJoin("supportType", ","), ...(rec.provision ?? [])].filter(Boolean).join(",") || undefined,
    });
    // 기관·시설 운영 지원(사람이 아니라 경로당·법인·운영기관에 가는 지원)은 농림·사업자처럼 기본 숨김
    const operatorWhy = sector ? undefined : classifyOperator({ name: rec.name, summary: rec.summary, target: rec.target, applyType: apply.type });
    const sectorFinal = sector ?? (operatorWhy ? "operator" : undefined);
    const placements: (string | undefined)[] = rec.scope === "sigungu" ? rec.sigunguCodes! : [undefined];
    for (const sgg of placements) {
      const prefix = rec.scope === "national" ? "n" : rec.scope === "sido" ? `s${rec.sidoCode}` : `g${sgg}`;
      const id = `${prefix}.${rec.source}-${rec.sourceId.replace(/[^0-9A-Za-z-]/g, "-")}`;
      const ruleId = `R-${id}`;
      let rule: Rule;
      if (curatedKey) {
        const c = CURATED[curatedKey];
        rule = {
          id: ruleId, origin: "curated", review: "curated", logic: c.logic,
          unstructured: c.unstructured ?? [], unstructuredCore: !!c.core,
          evidence: [curatedMember!.target, curatedMember!.summary].filter(Boolean).join(" / ") + (c.source ? ` · 근거: ${c.source}` : ""),
          reviewer: "1차: 원문 대조 작성(AI) · 최종 사람 검수 대기", reviewedAt: GENERATED_AT.slice(0, 10),
        };
      } else if (draftMember.source === "manual") {
        // 수동 보강: 기관 공식 누리집 원문과 대조해 작성한 규칙
        rule = {
          id: ruleId, origin: "curated", review: "curated", logic: draftMember.draft.logic,
          unstructured: draftMember.draft.unstructured, unstructuredCore: false,
          evidence: `${draftMember.target ?? ""} · 근거: ${draftMember.url} (${draftMember.fetchedAt} 확인)`,
          reviewer: "수동 보강: 공식 누리집 원문 대조(AI) · 최종 사람 검수 대기", reviewedAt: draftMember.fetchedAt,
        };
      } else {
        // 공공서비스 API 구조화 지원조건: 모든 지역에서 '조건 충족' 판정 허용 (전국 확대 ①, 2026-10-10 — 시범 기간에는 전국·경기도만)
        const structured = draftMember.draft.origin === "gov24_conditions";
        rule = {
          id: ruleId, origin: draftMember.draft.origin, review: structured ? "structured" : "auto", logic: draftMember.draft.logic,
          unstructured: draftMember.draft.unstructured, unstructuredCore: draftMember.draft.core,
          evidence: draftMember.target ? (draftMember.target.length > 400 ? draftMember.target.slice(0, 399) + "…" : draftMember.target) : undefined,
        };
      }
      const l = ledger.get(ruleId) ?? (curatedKey ? ledger.get(`curated:${curatedKey}`) : undefined);
      if (l) {
        if (l.status === "verified") { rule.review = "verified"; rule.reviewer = l.reviewer; rule.reviewedAt = l.reviewedAt; }
        if (l.status === "rejected") { rule.logic = null; rule.review = "auto"; rule.origin = "none"; }
      }
      reviewCounts[rule.review] = (reviewCounts[rule.review] ?? 0) + 1;
      originCounts[rule.origin] = (originCounts[rule.origin] ?? 0) + 1;

      const pick = <K extends "target" | "criteria" | "benefit" | "applyMethod" | "documents" | "contact" | "deadline" | "url" | "applyUrl" | "provider" | "owner">(k: K) =>
        rec[k] ?? members.find((m) => m[k])?.[k];
      const sggInfo = sgg ? regions.sigunguByCode(sgg) : undefined;
      const sidoInfo = rec.sidoCode ? regions.sidoByCode(rec.sidoCode) : undefined;
      const p: Program = {
        id,
        name: rec.scope === "national" ? rec.name : regionDisplayName(rec.name, tokensFor(rec)),
        summary: rec.summary,
        category: rec.category,
        tags: rec.tags.length ? rec.tags.slice(0, 6) : undefined,
        orgType: rec.orgType,
        scope: rec.scope,
        region: rec.scope === "national" ? undefined : {
          sido: rec.sidoCode!, sigungu: sgg, label: sggInfo ? `${sidoInfo?.short ?? ""} ${sggInfo.name}`.trim() : sidoInfo?.name ?? rec.regionLabel ?? "",
        },
        owner: OWNER_FIX[id] ?? pick("owner"),
        provider: pick("provider"),
        target: pick("target"),
        criteria: pick("criteria"),
        benefit: pick("benefit"),
        applyMethod: pick("applyMethod"),
        documents: pick("documents"),
        contact: pick("contact"),
        deadline: pick("deadline"),
        url: normalizeUrl(pick("url")),
        applyUrl: normalizeUrl(pick("applyUrl")),
        provision: rec.provision?.length ? rec.provision : undefined,
        laws: rec.laws?.length ? rec.laws.slice(0, 4) : undefined,
        sources: uniqSources,
        trust: members.some((m) => m.trust === "A") ? "A" : rec.trust,
        badges: rec.badges.length ? rec.badges : undefined,
        // 규칙 다듬기 (공공부조 관문 법정 기준·장기요양등급 — src/lib/data/refine.ts)
        rule: refineRule({ name: rec.name, target: pick("target"), criteria: pick("criteria") }, rule),
        mergedCount: members.length > 1 ? members.length : undefined,
        sector: sectorFinal,
        applyType: apply.type,
        applyReason: apply.reason,
        ...(operatorWhy ? { operatorReason: operatorWhy } : {}),
        aliases: [...new Set([...(rec.aliases ?? []), ...(rec.scope !== "national" && regionDisplayName(rec.name, tokensFor(rec)) !== rec.name ? [rec.name] : [])])].slice(0, 8) || undefined,
      };
      // 수동 보강 신청처 (원문 신청방법이 비어 있어 주민센터로 잘못 안내되던 핵심 사업 — QA 2차 N4)
      const ap = APPLY_PLACES.get(id);
      // override: 원문 신청방법이 '방문, 온라인'처럼 비어 있다시피 하고 문의처가 부처 담당과뿐인 경우 (QA 3차 N4: 첫만남이용권)
      if (ap && (!p.applyMethod || ap.override)) {
        p.applyMethod = ap.applyMethod;
        p.contact = ap.override ? ap.contact : (p.contact ?? ap.contact);
        p.applyUrl = ap.override ? (ap.applyUrl ?? p.applyUrl) : (p.applyUrl ?? ap.applyUrl);
        p.applyPlace = ap.place;
        p.applyNote = { source: ap.source, checkedAt: applyPlacesJson.checkedAt };
      }
      // 지원 금액·신청 기한 (원문 지원내용·신청기한에서 규칙으로 추출 — pipeline/src/normalize/money.ts·due.ts)
      const money = extractMoney({ name: rec.name, benefit: p.benefit ? normalizeText(p.benefit) : undefined, sector: sectorFinal });
      const due = extractDue({ deadline: p.deadline ? normalizeText(p.deadline) : undefined, benefit: p.benefit ? normalizeText(p.benefit) : undefined, applyMethod: p.applyMethod ? normalizeText(p.applyMethod) : undefined });
      if (money) p.money = money;
      if (due) p.due = due;
      programs.push({ p, rec, sigungu: sgg });
    }
  }

  // 5. 번들 쓰기
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "sido"), { recursive: true });
  fs.mkdirSync(path.join(OUT, "sigungu"), { recursive: true });
  const order = (a: Program, b: Program) =>
    Number(b.rule.review !== "auto") - Number(a.rule.review !== "auto") || a.name.localeCompare(b.name, "ko");

  const nationalIdByRec = new Map<SourceRecord, string>();
  for (const { p, rec } of programs) if (p.scope === "national") nationalIdByRec.set(rec, p.id);

  // 번들에 쓰기 전 모든 문자열 정리 (HTML 엔티티·깨진 기호 글자 — src/lib/data/text.ts)
  const write = (rel: string, data: unknown) => fs.writeFileSync(path.join(OUT, rel), JSON.stringify(normalizeDeep(data)));
  /** 결과 목록·판정에 필요한 필드만 남긴 가벼운 사업 (상세 필드는 details 샤드) */
  const cut = (t: string | undefined, n: number) => (t && t.length > n ? t.slice(0, n - 1) + "…" : t);
  const slim = (p: Program): Program => ({
    id: p.id, name: p.name, summary: cut(p.summary, 160) ?? "", category: p.category, tags: p.tags, orgType: p.orgType, scope: p.scope, region: p.region,
    owner: p.owner, provider: p.provider, target: cut(p.target, 400), deadline: cut(p.deadline, 60),
    sources: p.sources.map((x) => ({ source: x.source, id: x.id }) as SourceRef), trust: p.trust, badges: p.badges,
    rule: { id: p.rule.id, origin: p.rule.origin, review: p.rule.review, logic: p.rule.logic, unstructured: p.rule.unstructured, unstructuredCore: p.rule.unstructuredCore, ...(p.rule.meansTest ? { meansTest: true } : {}), ...(p.rule.recBand ? { recBand: true } : {}), ...(p.rule.refined ? { refined: p.rule.refined } : {}) },
    mergedCount: p.mergedCount, aliases: p.aliases, sector: p.sector, applyType: p.applyType === "unknown" ? undefined : p.applyType, hasApply: !!(p.applyMethod || p.contact) || undefined,
    ...(p.applyPlace ? { applyPlace: p.applyPlace } : {}),
    ...(p.money ? { money: p.money } : {}),
    ...(p.due ? { due: p.due } : {}),
  });
  const detailShards = new Map<string, Record<string, Program>>();
  for (const { p } of programs) {
    const b = detailBucket(p.id);
    const m = detailShards.get(b) ?? {};
    m[p.id] = p;
    detailShards.set(b, m);
  }
  fs.mkdirSync(path.join(OUT, "details"), { recursive: true });
  for (const [b, m] of detailShards) write(`details/${b}.json`, m);
  const national: Bundle = { schema: 1, kind: "national", code: "00000", label: "전국", generatedAt: GENERATED_AT, programs: programs.filter((x) => x.p.scope === "national").map((x) => x.p).sort(order).map(slim) };
  write("national.json", national);

  const sizes: Record<string, number> = { national: national.programs.length };
  const regionJson: RegionIndexJson = { schema: 1, generatedAt: GENERATED_AT, sidos: [] };
  for (const sido of regions.sidos) {
    const sidoPrograms = programs.filter((x) => x.p.scope === "sido" && x.p.region?.sido === sido.code).map((x) => x.p).sort(order);
    write(`sido/${sido.code}.json`, { schema: 1, kind: "sido", code: sido.code, label: sido.name, generatedAt: GENERATED_AT, programs: sidoPrograms.map(slim) } satisfies Bundle);
    const sggs = regions.sigungusOf(sido.code).map((s) => {
      const list = programs.filter((x) => x.sigungu === s.code).map((x) => x.p).sort(order);
      const ops: Record<string, LocalOperation[]> = {};
      for (const [rec, m] of localOps) {
        const nid = nationalIdByRec.get(rec);
        const v = m.get(s.code);
        if (nid && v) ops[nid] = v;
      }
      write(`sigungu/${s.code}.json`, { schema: 1, kind: "sigungu", code: s.code, label: `${sido.name} ${s.name}`, generatedAt: GENERATED_AT, programs: list.map(slim), localOps: ops } satisfies Bundle);
      return { code: s.code, name: s.name, count: list.length };
    });
    regionJson.sidos.push({ code: sido.code, name: sido.name, short: sido.short, pilot: sido.code === PILOT_SIDO, sigungus: sggs, count: sidoPrograms.length });
    sizes[`sido:${sido.code}`] = sidoPrograms.length;
  }
  write("regions.json", regionJson);

  // 6. 통계
  const uniquePrograms = programs.filter((x, i) => programs.findIndex((y) => y.rec === x.rec) === i);
  const byOrg: Record<string, number> = {};
  const byScope: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const bySourceOrg: Record<string, Record<string, number>> = {};
  const bySector: Record<string, number> = {};
  const byApplyType: Record<string, number> = {};
  for (const { p, rec } of uniquePrograms) {
    byApplyType[p.applyType ?? "unknown"] = (byApplyType[p.applyType ?? "unknown"] ?? 0) + 1;
    byOrg[p.orgType] = (byOrg[p.orgType] ?? 0) + 1;
    byScope[p.scope] = (byScope[p.scope] ?? 0) + 1;
    if (p.sector) bySector[p.sector] = (bySector[p.sector] ?? 0) + 1;
    for (const s of new Set(p.sources.map((x) => x.source))) bySource[s] = (bySource[s] ?? 0) + 1;
    const ps = rec.source;
    bySourceOrg[ps] = bySourceOrg[ps] ?? {};
    bySourceOrg[ps][p.orgType] = (bySourceOrg[ps][p.orgType] ?? 0) + 1;
  }
  const localOpsCount = [...localOps.values()].reduce((n, m) => n + [...m.values()].reduce((k, v) => k + v.length, 0), 0);
  const gyeonggi = uniquePrograms.filter((x) => x.p.region?.sido === PILOT_SIDO);
  const pilot = {
    programs: gyeonggi.length,
    curatedOrVerified: gyeonggi.filter((x) => x.p.rule.review === "curated" || x.p.rule.review === "verified").length,
    structured: gyeonggi.filter((x) => x.p.rule.review === "structured").length,
    autoRules: gyeonggi.filter((x) => x.p.rule.review === "auto" && x.p.rule.logic).length,
    noRule: gyeonggi.filter((x) => !x.p.rule.logic).length,
  };
  const nationalCurated = national.programs.filter((p) => p.rule.review === "curated" || p.rule.review === "verified").length;
  const nationalStructured = national.programs.filter((p) => p.rule.review === "structured").length;
  const filled = (k: "applyMethod" | "contact") => uniquePrograms.filter((x) => x.p[k] && String(x.p[k]).trim()).length;
  const coverage = { applyMethod: filled("applyMethod"), contact: filled("contact"), either: uniquePrograms.filter((x) => x.p.applyMethod || x.p.contact).length, total: uniquePrograms.length };
  const tally = <T,>(f: (p: Program) => T | undefined) => uniquePrograms.reduce((m: Record<string, number>, x) => { const v = f(x.p); if (v !== undefined) m[String(v)] = (m[String(v)] ?? 0) + 1; return m; }, {});
  const moneyDue = {
    benefitText: filled("benefit" as "applyMethod"),
    deadlineText: uniquePrograms.filter((x) => x.p.deadline && !/^(상시|수시|연중)/.test(x.p.deadline.trim())).length,
    money: tally((p) => p.money?.per),
    due: tally((p) => p.due?.kind),
  };

  const meta: BuildMeta = {
    schema: 1,
    generatedAt: GENERATED_AT,
    dataAsOf: {
      bokjiro: bokjiroApi.list.central + bokjiroApi.list.local
        ? `복지로 OpenAPI 수집 ${GENERATED_AT.slice(0, 10)} (서비스별 최종수정일 표시) · 색인 2026-09-24`
        : "2026-09-24 (복지로 색인 기준일)",
      icare: "2026-04 등 (메뉴판 문서별 원문 기준월), 수집 " + icareFetched,
      gov24: gov24.length ? `수집 ${g24list.fetchedAt?.slice(0, 10)}` : "미수집",
    },
    counts: { raw, excluded, uniquePrograms: uniquePrograms.length, placements: programs.length, byOrg, byScope, bySector, byApplyType, bySource, bySourceOrg, dedup: { ...stats, regionalCopySamples: undefined }, localOps: localOpsCount, rulesByReview: reviewCounts, rulesByOrigin: originCounts, pilot, nationalCurated, nationalStructured, coverage, moneyDue, bokjiroApi },
    gov24: gov24Status
      ? { status: gov24Status.status, detail: gov24Status.detail, services: gov24.length || undefined }
      : { status: "unavailable", detail: "수집 기록 없음 (npm run ingest:gov24 미실행)" },
    // 출처 안내(/about)가 통합돌봄 자료의 출처 문구를 고르는 근거 (2026-10-26)
    icareOrigin: useMohw ? "mohw" : "dashboard",
  };
  write("meta.json", meta);

  // 7. 리포트·검수 대기열
  fs.mkdirSync(REPORT, { recursive: true });
  fs.writeFileSync(path.join(REPORT, "report.json"), JSON.stringify({ ...meta, logs: logs.slice(0, 200), excludedSamples }, null, 2));
  const queue = ["rule_id,program,region,origin,conditions,evidence,url,decision(verified|rejected),note"];
  for (const { p } of programs.filter((x) => x.p.region?.sido === PILOT_SIDO && x.p.rule.review === "auto" && x.p.rule.logic)) {
    queue.push([p.rule.id, p.name, p.region?.label, p.rule.origin, condToText(p.rule.logic), p.rule.evidence ?? p.summary, p.url, "", ""].map(csvCell).join(","));
  }
  fs.writeFileSync(path.join(REPORT, "review-queue-gyeonggi.csv"), "\uFEFF" + queue.join("\n"));
  const cur = ["curated_key,rule_id(대표),program,conditions,unstructured,evidence,decision(verified|rejected),reviewer,reviewed_at"];
  const seen = new Set<string>();
  for (const { p, rec } of programs) {
    const key = [rec, ...(rec.merged ?? [])].map((m) => m.sourceId).find((id) => CURATED[id]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cur.push([key, p.rule.id, p.name, condToText(p.rule.logic), p.rule.unstructured.join(" / "), p.rule.evidence, "", "", ""].map(csvCell).join(","));
  }
  fs.writeFileSync(path.join(REPORT, "review-curated.csv"), "\uFEFF" + cur.join("\n"));
  const rc = ["decision,reason,similarity,national,local,region"];
  for (const x of stats.regionalCopySamples ?? []) rc.push([x.decision, x.reason, x.sim, x.nat, x.local, x.region].map(csvCell).join(","));
  fs.writeFileSync(path.join(REPORT, "regional-copies.csv"), "\uFEFF" + rc.join("\n"));
  // 신청 유형 분류표 (사업 단위, 시군구 배치 중복 제외)
  const at = ["id,name,org,region,orgType,applyType,reason"];
  for (const { p } of uniquePrograms) at.push([p.id, p.name, p.owner ?? p.provider ?? "", p.region?.label ?? "전국", p.orgType, p.applyType, p.applyReason].map(csvCell).join(","));
  fs.writeFileSync(path.join(REPORT, "apply-type.csv"), "\uFEFF" + at.join("\n"));
  // 기관·시설 운영 지원(기본 숨김) 목록
  const op = ["id,name,org,region,applyType,reason"];
  for (const { p } of uniquePrograms) if (p.sector === "operator") op.push([p.id, p.name, p.owner ?? p.provider ?? "", p.region?.label ?? "전국", p.applyType, (p as { operatorReason?: string }).operatorReason ?? ""].map(csvCell).join(","));
  fs.writeFileSync(path.join(REPORT, "operator-hidden.csv"), "\uFEFF" + op.join("\n"));
  const statsForMeta = { ...stats, regionalCopySamples: undefined };
  void statsForMeta;
  const missingCurated = Object.keys(CURATED).filter((k) => !seen.has(k));

  const md = [
    `# 파이프라인 리포트 (${GENERATED_AT})`,
    "",
    `- 공공서비스(혜택) API: **${meta.gov24.status}** — ${meta.gov24.detail}`,
    `- 복지로 OpenAPI: 목록 중앙 ${bokjiroApi.list.central} · 지자체 ${bokjiroApi.list.local} / 상세 중앙 ${bokjiroApi.detail.central} · 지자체 ${bokjiroApi.detail.local} / 색인 보강 ${bokjiroApi.enriched} · 신규 ${bokjiroApi.added} · 색인에만 있음 ${bokjiroApi.indexOnly}`,
    `- 신청방법 채움 ${coverage.applyMethod}/${coverage.total} · 연락처 ${coverage.contact}/${coverage.total} · 둘 중 하나 ${coverage.either}/${coverage.total}`,
    `- 지원 금액 추출(사업 단위): ${Object.entries(moneyDue.money).map(([k, v]) => `${k} ${v}`).join(" / ")} (합계 ${Object.values(moneyDue.money).reduce((a, b) => a + b, 0)}, 지원내용 있음 ${moneyDue.benefitText}) · 신청 기한 추출: ${Object.entries(moneyDue.due).map(([k, v]) => `${k} ${v}`).join(" / ")} (합계 ${Object.values(moneyDue.due).reduce((a, b) => a + b, 0)}, '상시' 아닌 신청기한 칸 ${moneyDue.deadlineText})`,
    `- 원천 레코드: ${Object.entries(raw).map(([k, v]) => `${k} ${v}`).join(" / ")}`,
    `- 노출 제외: ${Object.entries(excluded).map(([k, v]) => `${k} ${v}`).join(" / ") || "없음"}`,
    `- 통합돌봄 D1 완전 중복 ${stats.d1Exact} · D2 실질 중복 ${stats.d2Substantive}`,
    `- 교차 원천 병합: ${stats.crossMerged.map((x) => `${x.pair} ${x.count}`).join(" / ") || "없음"} · 기관 수준이 달라 병합 차단 ${stats.blockedByLevel}`,
    `- 통합돌봄 '전국' 행 → 전국 사업의 지역 운영 정보로 흡수: ${stats.absorbedAsLocalOps}행 (운영 정보 ${localOpsCount}건)`,
    `- 검토표 결정: 전국으로 올림 ${promoted.length}개 · 묶을 전국 사업이 이번 데이터에 없어 지역 사업으로 둔 행 ${stats.menuTargetMissing?.length ?? 0}${stats.menuTargetMissing?.length ? ` (${[...new Set(stats.menuTargetMissing.map((x) => x.split(" → ")[1]))].join(", ")})` : ""}`,
    `- 정부24·복지로 시군구 등록분: 전국 사업의 지역 집행분으로 흡수 ${stats.absorbedRegionalCopies ?? 0} · 지역 추가사업으로 별도 유지 ${stats.keptRegionalAddons ?? 0} (pipeline/out/regional-copies.csv)`,
    `- 최종 사업(중복 제거 후): **${uniquePrograms.length}** (시군구 배치 기준 ${programs.length})`,
    `- 기관 유형별: ${Object.entries(byOrg).map(([k, v]) => `${k} ${v}`).join(" / ")}`,
    `- 복지 외 분야(기본 숨김): ${Object.entries(bySector).map(([k, v]) => `${k} ${v}`).join(" / ")} · 교육청(기본 숨김) ${byOrg.edu_office ?? 0}`,
    `- 신청 유형(사업 단위): ${Object.entries(byApplyType).map(([k, v]) => `${k} ${v}`).join(" / ")} (pipeline/out/apply-type.csv)`,
    `- 범위별: ${Object.entries(byScope).map(([k, v]) => `${k} ${v}`).join(" / ")}`,
    `- 원천 기여(사업 수): ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(" / ")}`,
    `- 규칙 검수 상태(배치 기준): ${Object.entries(reviewCounts).map(([k, v]) => `${k} ${v}`).join(" / ")}`,
    `- 규칙 출처(배치 기준): ${Object.entries(originCounts).map(([k, v]) => `${k} ${v}`).join(" / ")}`,
    `- 경기도 파일럿: 사업 ${pilot.programs} · 큐레이션/검수 규칙 ${pilot.curatedOrVerified} · API 지원조건 ${pilot.structured} · 자동 규칙(검수 대기열) ${pilot.autoRules} · 규칙 없음 ${pilot.noRule}`,
    `- 전국 공통 사업 중 큐레이션 규칙: ${nationalCurated} · API 지원조건 규칙: ${nationalStructured}`,
    missingCurated.length ? `- ⚠ 원천에서 찾지 못한 큐레이션 키: ${missingCurated.join(", ")}` : "",
    "",
    "## 읍면동 단독 사업으로 제외한 예",
    ...excludedSamples.map((s) => `- ${s}`),
    "",
    "## 로그",
    ...logs.slice(0, 50).map((l) => `- ${l}`),
  ].join("\n");
  fs.writeFileSync(path.join(REPORT, "report.md"), md);
  console.log(md.split("\n## ")[0]);
}

main();
