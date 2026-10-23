import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDownloads, downloadEntry } from "../../scripts/build-hwpx-downloads";
import { hwpxDownloadFor, validHwpxDownload } from "@/lib/client/verifiedHwpxDownloads";
import { detailBucket } from "@/lib/data/bucket";

const PUBLIC = path.join(process.cwd(), "public");
const conversions = JSON.parse(readFileSync(path.join(PUBLIC, "forms/writing/v1/conversions.json"), "utf-8")).forms as Record<string, Record<string, unknown>>;
const writableIds: string[] = JSON.parse(readFileSync(path.join(PUBLIC, "forms/writing/v1/index.json"), "utf-8")).formIds;
const WRITABLE = "ordin-19969911";
const UNSUPPORTED = "agency-41270-longevity-02784";
const entryOf = (formId: string) => {
  const result = downloadEntry(formId, conversions[formId]);
  if ("reason" in result) throw new Error(`${formId}: ${result.reason}`);
  return result.entry;
};

describe("verified hwpx downloads", () => {
  it("covers every verified conversion, including the ones with no screen input", () => {
    const built = buildDownloads(conversions, "2026-10-23T00:00:00.000Z");
    expect(built.summary.counts.conversions).toBe(Object.keys(conversions).length);
    expect(built.summary.counts.downloads).toBe(Object.keys(conversions).length);
    expect(built.rejected).toEqual([]);
    // 입력을 지원하지 않는 변환본도 받을 수 있어야 한다. 그렇다고 입력 가능이라고 적지는 않는다.
    expect(writableIds).not.toContain(UNSUPPORTED);
    expect(built.shards.get(detailBucket(UNSUPPORTED))?.forms[UNSUPPORTED]).toBeTruthy();
    expect(built.shards.get(detailBucket(WRITABLE))?.forms[WRITABLE]).toBeTruthy();
  });

  it("keeps each shard small enough to load on one card", () => {
    const built = buildDownloads(conversions, "2026-10-23T00:00:00.000Z");
    const sizes = [...built.shards.values()].map(shard => JSON.stringify(shard).length);
    expect(built.shards.size).toBeGreaterThan(200);
    expect(Math.max(...sizes)).toBeLessThan(64 * 1024);
    expect(Math.max(...sizes)).toBeLessThan(JSON.stringify(conversions).length / 20);
  });

  it("points at the real converted bytes", () => {
    for (const formId of [WRITABLE, UNSUPPORTED]) {
      const entry = entryOf(formId);
      const bytes = readFileSync(path.join(PUBLIC, entry.asset.path.replace(/^\//, "")));
      expect(bytes.length).toBe(entry.asset.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.asset.sha256);
      expect(validHwpxDownload(entry, formId)).toBe(entry);
    }
  });

  it("rejects a wrong source, hash or path", () => {
    const entry = entryOf(WRITABLE);
    const raw = conversions[WRITABLE];
    const other = entryOf(UNSUPPORTED);
    // 다른 서식의 항목을 이 서식 자리에 둘 수 없다.
    expect(validHwpxDownload(other, WRITABLE)).toBeNull();
    expect(validHwpxDownload(entry, UNSUPPORTED)).toBeNull();
    // 원본이 바뀌면 변환본 주소가 더 이상 그 원본의 것이 아니다.
    expect(validHwpxDownload({ ...entry, source: { ...entry.source, sha256: "0".repeat(64) } }, WRITABLE)).toBeNull();
    expect(validHwpxDownload({ ...entry, asset: { ...entry.asset, sha256: "0".repeat(64) } }, WRITABLE)).toBeNull();
    expect(validHwpxDownload({ ...entry, asset: { ...entry.asset, path: "/forms/files/evil.hwpx" } }, WRITABLE)).toBeNull();
    expect(validHwpxDownload({ ...entry, asset: { ...entry.asset, bytes: 0 } }, WRITABLE)).toBeNull();
    expect(validHwpxDownload({ ...entry, source: { ...entry.source, format: "hwpx" } }, WRITABLE)).toBeNull();
    // 빌더도 같은 기준으로 막는다.
    for (const change of [{ metadataSanitized: false }, { verification: "" }, { pageCount: 0 }, { checkedAt: "2026" },
      { asset: { ...(raw.asset as object), path: "/forms/writing/v1/converted/other-aaaaaaaaaaaa-bbbbbbbbbbbb.hwpx" } },
      { source: { ...(raw.source as object), path: "/forms/files/other.hwp" } }])
      expect(downloadEntry(WRITABLE, { ...raw, ...change })).toHaveProperty("reason");
    expect(downloadEntry("../evil", raw)).toHaveProperty("reason");
  });

  it("requires the exact source address and the one accepted proof", () => {
    const entry = entryOf(WRITABLE);
    const raw = conversions[WRITABLE];
    // 원본 주소가 그 서식·그 해시의 것이 아니면 받지 않는다.
    expect(validHwpxDownload({ ...entry, source: { ...entry.source, path: "/forms/files/other-aaaaaaaaaaaa.hwp" } }, WRITABLE)).toBeNull();
    expect(validHwpxDownload({ ...entry, source: { ...entry.source, path: entry.asset.path } }, WRITABLE)).toBeNull();
    expect(downloadEntry(WRITABLE, { ...raw, source: { ...(raw.source as object), path: "/forms/files/other-aaaaaaaaaaaa.hwp" } })).toHaveProperty("reason");
    // 그럴듯한 설명 문구는 증거가 되지 않는다. 정확한 검증 문자열만 받는다.
    for (const proof of ["검증 완료했습니다", "hancom-roundtrip", "hancom-roundtrip-text-and-every-page-pixel-identical ", "verified-by-coordinator"]) {
      expect(validHwpxDownload({ ...entry, verification: proof }, WRITABLE)).toBeNull();
      expect(downloadEntry(WRITABLE, { ...raw, verification: proof })).toHaveProperty("reason");
    }
    expect(entry.verification).toBe("hancom-roundtrip-text-and-every-page-pixel-identical");
  });

  it("only offers the conversion when the published original is that exact source", () => {
    const entry = entryOf(WRITABLE);
    const file = { format: "hwp", bytes: entry.source.bytes, sha256: entry.source.sha256 };
    expect(hwpxDownloadFor(entry, file)).toBe(entry);
    expect(hwpxDownloadFor(entry, { ...file, sha256: "0".repeat(64) })).toBeNull();
    expect(hwpxDownloadFor(entry, { ...file, bytes: 1 })).toBeNull();
    // 원본이 이미 HWPX면 기존 원본 받기로 충분하다.
    expect(hwpxDownloadFor(entry, { ...file, format: "hwpx" })).toBeNull();
    expect(hwpxDownloadFor(undefined, file)).toBeNull();
    expect(hwpxDownloadFor(entry, undefined)).toBeNull();
  });
});
