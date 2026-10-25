/**
 * 사이트 데이터 자동 재생성 PR 요약 (2026-10-22 보완대책 7, .github/workflows/data-rebuild.yml).
 * 재생성 전후 번들(생성 시각은 무시)·페르소나 상위 5개·테스트 결과·매일 확인 보고서를 모아 PR 본문과 머지 가능 여부를 만든다.
 * 머지는 사람이 한다 — 테스트 실패(서식 재대조 포함)나 복지로 상세가 남아 있으면 초안으로 둔다.
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

/** 빠진 사업이 어디로 갔는지 (2026-10-25: #62가 1,466개를 '빠짐'으로 셌는데 1,179개는 10-22 결정대로 전국 사업 안으로 옮겨진 것) */
export type RemovedKind = "ops" | "merged" | "renamed" | "gone";
export const REMOVED_LABEL: Record<RemovedKind, string> = {
  ops: "전국 사업의 '우리 지역 운영 정보'로 옮김",
  merged: "다른 사업과 합쳐짐·지역 옮김 (같은 원천 ID가 새 결과에 있음)",
  renamed: "이름·ID만 바뀜 (같은 지역에 비슷한 이름)",
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
    if (newOps.get(f)?.has(k)) return "ops";
    if (srcKeys(p).some((s) => newSources.has(s))) return "merged";
    if ((newNames.get(f) ?? []).some((q) => q === k || (k.length >= 4 && q.length >= 4 && (q.includes(k) || k.includes(q))))) return "renamed";
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

function failedFromVitest(file: string): string[] {
  if (!fs.existsSync(file)) return ["(테스트 결과 파일 없음)"];
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  return (j.testResults ?? []).flatMap((r: { name: string; assertionResults?: { status: string; fullName: string }[] }) =>
    (r.assertionResults ?? []).filter((t) => t.status === "failed").map((t) => `${path.basename(r.name).replace(/\.test\.ts$/, "")} > ${t.fullName}`));
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
  const list = (ps: P[]) => ps.slice(0, 15).map((p) => `\`${p.id}\` ${p.name}`).join(" · ") + (ps.length > 15 ? ` 외 ${n(ps.length - 15)}개` : "");
  const md = [
    `매일 확인(${report.date}, data 브랜치 \`${arg("source").slice(0, 8)}\`)을 통과한 원천으로 사이트 데이터를 다시 만들었어요. **머지는 사람이 해요.**`,
    "",
    ready.ready ? "## 머지 전 확인: 막는 것 없음" : "## 머지 전에 끝나야 할 것",
    ...(ready.ready ? ["- 테스트 모두 통과, 복지로 상세 모두 받음. 아래 바뀐 내용과 페르소나 변화를 보고 머지해 주세요."] : ready.reasons.map((r) => `- ${r}`)),
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
  fs.writeFileSync(arg("json"), JSON.stringify({ changed, ready: ready.ready }));
  console.log(md);
}

if (require.main === module) main();
