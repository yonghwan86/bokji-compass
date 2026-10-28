/**
 * 사이트 데이터 자동 재생성 PR 요약 (2026-10-22 보완대책 7, .github/workflows/data-rebuild.yml).
 * 재생성 전후 번들(생성 시각은 무시)·페르소나 상위 5개·테스트 결과·매일 확인 보고서를 모아 PR 본문과 머지 가능 여부를 만든다.
 * 점검을 모두 통과하면 워크플로가 자동으로 머지한다(2026-10-27) — 하나라도 걸리면 초안으로 두고 '사이트 데이터 반영 보류' 이슈로 알린다.
 * 사용: npx tsx scripts/data-rebuild-summary.ts --old <전 번들> --new public/bundles/v1 --before <전.json> --after <후.json> \
 *        --vitest <vitest.json> --report pipeline/raw/_report.json --source <data 커밋> --md <본문.md> --json <결과.json>
 */
import fs from "node:fs";
import path from "node:path";

type P = { id: string; name: string; sources?: { source: string; id: string }[]; [k: string]: unknown };
type Op = { name: string };

function bundleFiles(root: string): string[] {
  const out: string[] = [];
  for (const sub of ["", "sido", "sigungu"]) {
    const d = path.join(root, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).sort()) if (f.endsWith(".json") && (sub || f === "national.json")) out.push(path.join(sub, f));
  }
  return out;
}
const programsOf = (root: string, f: string): P[] => {
  const file = path.join(root, f);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")).programs ?? []) : [];
};
const localOpsOf = (root: string, f: string): Op[] => {
  const file = path.join(root, f);
  return fs.existsSync(file) ? Object.values((JSON.parse(fs.readFileSync(file, "utf8")).localOps ?? {}) as Record<string, Op[]>).flat() : [];
};
const strip = (file: string) => {
  if (!fs.existsSync(file)) return "";
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  delete j.generatedAt;
  return JSON.stringify(j);
};

const nameKey = (s: string) => s.normalize("NFC").replace(/[^0-9A-Za-z가-힣]/g, "");
const srcKeys = (p: P) => (p.sources ?? []).map((s) => `${s.source}:${s.id}`);

/** 두 이름 사이 편집(바꾸기·넣기·빼기) 수와, 편집이 일어난 a 쪽 위치 */
function edits(a: string, b: string): { n: number; at: number[] } {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const at: number[] = [];
  for (let i = a.length, j = b.length; i > 0 || j > 0; ) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { if (a[i - 1] !== b[j - 1]) at.push(i - 1); i--; j--; }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { at.push(i - 1); i--; }
    else { at.push(i); j--; }
  }
  return { n: d[a.length][b.length], at };
}

/** 원문 오타로 한두 글자만 달라진 같은 이름인지 (2026-10-28: 메뉴판 PDF의 '임플라트'·'AI·loT' 등 42개가 '새 결과에 없음'으로 잡힘).
 * 6글자 이상에서 1글자 차이, 또는 10글자 이상에서 떨어진 2글자 차이(14글자 이상이면 붙어 있어도). 붙은 두 글자가 바뀐 짧은 이름
 * ('…방문요양' / '…방문간호')은 다른 세부 사업으로 본다. */
export function nearName(a: string, b: string): boolean {
  const len = Math.min(a.length, b.length);
  if (len < 6) return false;
  const e = edits(a, b);
  if (e.n === 1) return true;
  if (e.n !== 2) return false;
  if (len >= 14) return true;
  return len >= 10 && Math.abs(e.at[0] - e.at[1]) > 1;
}

/** 빠진 사업이 어디로 갔는지 (2026-10-25: #62가 1,466개를 '빠짐'으로 셌는데 1,179개는 10-22 결정대로 전국 사업 안으로 옮겨진 것) */
export type RemovedKind = "ops" | "merged" | "renamed" | "gone";
export const REMOVED_LABEL: Record<RemovedKind, string> = {
  ops: "전국 사업의 '우리 지역 운영 정보'로 옮김",
  merged: "다른 사업과 합쳐짐·지역 옮김 (같은 원천 ID가 새 결과에 있음)",
  renamed: "이름·ID만 바뀜 (같은 지역에 비슷한 이름·한두 글자 오타)",
  gone: "새 결과에 없음",
};

