/**
 * 공개 세부 자료 256조각을 읽어 출처 안내 JSON을 만든다.
 * 사용: npx tsx scripts/build-data-provenance.ts
 * 번들·파이프라인 원본은 바꾸지 않는다. 서비스 키는 쓰지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOURCE_ORDER,
  assembleProvenance,
  assertPublicProvenance,
  createSourceCensus,
  type DataProvenance,
  type ProvenanceContext,
} from "../src/lib/data/dataProvenance";
import type { SourceId } from "../src/lib/data/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/lib/data/dataProvenance.json");

function numberField(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`Expected a count: ${label}`);
  return value;
}

function textField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Expected text: ${label}`);
  return value;
}

function isSourceId(value: string): value is SourceId {
  return SOURCE_ORDER.some((id) => id === value);
}

export function buildDataProvenance(root = ROOT): DataProvenance {
  const detailDir = path.join(root, "public/bundles/v1/details");
  const files = fs.readdirSync(detailDir).filter((name) => name.endsWith(".json")).sort();
  const census = createSourceCensus(files.length);
  for (const file of files) {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(detailDir, file), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Detail shard is not an object: ${file}`);
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Detail record is not an object: ${key}`);
      const record = value as {
        id?: unknown;
        name?: unknown;
        region?: { label?: unknown };
        url?: unknown;
        sources?: { source?: string; id?: string; url?: unknown; fetchedAt?: unknown; updatedAt?: unknown }[];
      };
      if (record.id != null && record.id !== key) throw new Error(`Detail key mismatch: ${key}`);
      const region = record.region && typeof record.region.label === "string" ? record.region.label : undefined;
      census.add({
        id: key,
        name: typeof record.name === "string" ? record.name : undefined,
        regionLabel: region,
        url: record.url,
        sources: record.sources,
      });
    }
  }

  const meta = JSON.parse(fs.readFileSync(path.join(root, "public/bundles/v1/meta.json"), "utf8")) as {
    generatedAt?: unknown;
    counts?: { uniquePrograms?: unknown; placements?: unknown; localOps?: unknown; raw?: Record<string, unknown> };
  };
  const coverage = JSON.parse(fs.readFileSync(path.join(root, "public/forms/v1/coverage.json"), "utf8")) as {
    generatedAt?: unknown;
    totalPrograms?: unknown;
    publishedForms?: unknown;
    counts?: { available?: unknown };
    investigationSummary?: { checkedAt?: unknown };
    portalScan?: { checkedAt?: unknown };
  };
  const raw = meta.counts?.raw ?? {};
  const pipelineInputs = SOURCE_ORDER.filter((id) => raw[id] != null).map((id) => ({ id, records: numberField(raw[id], `raw ${id}`) }));
  for (const key of Object.keys(raw)) {
    if (!isSourceId(key)) throw new Error(`Unknown pipeline input: ${key}`);
  }
  const forms: ProvenanceContext["forms"] = {
    downloadOriginals: numberField(coverage.publishedForms, "publishedForms"),
    linkedPrograms: numberField(coverage.counts?.available, "forms available"),
    censusPrograms: numberField(coverage.totalPrograms, "forms totalPrograms"),
    formBundleGeneratedAt: textField(coverage.generatedAt, "forms generatedAt"),
  };
  if (typeof coverage.investigationSummary?.checkedAt === "string" && coverage.investigationSummary.checkedAt) {
    forms.lawReviewCheckedAt = coverage.investigationSummary.checkedAt;
  }
  if (typeof coverage.portalScan?.checkedAt === "string" && coverage.portalScan.checkedAt) {
    forms.portalListCheckedAt = coverage.portalScan.checkedAt;
  }
  const localOps = meta.counts?.localOps;
  const doc = assembleProvenance(census.finish(), {
    bundleGeneratedAt: textField(meta.generatedAt, "bundle generatedAt"),
    metaUniquePrograms: numberField(meta.counts?.uniquePrograms, "uniquePrograms"),
    metaPlacements: numberField(meta.counts?.placements, "placements"),
    forms,
    pipelineInputs,
    ...(localOps == null ? {} : { regionalOperations: numberField(localOps, "localOps") }),
  });
  assertPublicProvenance(doc);
  return doc;
}

function main(): void {
  const doc = buildDataProvenance(ROOT);
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  assertPublicProvenance(JSON.parse(text) as DataProvenance);
  fs.writeFileSync(OUT, text);
  console.log(`data provenance ${doc.basis.programRecords} detail records, ${doc.basis.shardFiles} shards -> ${path.relative(ROOT, OUT)}`);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
