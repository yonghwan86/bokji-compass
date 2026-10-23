/** 검증된 변환본을 그대로 받게 하는 작은 해시 버킷 색인을 만든다.
 *
 * 화면 카드마다 1.5MB 짜리 conversions.json 을 읽지 않도록, 연결된 서식이 속한 샤드만
 * 받으면 되게 쪼갠다. 작성 버튼용 index/ 와 달리 화면 입력을 지원하지 않는 변환본까지
 * 모두 담는다. 여기서 새로 검증하지 않는다 — 이미 검증된 기록이 서로 맞는지만 본다.
 */
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { HwpxDownloadEntry, HwpxDownloadShard, HwpxDownloadSummary } from "../src/lib/data/paperWritingTypes";
import { detailBucket } from "../src/lib/data/bucket";

const FORM_ID = /^(?:ordin|law|rule)-\d{1,20}$|^agency-\d{5}-[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const hex64 = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const VERIFICATION = "hancom-roundtrip-text-and-every-page-pixel-identical";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export interface BuildResult { shards: Map<string, HwpxDownloadShard>; summary: HwpxDownloadSummary; rejected: { formId: string; reason: string }[] }

/** 한 변환 기록이 받을 수 있는 항목인지. 하나라도 어긋나면 사유와 함께 뺀다. */
export function downloadEntry(formId: string, value: unknown): { entry: HwpxDownloadEntry } | { reason: string } {
  if (!FORM_ID.test(formId)) return { reason: "form id" };
  if (!record(value)) return { reason: "not a record" };
  const source = value.source, asset = value.asset;
  if (!record(source) || source.format !== "hwp" || !hex64(source.sha256) || !positive(source.bytes)
      || typeof source.path !== "string" || source.path !== `/forms/files/${formId}-${String(source.sha256).slice(0, 12)}.hwp`)
    return { reason: "source identity" };
  if (!record(asset) || !hex64(asset.sha256) || !positive(asset.bytes) || typeof asset.path !== "string")
    return { reason: "asset identity" };
  // 주소가 곧 신원이다. 다른 원본이나 다른 변환본을 가리키면 내보내지 않는다.
  if (asset.path !== `/forms/writing/v1/converted/${formId}-${String(source.sha256).slice(0, 12)}-${String(asset.sha256).slice(0, 12)}.hwpx`)
    return { reason: "asset address" };
  if (!positive(value.pageCount)) return { reason: "page count" };
  if (value.metadataSanitized !== true) return { reason: "metadata not sanitized" };
  if (value.verification !== VERIFICATION) return { reason: "proof" };
  if (typeof value.checkedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.checkedAt)) return { reason: "checked day" };
  return { entry: { source: source as unknown as HwpxDownloadEntry["source"], asset: asset as unknown as HwpxDownloadEntry["asset"],
    pageCount: value.pageCount as number, checkedAt: value.checkedAt, verification: value.verification, metadataSanitized: true } };
}

export function buildDownloads(conversions: Record<string, unknown>, generatedAt: string): BuildResult {
  const shards = new Map<string, HwpxDownloadShard>();
  const rejected: { formId: string; reason: string }[] = [];
  let kept = 0;
  for (const formId of Object.keys(conversions).sort()) {
    const result = downloadEntry(formId, conversions[formId]);
    if ("reason" in result) { rejected.push({ formId, reason: result.reason }); continue; }
    const bucket = detailBucket(formId);
    const shard = shards.get(bucket) ?? { schema: 1 as const, bucket, forms: {} };
    shard.forms[formId] = result.entry;
    shards.set(bucket, shard);
    kept += 1;
  }
  return { shards, rejected, summary: { schema: 1, generatedAt, buckets: [...shards.keys()].sort(),
    counts: { conversions: Object.keys(conversions).length, downloads: kept, rejected: rejected.length } } };
}

/** 그 자리에 그 바이트로 있는지. 공개 원본(HWP)과 변환본을 모두 읽어 확인한다. */
async function fileMatches(publicDir: string, address: string, bytes: number, sha256: string): Promise<string | null> {
  try {
    const data = await readFile(path.join(publicDir, address.replace(/^\//, "")));
    if (data.length !== bytes) return "bytes";
    if (createHash("sha256").update(data).digest("hex") !== sha256) return "hash";
    return null;
  } catch { return "file"; }
}

/** 원본·변환본 실바이트가 기록과 같은 것만 남긴다. 하나라도 어긋나면 그 서식은 내보내지 않는다. */
export async function presentAssets(shards: Map<string, HwpxDownloadShard>, publicDir: string): Promise<{ formId: string; reason: string }[]> {
  const missing: { formId: string; reason: string }[] = [];
  for (const shard of shards.values()) {
    for (const [formId, entry] of Object.entries(shard.forms)) {
      const source = await fileMatches(publicDir, entry.source.path, entry.source.bytes, entry.source.sha256);
      const asset = source ? null : await fileMatches(publicDir, entry.asset.path, entry.asset.bytes, entry.asset.sha256);
      if (!source && !asset) continue;
      missing.push({ formId, reason: source ? `source ${source}` : `asset ${asset}` });
      delete shard.forms[formId];
    }
  }
  return missing;
}

async function main(): Promise<void> {
  const publicDir = path.resolve(process.cwd(), process.argv[2] ?? "public");
  const writing = path.join(publicDir, "forms/writing/v1");
  const conversions = JSON.parse(await readFile(path.join(writing, "conversions.json"), "utf-8")) as { schema?: number; forms?: Record<string, unknown> };
  if (conversions.schema !== 1 || !record(conversions.forms)) throw new Error("Invalid conversions index");

  const built = buildDownloads(conversions.forms, new Date().toISOString());
  const missing = await presentAssets(built.shards, publicDir);
  for (const row of missing) built.rejected.push(row);
  built.summary.counts.downloads -= missing.length;
  built.summary.counts.rejected = built.rejected.length;
  built.summary.buckets = [...built.shards.keys()].filter(bucket => Object.keys(built.shards.get(bucket)!.forms).length).sort();

  const out = path.join(writing, "downloads");
  await mkdir(out, { recursive: true });
  const expected = new Set<string>();
  for (const bucket of built.summary.buckets) {
    const name = `${bucket}.json`;
    expected.add(name);
    await writeFile(path.join(out, name), JSON.stringify(built.shards.get(bucket)));
  }
  // 이번에 만들지 않은 옛 샤드는 남겨 두지 않는다.
  for (const name of await readdir(out)) if (/^[0-9a-f]{2}\.json$/.test(name) && !expected.has(name)) await unlink(path.join(out, name));
  await writeFile(path.join(writing, "downloads.json"), JSON.stringify(built.summary));

  console.log(`변환 ${built.summary.counts.conversions} / 내려받기 ${built.summary.counts.downloads} / 제외 ${built.summary.counts.rejected} / 샤드 ${built.summary.buckets.length}`);
  for (const row of built.rejected.slice(0, 20)) console.log(`  제외 ${row.formId}: ${row.reason}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main().catch(error => { console.error(error); process.exit(1); });
}
