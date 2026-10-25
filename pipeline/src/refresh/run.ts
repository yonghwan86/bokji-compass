/**
 * 매일 변경 감지 실행기 (2026-10-22) — GitHub Actions(.github/workflows/data-refresh.yml)가 매일 0시 10분(한국 시간)에 돌린다.
 *  1. 원천별 어제 목록의 지문을 뜬다 (pipeline/raw = data 브랜치)
 *  2. 수집: 정부24 전체 다시 받기(약 33번 호출) · 복지로 목록 새로 받기 + 바뀐 상세만 · 메뉴판 바뀐 PDF만 (+바뀌면 표 다시 읽기)
 *  3. 오늘 지문과 비교 → 추가·변경·삭제, 배포 전 점검(수집 실패·건수 10% 넘게 감소·하루 30% 넘게 변경·원천 건수 불일치·
 *     칸 사라짐·바뀌지 않은 메뉴판 PDF의 결과 흔들림·호출 한도로 이틀 연속 보류)
 *     메뉴판은 바뀐 PDF만 다시 읽고 나머지 글은 어제 표를 그대로 쓴다 (parse_menus.py --changed=…)
 *     금액이 바뀐 사업(원문 지원내용에서 뽑은 금액이 어제와 다름)은 따로 모아 사람이 원문과 맞춰 보게 한다 (점검 경고는 아님)
 *  4. pipeline/raw/_report.json(오늘) · _history.json(날짜별 한 줄, 최근 400일) — 사이트 '데이터 현황'(/data)이 읽는다
 * 점검에 걸리면 종료 코드 1 → Actions가 실패로 표시하고 저장소 주인에게 알림 메일.
 * 키(DATA_GO_KR_SERVICE_KEY)는 환경변수로만 쓰고 출력하지 않는다.
 *
 * 사용: npx tsx pipeline/src/refresh/run.ts [--skip-fetch]  (--skip-fetch: 수집 없이 지금 캐시로 보고서만)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { GOV24_NOISE, readCached, readTotalCount } from "../gov24/ingest";
import { LIST_NOISE, listFingerprints, listTotalCount, readDetail, readList, type Kind } from "../bokjiro/ingest";
import { parseCsv } from "../sources/icare";
import { compareSnapshots, fieldCounts, fingerprint, gateCheck, menuDrift, menuParserOutdated, missingFields, moneyChanges, summarize, type SourceReport } from "./diff";

const ROOT = path.resolve(__dirname, "../../..");
const RAW = path.join(ROOT, "pipeline/raw");
const GOV24_ENDPOINTS = ["serviceList", "supportConditions", "serviceDetail"] as const;

function gov24Fingerprints(): Map<string, string> {
  const parts = new Map<string, string[]>();
  for (const ep of GOV24_ENDPOINTS) {
    for (const r of readCached(ep).rows) {
      const id = String(r["서비스ID"] ?? "");
      if (!id) continue;
      if (!parts.has(id)) parts.set(id, []);
      parts.get(id)!.push(fingerprint(r, GOV24_NOISE));
    }
  }
  return new Map([...parts].map(([id, fps]) => [id, fps.join(":")]));
}

function mohwFingerprints(): Map<string, string> {
  const f = path.join(RAW, "mohw/index.json");
  if (!fs.existsSync(f)) return new Map();
  const posts = JSON.parse(fs.readFileSync(f, "utf8")).posts as { bid: string; listNo: string; seq: string; sha256?: string; sizeLabel: string; title: string }[];
  return new Map(posts.map((p) => [`${p.bid}:${p.listNo}:${p.seq}`, p.sha256 ?? `${p.sizeLabel}|${p.title}`]));
}

/** 원문 지원내용 (금액 비교용): 정부24 상세 '지원내용', 복지로 상세 alwServCn */
type Texts = Map<string, { name: string; text: string }>;
function gov24Texts(): Texts {
  return new Map(readCached("serviceDetail").rows.map((r) => [String(r["서비스ID"]), { name: String(r["서비스명"] ?? ""), text: String(r["지원내용"] ?? "") }]));
}
function bokjiroTexts(kind: Kind): Texts {
  const out: Texts = new Map();
  for (const r of readList(kind)) {
    const text = readDetail(kind, r.servId)?.alwServCn;
    if (text) out.set(r.servId, { name: r.servNm ?? "", text: String(text) });
  }
  return out;
}
/** 한 번에 보여 줄 금액 변경 수 (넘으면 개수만) */
const MONEY_SAMPLE = 100;

