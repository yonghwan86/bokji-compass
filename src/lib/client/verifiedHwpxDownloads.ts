import type { HwpxDownloadEntry, HwpxDownloadShard } from "../data/paperWritingTypes";
import { detailBucket } from "../data/bucket";
import { CONVERTED, FORM_ID, convertedPath, getJson, hex64, positive } from "./paperWriting";

/** 이 검증만 받아들인다. 임의의 설명 문구를 증거로 삼지 않는다. */
export const HWPX_VERIFICATION = "hancom-roundtrip-text-and-every-page-pixel-identical";
const sourcePath = (formId: string, sourceSha: string) => `/forms/files/${formId}-${sourceSha.slice(0, 12)}.hwp`;

/**
 * 검증된 변환본을 그대로 받게 해 주는 색인. 작성 버튼용 색인과 달리 화면 입력을 지원하지
 * 않는 변환본까지 모두 담는다. 한 사업 화면에서는 연결된 서식이 속한 샤드만 받는다.
 */
export function loadHwpxDownloadShard(bucket: string): Promise<HwpxDownloadShard | null> {
  if (!/^[0-9a-f]{2}$/.test(bucket)) return Promise.resolve(null);
  return getJson<HwpxDownloadShard>(`/forms/writing/v1/downloads/${bucket}.json`);
}

/** 한 항목이 그 서식의 것이고 원본·변환본 주소가 해시와 정확히 맞는지. */
export function validHwpxDownload(entry: unknown, formId: string): HwpxDownloadEntry | null {
  if (!FORM_ID.test(formId) || !entry || typeof entry !== "object") return null;
  const row = entry as HwpxDownloadEntry;
  if (row.source?.format !== "hwp" || !hex64(row.source.sha256) || !positive(row.source.bytes)) return null;
  // 원본 주소도 그 서식·그 해시의 것이어야 한다.
  if (row.source.path !== sourcePath(formId, row.source.sha256)) return null;
  if (!row.asset || !hex64(row.asset.sha256) || !positive(row.asset.bytes) || !CONVERTED.test(row.asset.path)) return null;
  // 주소가 곧 신원이다. 다른 원본이나 다른 변환본을 가리키면 받지 않는다.
  if (row.asset.path !== convertedPath(formId, row.source.sha256, row.asset.sha256)) return null;
  if (!positive(row.pageCount) || row.metadataSanitized !== true) return null;
  if (row.verification !== HWPX_VERIFICATION) return null;
  if (typeof row.checkedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.checkedAt)) return null;
  return row;
}

/**
 * 그 사업에 연결된 서식들의 변환본 신원. 쓰이는 샤드만 받고, 읽지 못하거나 어긋난 서식은
 * 빠진다 — 그 자리에는 내려받기 버튼이 나오지 않는다.
 */
export async function loadHwpxDownloads(formIds: string[]): Promise<Record<string, HwpxDownloadEntry>> {
  const wanted = formIds.filter(formId => FORM_ID.test(formId));
  const buckets = [...new Set(wanted.map(detailBucket))];
  const shards = await Promise.all(buckets.map(loadHwpxDownloadShard));
  const out: Record<string, HwpxDownloadEntry> = {};
  for (const shard of shards) {
    if (!shard || !/^[0-9a-f]{2}$/.test(shard.bucket)) continue;
    for (const formId of wanted) {
      if (detailBucket(formId) !== shard.bucket) continue;
      const row = validHwpxDownload(shard.forms?.[formId], formId);
      if (row) out[formId] = row;
    }
  }
  return out;
}

/**
 * 화면에 내려받기 버튼을 낼 수 있는지. 공개된 원본 파일이 이 변환의 바로 그 원본일 때만이다.
 * 원본이 이미 HWPX면 기존 원본 받기로 충분하므로 따로 내주지 않는다.
 */
export function hwpxDownloadFor(entry: HwpxDownloadEntry | undefined,
    file: { format?: string; bytes: number; sha256: string } | undefined): HwpxDownloadEntry | null {
  if (!entry || !file) return null;
  if ((file.format ?? "hwp") !== "hwp") return null;
  return file.sha256 === entry.source.sha256 && file.bytes === entry.source.bytes ? entry : null;
}