/** 전후 번들의 사업 비교 (전국·시도·시군구 파일, 생성 시각 제외) */
export function compareBundles(oldDir: string, newDir: string) {
  const files = [...new Set([...bundleFiles(oldDir), ...bundleFiles(newDir)])].sort();
  const a = new Map<string, P>(), b = new Map<string, P>();
  const fileOf = new Map<string, string>();
  const newNames = new Map<string, string[]>(), newOps = new Map<string, Set<string>>();
  let changedFiles = 0;
  for (const f of files) {
    if (strip(path.join(oldDir, f)) !== strip(path.join(newDir, f))) changedFiles++;
    for (const p of programsOf(oldDir, f)) if (!a.has(p.id)) (a.set(p.id, p), fileOf.set(p.id, f));
    const progs = programsOf(newDir, f);
    for (const p of progs) if (!b.has(p.id)) b.set(p.id, p);
    newNames.set(f, progs.map((p) => nameKey(p.name)));
    newOps.set(f, new Set(localOpsOf(newDir, f).map((o) => nameKey(o.name))));
  }
  const added = [...b.values()].filter((p) => !a.has(p.id));
  const removed = [...a.values()].filter((p) => !b.has(p.id));
  const changed = [...b.values()].filter((p) => a.has(p.id) && JSON.stringify(a.get(p.id)) !== JSON.stringify(p));
  const newSources = new Set([...b.values()].flatMap(srcKeys));
  const kindOf = (p: P): RemovedKind => {
    const f = fileOf.get(p.id)!;
    const k = nameKey(p.name);
    // 하나였던 항목이 세부 항목으로 나뉘어 옮겨진 것도 ('장기요양서비스' → '장기요양서비스 (방문요양)', 2026-10-28)
    if ([...(newOps.get(f) ?? [])].some((q) => q === k || (k.length >= 4 && q.startsWith(k)))) return "ops";
    if (srcKeys(p).some((s) => newSources.has(s))) return "merged";
    if ((newNames.get(f) ?? []).some((q) => q === k || (k.length >= 4 && q.length >= 4 && (q.includes(k) || k.includes(q))) || nearName(k, q))) return "renamed";
    return "gone";
  };
  const removedBy: Record<RemovedKind, P[]> = { ops: [], merged: [], renamed: [], gone: [] };
  for (const p of removed) removedBy[kindOf(p)].push(p);
  return { before: a.size, after: b.size, added, removed, removedBy, changed, changedFiles };
}

export function personaDiff(before: Record<string, string[]>, after: Record<string, string[]>) {
  return Object.keys(before)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k] ?? []))
    .map((k) => ({ persona: k, before: before[k], after: after[k] ?? [] }));
}

/** 머지 가능 여부: 테스트가 모두 통과하고 복지로 상세를 다 받았을 때만 */
export function readiness(x: { failedTests: string[]; bokjiroRemaining: number }): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const forms = x.failedTests.filter((t) => t.startsWith("forms-catalog"));
  if (forms.length) reasons.push(`서식 연결 재대조 필요 — 사업 ID가 바뀌어 forms-catalog 테스트 ${forms.length}개 실패 (서식 담당, docs/FORM_ORIGINAL_MATCHING.md)`);
  const other = x.failedTests.length - forms.length;
  if (other) reasons.push(`테스트 ${other}개 실패 — 아래 목록 확인`);
  if (x.bokjiroRemaining > 0) reasons.push(`복지로 상세 ${x.bokjiroRemaining.toLocaleString("ko-KR")}건을 아직 못 받아 그 사업의 대상·금액이 빌 수 있음 (매일 이어 받는 중)`);
  return { ready: reasons.length === 0, reasons };
}

/** 자동 머지 기준: 빠지는 사업 중 '새 결과에 없음'이 이보다 많으면 사람이 본다 */
export const GONE_LIMIT = 50;

/** 자동 머지 여부 (2026-10-27): 머지 가능 + 페르소나 상위 5개 그대로 + '새 결과에 없음' 기준 이하. 수집 점검 7가지는 통과해야 이 워크플로가 돈다. */
export function autoMerge(x: { ready: { ready: boolean; reasons: string[] }; personaChanged: number; gone: number }): { ok: boolean; reasons: string[] } {
  const reasons = [...x.ready.reasons];
  if (x.personaChanged) reasons.push(`페르소나 ${x.personaChanged.toLocaleString("ko-KR")}개의 상위 5개가 바뀜 — 판정이 바뀌는 날은 사람이 확인`);
  if (x.gone > GONE_LIMIT) reasons.push(`빠지는 사업 중 '새 결과에 없음' ${x.gone.toLocaleString("ko-KR")}개 (자동 머지 기준 ${GONE_LIMIT}개 초과)`);
  return { ok: reasons.length === 0, reasons };
}