const readMenu = (): Record<string, string>[] => {
  const f = path.join(RAW, "mohw/policies.csv");
  return fs.existsSync(f) ? parseCsv(fs.readFileSync(f, "utf8")) : [];
};

/** 원천별 칸 구성 (칸 이름 → 값이 있는 행 수) — 어제와 비교해 사라진 칸을 찾는다 */
function schemaNow(): Record<string, Record<string, number>> {
  const gov24: Record<string, number> = {};
  for (const ep of GOV24_ENDPOINTS) for (const [k, v] of Object.entries(fieldCounts(readCached(ep).rows))) gov24[`${ep}.${k}`] = v;
  const menu = readMenu();
  return {
    gov24,
    "bokjiro-central": fieldCounts(readList("central")),
    "bokjiro-local": fieldCounts(readList("local")),
    mohw: menu.length ? Object.fromEntries(Object.keys(menu[0]).map((k) => [k, menu.length])) : {},
  };
}

const readJson = (rel: string) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(RAW, rel), "utf8"));
  } catch {
    return null;
  }
};

function run(script: string, args: string[] = []): string | null {
  try {
    execFileSync(script.endsWith(".py") ? "python3" : "npx", script.endsWith(".py") ? [script, ...args] : ["tsx", script, ...args], { cwd: ROOT, stdio: "inherit", env: process.env });
    return null;
  } catch (e) {
    return `실행 실패: ${path.basename(script)} (${(e as Error).message.split("\n")[0].slice(0, 120)})`;
  }
}

