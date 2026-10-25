/**
 * 매일 변경 감지 (2026-10-22): 원천 목록을 어제와 비교해 추가·변경·삭제를 세고, 배포 전에 멈출 이상을 찾는다.
 * 수집은 GitHub Actions(.github/workflows/data-refresh.yml)가 매일 자동으로, 결과는 data 브랜치의 _report.json·_history.json.
 */
import crypto from "node:crypto";
import { extractMoney } from "../normalize/money";
import type { Money } from "../../../src/lib/data/types";

export type SourceId = "gov24" | "bokjiro-central" | "bokjiro-local" | "mohw";

export interface SourceReport {
  source: SourceId | string;
  /** held = 우리 하루 호출 예산이 다 떨어져 오늘은 못 받음 (이틀 연속이면 경고) */
  status: "ok" | "error" | "unavailable" | "skipped" | "held";
  detail?: string;
  /** 오늘 목록 건수 */
  total: number;
  /** 어제(직전 수집) 목록 건수 — 처음이면 0 */
  previous: number;
  added: string[];
  removed: string[];
  changed: string[];
  /** 원천이 알려 준 전체 건수 (받은 건수와 다르면 경고) */
  expected?: number;
  /** 어제는 있었는데 오늘 통째로 사라진 칸 */
  schemaMissing?: string[];
  /** 메뉴판: 바뀌지 않은 PDF인데 표 결과가 달라진 글 수 */
  drift?: number;
}

/** 지문: 키 순서와 무관한 내용 해시. ignore 필드(조회수 등 매번 바뀌는 잡음)는 뺀다 */
export function fingerprint(row: Record<string, unknown>, ignore: readonly string[] = []): string {
  const keys = Object.keys(row).filter((k) => !ignore.includes(k)).sort();
  const norm = JSON.stringify(keys.map((k) => [k, row[k]]));
  return crypto.createHash("sha1").update(norm).digest("hex").slice(0, 16);
}

/** id → 지문 두 묶음 비교 */
export function compareSnapshots(before: Map<string, string>, after: Map<string, string>): Omit<SourceReport, "source" | "status"> {
  const added: string[] = [];
  const changed: string[] = [];
  for (const [id, fp] of after) {
    const old = before.get(id);
    if (old === undefined) added.push(id);
    else if (old !== fp) changed.push(id);
  }
  const removed = [...before.keys()].filter((id) => !after.has(id));
  return { total: after.size, previous: before.size, added, removed, changed };
}

/** 이만큼 넘게 줄면 원천 오류로 보고 배포를 멈춘다 */
export const DROP_LIMIT = 0.1;

/** 하루에 이만큼 넘게 '변경'이면 잡음(조회수처럼 매번 바뀌는 칸)이나 원천 이상으로 본다 */
export const CHANGE_LIMIT = 0.3;

const n = (x: number) => x.toLocaleString("ko-KR");

/** 배포 전 점검: 수집 오류, 건수 급감, 변경 과다, 건수 불일치, 칸 사라짐, 메뉴판 결과 흔들림, 이틀 연속 보류 */
export function gateCheck(reports: readonly SourceReport[], prev: readonly { source: string; status: string }[] = []): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];
  for (const r of reports) {
    if (r.status === "error" || r.status === "unavailable") {
      warnings.push(`${r.source}: 수집 실패 — ${r.detail ?? r.status}`);
      continue;
    }
    if (r.status === "held") {
      if (prev.some((p) => p.source === r.source && p.status === "held")) warnings.push(`${r.source}: 이틀 연속 호출 한도 때문에 못 받았어요 — ${r.detail ?? "보류"}`);
      continue;
    }
    if (r.previous > 0 && r.total < r.previous * (1 - DROP_LIMIT)) {
      const pct = Math.round((1 - r.total / r.previous) * 100);
      warnings.push(`${r.source}: 건수가 ${pct}% 줄었어요 (${n(r.previous)} → ${n(r.total)})`);
    }
    if (r.previous > 0 && r.changed.length > r.previous * CHANGE_LIMIT) {
      const pct = Math.round((r.changed.length / r.previous) * 100);
      warnings.push(`${r.source}: 하루에 ${pct}%가 '변경'으로 잡혔어요 (${n(r.changed.length)}건) — 매번 바뀌는 칸이 섞였는지 확인`);
    }
    if (r.expected !== undefined && r.expected !== r.total) warnings.push(`${r.source}: 원천이 알려 준 건수(${n(r.expected)})와 받은 건수(${n(r.total)})가 달라요`);
    if (r.schemaMissing?.length) warnings.push(`${r.source}: 원천에서 칸이 사라졌어요 — ${r.schemaMissing.join(", ")}`);
    if (r.drift) warnings.push(`${r.source}: 바뀌지 않은 PDF ${n(r.drift)}개의 표 결과가 어제와 달라졌어요`);
  }
  return { ok: warnings.length === 0, warnings };
}