/** 실패한 테스트 '파일 > 이름 — 이유 첫 줄' (워크플로는 테스트 출력을 버려서 이유를 여기 남긴다 — 2026-10-26 시간 초과를 못 알아봄) */
export function failedFromVitest(file: string): string[] {
  if (!fs.existsSync(file)) return ["(테스트 결과 파일 없음)"];
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const reason = (msgs?: string[]) => {
    const line = (msgs?.[0] ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((x) => x.trim()).find(Boolean) ?? "";
    return line ? ` — ${line.length > 120 ? line.slice(0, 119) + "…" : line}` : "";
  };
  return (j.testResults ?? []).flatMap((r: { name: string; assertionResults?: { status: string; fullName: string; failureMessages?: string[] }[] }) =>
    (r.assertionResults ?? []).filter((t) => t.status === "failed").map((t) => `${path.basename(r.name).replace(/\.test\.ts$/, "")} > ${t.fullName}${reason(t.failureMessages)}`));
}

function main() {
  const arg = (k: string) => {
    const i = process.argv.indexOf(`--${k}`);
    if (i < 0) throw new Error(`--${k} 필요`);
    return process.argv[i + 1];
  };
  const n = (x: number) => x.toLocaleString("ko-KR");
  const cmp = compareBundles(arg("old"), arg("new"));
  const personas = personaDiff(JSON.parse(fs.readFileSync(arg("before"), "utf8")), JSON.parse(fs.readFileSync(arg("after"), "utf8")));
  const failed = failedFromVitest(arg("vitest"));
  const report = JSON.parse(fs.readFileSync(arg("report"), "utf8"));
  const remaining = Object.values((report.bokjiroDetail ?? {}) as Record<string, { remaining?: number } | null>).reduce((s, d) => s + (d?.remaining ?? 0), 0);
  const ready = readiness({ failedTests: failed, bokjiroRemaining: remaining });
  const changed = cmp.changedFiles > 0;
  const auto = autoMerge({ ready, personaChanged: personas.length, gone: cmp.removedBy.gone.length });
  const list = (ps: P[]) => ps.slice(0, 15).map((p) => `\`${p.id}\` ${p.name}`).join(" · ") + (ps.length > 15 ? ` 외 ${n(ps.length - 15)}개` : "");
  const md = [
    `매일 확인(${report.date}, data 브랜치 \`${arg("source").slice(0, 8)}\`)을 통과한 원천으로 사이트 데이터를 다시 만들었어요.`,
    "",
    auto.ok ? "## 자동 머지: 점검 모두 통과" : "## 자동 머지 보류 — 사람이 확인할 것",
    ...(auto.ok
      ? ["- 테스트 모두 통과, 복지로 상세 모두 받음, 페르소나 상위 5개 그대로, '새 결과에 없음' 기준 이하. 워크플로가 바로 머지하고 운영 사이트 반영까지 확인해요."]
      : [...auto.reasons.map((r) => `- ${r}`), ...(ready.ready ? ["- 위 내용을 보고 괜찮으면 직접 머지해 주세요."] : [])]),
    "",
    "## 바뀌는 것",
    `- 사업 ${n(cmp.before)} → ${n(cmp.after)} · 바뀐 번들 파일 ${n(cmp.changedFiles)}개`,
    `- 새 사업 ${n(cmp.added.length)}: ${list(cmp.added) || "없음"}`,
    `- 빠지는 사업 ${n(cmp.removed.length)} (예전 상세 주소가 없어짐) — 어디로 갔는지:`,
    ...(["ops", "merged", "renamed"] as const).map((k) => `  - ${REMOVED_LABEL[k]} ${n(cmp.removedBy[k].length)}`),
    `  - **${REMOVED_LABEL.gone} ${n(cmp.removedBy.gone.length)}** (원천에서 내려갔거나 표 읽기가 달라진 것 — 이것만 살펴보면 돼요): ${list(cmp.removedBy.gone) || "없음"}`,
    `- 내용이 바뀐 사업 ${n(cmp.changed.length)}`,
    `- 금액이 바뀐 사업 (매일 확인 기준, 원문과 맞춰 볼 것): ${n(report.moneyChanged?.count ?? 0)}건 — 사이트 '데이터 현황'에 목록`,
    "",
    `## 페르소나 상위 5개 (${personas.length ? `${n(personas.length)}개 바뀜` : "모두 같음"})`,
    ...personas.flatMap((x) => [`- **${x.persona}**`, `  - 전: ${x.before.join(" · ") || "(없음)"}`, `  - 후: ${x.after.join(" · ") || "(없음)"}`]),
    "",
    `## 테스트 (${failed.length ? `${n(failed.length)}개 실패` : "모두 통과"})`,
    ...failed.slice(0, 30).map((t) => `- ${t}`),
    "",
    "🤖 data-rebuild.yml 이 자동으로 만들었어요. 다음 재생성 때 이 PR을 새 결과로 덮어써요.",
  ].join("\n");
  fs.writeFileSync(arg("md"), md);
  fs.writeFileSync(arg("json"), JSON.stringify({ changed, ready: ready.ready, autoMerge: auto.ok, reasons: auto.reasons }));
  console.log(md);
}

if (require.main === module) main();