function main() {
  const skip = process.argv.includes("--skip-fetch");
  const kinds: Kind[] = ["central", "local"];
  const before = { gov24: gov24Fingerprints(), central: listFingerprints("central"), local: listFingerprints("local"), mohw: mohwFingerprints() };

  const prevReport = readJson("_report.json");
  const prevSchema: Record<string, Record<string, number>> = prevReport?.schema ?? {};
  const menuBefore = readMenu();
  const textsBefore = { gov24: gov24Texts(), central: bokjiroTexts("central"), local: bokjiroTexts("local") };

  const errors: Record<string, string | null> = {};
  if (!skip) {
    errors.gov24 = run("pipeline/src/gov24/ingest.ts", ["--refresh"]);
    errors.bokjiro = run("pipeline/src/bokjiro/ingest.ts", ["--refresh-lists"]);
    errors.mohw = run("pipeline/src/mohw/ingest.ts");
  }
  const mohwAfter = mohwFingerprints();
  const mohwDiff = compareSnapshots(before.mohw, mohwAfter);
  // 바뀐·새 PDF만 다시 읽고 나머지 글은 어제 표 그대로 (표가 아직 없으면 전부 읽기)
  // 표 읽는 방식이 바뀌었으면 모든 PDF를 다시 읽는다 (parse_menus.py가 판을 보고 전부 읽음 — 어긋남 검사도 전부로)
  const outdated = menuParserOutdated(fs.readFileSync(path.join(ROOT, "pipeline/mohw/parse_menus.py"), "utf8"), readJson("mohw/parse-report.json"));
  const reparsed = new Set(outdated ? mohwAfter.keys() : [...mohwDiff.added, ...mohwDiff.changed]);
  if (!skip && (reparsed.size || mohwDiff.removed.length || !menuBefore.length)) {
    errors.mohwParse = run("pipeline/mohw/parse_menus.py", menuBefore.length ? [`--changed=${[...reparsed].join(",")}`] : []);
  }
  const schema = schemaNow();
  const lost = (source: string) => missingFields(prevSchema[source], schema[source] ?? {}, [...GOV24_NOISE, ...LIST_NOISE]);

  const gov24Status = readJson("gov24/_status.json");
  const bokjiroStatus = readJson("bokjiro/_status.json") ?? {};
  const reports: SourceReport[] = [
    {
      source: "gov24",
      status: errors.gov24 ? "error" : gov24Status?.status ?? "error",
      detail: errors.gov24 ?? (gov24Status?.status !== "ok" ? gov24Status?.detail : undefined),
      ...compareSnapshots(before.gov24, gov24Fingerprints()),
      expected: readTotalCount("serviceList"),
      schemaMissing: lost("gov24"),
    },
    ...kinds.map((k): SourceReport => {
      const st = bokjiroStatus[k] ?? {};
      return {
        source: `bokjiro-${k}`,
        status: errors.bokjiro ? "error" : st.status ?? "error",
        detail: errors.bokjiro ?? (st.status !== "ok" ? st.message ?? st.code : undefined),
        ...compareSnapshots(before[k], listFingerprints(k)),
        expected: listTotalCount(k),
        schemaMissing: lost(`bokjiro-${k}`),
      };
    }),
    {
      source: "mohw",
      status: errors.mohw || errors.mohwParse ? "error" : "ok",
      detail: errors.mohw ?? errors.mohwParse ?? undefined,
      ...mohwDiff,
      schemaMissing: lost("mohw"),
      drift: menuBefore.length ? menuDrift(menuBefore, readMenu(), reparsed) : undefined,
    },
  ];
  // 어제 기록(오늘 다시 돌린 것이면 그 전 날)과 비교해 이틀 연속 보류를 본다
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const history0 = (readJson("_history.json") as { date: string; sources: { source: string; status: string }[] }[] | null) ?? [];
  const gate = gateCheck(reports, history0.filter((h) => h.date !== today).at(-1)?.sources ?? []);
  const checkedAt = new Date().toISOString();
  const date = today;
  const detailProgress = Object.fromEntries(kinds.map((k) => [k, bokjiroStatus[k]?.detail ?? null]));
  // mode: daily = 오늘 원천을 실제로 다시 받음 / baseline = 수집 없이 지금 캐시로 만든 기준 보고서
  const money = [
    ...moneyChanges("gov24", textsBefore.gov24, gov24Texts()),
    ...kinds.flatMap((k) => moneyChanges(`bokjiro-${k}`, textsBefore[k], bokjiroTexts(k))),
  ];
  const report = {
    checkedAt, date, mode: skip ? "baseline" : "daily", gate, sources: reports.map(summarize), bokjiroDetail: detailProgress,
    moneyChanged: { count: money.length, items: money.slice(0, MONEY_SAMPLE) }, schema,
  };
  fs.writeFileSync(path.join(RAW, "_report.json"), JSON.stringify(report, null, 1));

  const history = (readJson("_history.json") as unknown[] | null) ?? [];
  const line = { date, checkedAt, mode: skip ? "baseline" : "daily", gateOk: gate.ok, moneyChanged: money.length, sources: reports.map((r) => ({ source: r.source, status: r.status, total: r.total, added: r.added.length, removed: r.removed.length, changed: r.changed.length })) };
  const kept = (history as { date: string }[]).filter((h) => h.date !== date);
  fs.writeFileSync(path.join(RAW, "_history.json"), JSON.stringify([...kept, line].slice(-400), null, 1));

  for (const r of reports) console.log(`[refresh] ${r.source}: ${r.status} · ${r.total}건 (추가 ${r.added.length} · 변경 ${r.changed.length} · 삭제 ${r.removed.length})`);
  console.log(`[refresh] 금액이 바뀐 사업 ${money.length}건`);
  if (!gate.ok) {
    for (const w of gate.warnings) console.error(`[refresh] 경고: ${w}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