/** 칸 이름별로 값이 있는 행 수 (원천 구성이 바뀌었는지 보는 데 쓴다) */
export function fieldCounts(rows: readonly Record<string, unknown>[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const r of rows) for (const k of Object.keys(r)) c[k] = (c[k] ?? 0) + 1;
  return c;
}

/** 어제 행의 1% 넘게 있던 칸이 오늘 통째로 없으면 '사라짐' (원래 드문 칸은 날마다 있다 없다 할 수 있어 뺀다). ignore = 일부러 저장하지 않는 칸 ('serviceList.조회수'처럼 앞에 묶음 이름이 붙어도) */
export function missingFields(prev: Record<string, number> | undefined, now: Record<string, number>, ignore: readonly string[] = []): string[] {
  if (!prev) return [];
  const most = Math.max(0, ...Object.values(prev));
  const skip = (k: string) => ignore.includes(k.split(".").at(-1)!);
  return Object.keys(prev).filter((k) => prev[k] > most * 0.01 && !now[k] && !skip(k)).sort();
}

const SAMPLE = 50;
/** 하루 기록 한 줄: 개수 + 앞 50개 id */
export function summarize(r: SourceReport) {
  return {
    source: r.source,
    status: r.status,
    ...(r.detail ? { detail: r.detail } : {}),
    total: r.total,
    previous: r.previous,
    added: r.added.length,
    removed: r.removed.length,
    changed: r.changed.length,
    ...(r.expected !== undefined ? { expected: r.expected } : {}),
    ...(r.schemaMissing?.length ? { schemaMissing: r.schemaMissing } : {}),
    ...(r.drift !== undefined ? { drift: r.drift } : {}),
    sample: { added: r.added.slice(0, SAMPLE), removed: r.removed.slice(0, SAMPLE), changed: r.changed.slice(0, SAMPLE) },
  };
}

/** 메뉴판 행 → 글 열쇠(게시판:글번호:첨부)별 묶음 */
const byPost = (rows: readonly Record<string, string>[]) => {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const k = r.serviceId.split(":").slice(0, 3).join(":");
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(JSON.stringify(r));
  }
  return m;
};

/**
 * 메뉴판 표 읽는 방식(parse_menus.py PARSER_VERSION)이 어제 결과(parse-report.json parserVersion, 없으면 1)와 다른가.
 * 다르면 바뀌지 않은 PDF까지 모두 다시 읽어야 고친 결과가 들어간다 (2026-10-25)
 */
export function menuParserOutdated(pySource: string, report: { parserVersion?: number } | null | undefined): boolean {
  const now = Number(/^PARSER_VERSION\s*=\s*(\d+)/m.exec(pySource)?.[1] ?? 1);
  return now !== (report?.parserVersion ?? 1);
}

/** 메뉴판: 다시 읽지 않은 글(바뀌지 않은 PDF)인데 행이 어제와 달라진 글 수 — 0이어야 정상 */
export function menuDrift(before: readonly Record<string, string>[], after: readonly Record<string, string>[], reparsed: Set<string>): number {
  const a = byPost(before);
  const b = byPost(after);
  return [...a].filter(([k, rows]) => !reparsed.has(k) && b.has(k) && b.get(k)!.join("\n") !== rows.join("\n")).length;
}

/** 금액이 바뀐 사업 (보완대책 8) — 원문 지원내용에서 뽑은 금액(주기·원)이 어제와 다르면. 사람이 원문과 맞춰 본다 */
export interface MoneyChange { source: string; id: string; name: string; before?: Money; after?: Money }
export function moneyChanges(source: string, before: Map<string, { name: string; text: string }>, after: Map<string, { name: string; text: string }>): MoneyChange[] {
  const out: MoneyChange[] = [];
  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b || b.text === a.text) continue;
    const mb = extractMoney({ name: b.name, benefit: b.text });
    const ma = extractMoney({ name: a.name, benefit: a.text });
    if (mb?.won === ma?.won && mb?.per === ma?.per) continue;
    out.push({ source, id, name: a.name, ...(mb ? { before: mb } : {}), ...(ma ? { after: ma } : {}) });
  }
  return out;
}
