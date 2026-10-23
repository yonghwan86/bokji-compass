import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyWritingScope, baselineFromPublished, compileForm, readPublishedBaselines,
  scopeRegistryIssues, writingBasis, type CatalogForm, type Conversion,
} from "../../scripts/build-paper-writing";
import { detailBucket } from "../../src/lib/data/bucket";
import type { PaperIndexEntry, PaperManifest, PaperWritingScope } from "../../src/lib/data/paperWritingTypes";

const id = "ordin-19969911";
const digest = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const text = readFileSync(`public/forms/writing/v1/manifest/${id}.json`, "utf8");
const actual = JSON.parse(text) as PaperManifest;
const entry = JSON.parse(readFileSync(`public/forms/writing/v1/index/${detailBucket(id)}.json`, "utf8")).forms[id] as PaperIndexEntry;
const conversion = JSON.parse(readFileSync("public/forms/writing/v1/conversions.json", "utf8")).forms[id] as Conversion;
const form = JSON.parse(readFileSync("public/forms/v1/catalog.json", "utf8")).forms[id] as CatalogForm;
const bytes = new Uint8Array(readFileSync(`public${conversion.asset.path}`));
const baseline = baselineFromPublished(id, entry, text);
const raw = compileForm(id, form, conversion, bytes);
const first = "0/0/1/4/0";
const second = "0/0/1/11/0";
const programme = "fixture.exact-programme";
const scope = (): PaperWritingScope => ({ sourceSHA256: conversion.source.sha256,
  assetSHA256: conversion.asset.sha256, programmes: { [programme]: [first] } });
const signed = (manifest: PaperManifest, index: PaperIndexEntry = entry) => {
  const manifestText = JSON.stringify(manifest);
  return { index: { ...index, manifestSha256: digest(manifestText) }, manifestText };
};
const logRoot = resolve("logs/hwpx-live-20261023/codex-baseline-tests");
function diskFixture(index: PaperIndexEntry = entry, manifestText = text) {
  mkdirSync(logRoot, { recursive: true });
  const root = mkdtempSync(join(logRoot, "fixture-"));
  const publicRoot = join(root, "public"), indexDir = join(publicRoot, "forms/writing/v1/index");
  mkdirSync(indexDir, { recursive: true });
  const manifestPath = join(publicRoot, `forms/writing/v1/manifest/${id}.json`);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, manifestText);
  const shardPath = join(indexDir, `${detailBucket(id)}.json`);
  writeFileSync(shardPath, JSON.stringify({ schema: 1, bucket: detailBucket(id), forms: { [id]: index } }));
  return { root, publicRoot, indexDir, manifestPath, shardPath };
}

describe("published writing baseline integrity and fail-closed recompilation", () => {
  it("loads exact published identities and only previously unlocked coordinates", () => {
    expect(baseline.sourceSHA256).toBe(conversion.source.sha256);
    expect(baseline.assetSHA256).toBe(digest(bytes));
    expect(baseline.slotIds).toEqual(Object.values(actual.slots).filter(s => !s.locked).map(s => s.id).sort());
    expect(baseline.slotIds).toContain(first);
    expect(readPublishedBaselines(undefined, undefined, new Set([id])).get(id)).toEqual(baseline);
    expect(digest(readFileSync(`public${conversion.source.path}`))).toBe(conversion.source.sha256);
  });

  it("default compile detects candidates but publishes zero unreviewed inputs", () => {
    expect(raw.detected[first].locked).toBeUndefined();
    expect(raw.detected[second].locked).toBeUndefined();
    expect(raw.entry.slotCount).toBe(0);
    expect(Object.values(raw.manifest.slots).every(s => s.locked)).toBe(true);
    expect(raw.manifest.unsupported.some(x => /이 사업에서 화면 입력을 제공하지 않는 칸/.test(x.reason))).toBe(true);
  });

  it("rejects any changed manifest byte even if JSON meaning is unchanged", () => {
    expect(() => baselineFromPublished(id, entry, text + "\n")).toThrow(/SHA/);
  });

  it.each([`/forms/writing/v1/manifest/other.json`, `/forms/writing/v1/manifest/../${id}.json`,
    `https://example.invalid/${id}.json`])("rejects a mismatched manifest address %s", manifest => {
    expect(() => baselineFromPublished(id, { ...entry, manifest }, text)).toThrow(/주소/);
  });

  it.each(["source", "asset"] as const)("rejects changed %s SHA even with a newly signed manifest", kind => {
    const changed = structuredClone(actual); changed[kind].sha256 = "0".repeat(64);
    const s = signed(changed);
    expect(() => baselineFromPublished(id, s.index, s.manifestText)).toThrow(/신원/);
  });

  it.each(["source", "asset"] as const)("rejects changed %s path/size, not just content hash", kind => {
    for (const field of ["path", "bytes"] as const) {
      const changed = structuredClone(actual);
      if (field === "path") changed[kind].path += ".different";
      else changed[kind].bytes += 1;
      const s = signed(changed);
      expect(() => baselineFromPublished(id, s.index, s.manifestText)).toThrow(/주소|크기/);
    }
  });

  it("rejects changed source format, form ID and index counts", () => {
    const wrongFormat = { ...actual, source: { ...actual.source, format: "pdf" } } as unknown as PaperManifest;
    const s = signed(wrongFormat);
    expect(() => baselineFromPublished(id, s.index, s.manifestText)).toThrow(/주소|크기/);
    const wrongId = signed({ ...actual, formId: "ordin-other" });
    expect(() => baselineFromPublished(id, wrongId.index, wrongId.manifestText)).toThrow(/식별자/);
    expect(() => baselineFromPublished(id, { ...entry, slotCount: entry.slotCount + 1 }, text)).toThrow(/자리 수/);
    expect(() => baselineFromPublished(id, { ...entry, lockedCount: entry.lockedCount + 1 }, text)).toThrow(/자리 수/);
  });

  it("rejects removing or replacing programme scope on either side of the published index", () => {
    const scoped = { ...actual, programmeIds: [programme], programmeSlots: { [programme]: baseline.slotIds } };
    const valid = signed(scoped, { ...entry, programmeIds: [programme] });
    const preserved = baselineFromPublished(id, valid.index, valid.manifestText);
    expect(preserved.programmeIds).toEqual([programme]);
    expect(() => applyWritingScope(id, raw.detected, conversion.source, conversion.asset, undefined, preserved)).toThrow(/Programme-scoped/);
    const removed = signed({ ...scoped, programmeIds: undefined, programmeSlots: undefined }, valid.index);
    expect(() => baselineFromPublished(id, removed.index, removed.manifestText)).toThrow(/사업별/);
    expect(() => baselineFromPublished(id, { ...valid.index, programmeIds: undefined }, valid.manifestText)).toThrow(/사업별/);
    expect(() => baselineFromPublished(id, { ...valid.index, programmeIds: ["fixture.other"] }, valid.manifestText)).toThrow(/사업별/);
  });

  it("reads a private exact shard and refuses missing or altered manifest files", () => {
    const f = diskFixture();
    expect(readPublishedBaselines(f.indexDir, f.publicRoot).get(id)).toEqual(baseline);
    writeFileSync(f.manifestPath, text + " ");
    expect(() => readPublishedBaselines(f.indexDir, f.publicRoot)).toThrow(/SHA/);
    const missing = diskFixture({ ...entry, manifest: "/forms/writing/v1/manifest/missing.json" });
    expect(() => readPublishedBaselines(missing.indexDir, missing.publicRoot)).toThrow(/없습니다/);
  });

  it("validates shard schema and bucket even when the requested ID filter excludes the form", () => {
    const f = diskFixture();
    writeFileSync(f.shardPath, JSON.stringify({ schema: 2, bucket: detailBucket(id), forms: { [id]: entry } }));
    expect(() => readPublishedBaselines(f.indexDir, f.publicRoot, new Set())).toThrow(/샤드/);
    writeFileSync(f.shardPath, JSON.stringify({ schema: 1, bucket: detailBucket(id), forms: { "ordin-wrong-bucket": entry } }));
    expect(detailBucket("ordin-wrong-bucket")).not.toBe(detailBucket(id));
    expect(() => readPublishedBaselines(f.indexDir, f.publicRoot, new Set())).toThrow(/버킷/);
  });

  it("does not follow a path escape as a valid baseline", () => {
    const escaped = { ...entry, manifest: "/../outside.json" };
    const f = diskFixture(escaped);
    writeFileSync(join(f.root, "outside.json"), text);
    expect(() => readPublishedBaselines(f.indexDir, f.publicRoot)).toThrow(/주소/);
  });

  it("does not grow a published allowlist when recompilation detects more real source fields", () => {
    const narrow = { ...baseline, slotIds: [first] };
    const rebuilt = compileForm(id, form, conversion, bytes, undefined, narrow);
    expect(rebuilt.detected[second]).toBeDefined();
    expect(Object.values(rebuilt.manifest.slots).filter(s => !s.locked).map(s => s.id)).toEqual([first]);
    expect(rebuilt.entry.slotCount).toBe(1);
    expect(rebuilt.manifest.slots[second]).toBeUndefined();
    expect(rebuilt.manifest.source).toEqual(conversion.source);
    expect(rebuilt.manifest.asset).toEqual(conversion.asset);
  });

  it("retains programme-specific scope instead of reopening the candidate union", () => {
    const exact = { ...scope(), programmes: { [programme]: [first], "fixture.second": [second] } };
    const rebuilt = compileForm(id, form, conversion, bytes, exact);
    expect(rebuilt.manifest.programmeSlots).toEqual(exact.programmes);
    expect(rebuilt.entry.programmeIds).toEqual(Object.keys(exact.programmes).sort());
    expect(rebuilt.entry.slotCount).toBe(2);
  });

  it("refuses scope attempts to open a locked or nonexistent candidate", () => {
    const consentId = "ordin-19969479";
    const consentForm = JSON.parse(readFileSync("public/forms/v1/catalog.json", "utf8")).forms[consentId] as CatalogForm;
    const consentConversion = JSON.parse(readFileSync("public/forms/writing/v1/conversions.json", "utf8")).forms[consentId] as Conversion;
    const consentBytes = new Uint8Array(readFileSync(`public${consentConversion.asset.path}`));
    const consentRaw = compileForm(consentId, consentForm, consentConversion, consentBytes);
    const locked = Object.values(consentRaw.detected).find(s => s.locked?.kind === "consent")!;
    const open = Object.values(consentRaw.detected).find(s => !s.locked)!;
    expect(locked).toBeDefined();
    expect(open).toBeDefined();
    for (const slotId of [locked.id, "0/999/999/999/0"]) {
      const invalid = { sourceSHA256: consentConversion.source.sha256, assetSHA256: consentConversion.asset.sha256,
        programmes: { [programme]: [slotId] } };
      expect(() => compileForm(consentId, consentForm, consentConversion, consentBytes, invalid)).toThrow(/locked|does not exist/);
    }
    const forgedBaseline = { sourceSHA256: consentConversion.source.sha256, assetSHA256: consentConversion.asset.sha256,
      slotIds: [open.id, locked.id] };
    const kept = applyWritingScope(consentId, consentRaw.detected, consentConversion.source, consentConversion.asset, undefined, forgedBaseline);
    expect(Object.keys(kept.slots)).toEqual([open.id]);
  });

  it.each(["source", "asset"] as const)("drops a stale baseline when %s identity changes", kind => {
    const changed: Conversion = { ...conversion, [kind]: { ...conversion[kind], sha256: "a".repeat(64) } };
    const basis = writingBasis(id, changed, {}, new Map([[id, baseline]]));
    expect(basis).toEqual({ rebound: true });
    expect(() => applyWritingScope(id, raw.detected, changed.source, changed.asset, undefined, baseline)).toThrow(/different source\/asset/);
  });

  it("chooses an exact review explicitly and requires the compiler to reject a falsely rebound review", () => {
    expect(writingBasis(id, conversion, {}, new Map([[id, baseline]]))).toEqual({ baseline, rebound: false });
    expect(writingBasis(id, conversion, { [id]: scope() }, new Map([[id, baseline]]))).toEqual({ scope: scope(), baseline, rebound: false });
    const invalid = { ...scope(), assetSHA256: "b".repeat(64) };
    const basis = writingBasis(id, conversion, { [id]: invalid }, new Map());
    expect(() => compileForm(id, form, conversion, bytes, basis.scope, basis.baseline)).toThrow(/different source\/asset/);
  });

  it("accepts exact programme linkage and rejects registry identity or programme drift", () => {
    const links = new Map([[id, new Set([programme])]]);
    expect(scopeRegistryIssues({ [id]: scope() }, { [id]: conversion }, links)).toEqual([]);
    const bad = [
      { ...scope(), sourceSHA256: "0".repeat(64) },
      { ...scope(), assetSHA256: "0".repeat(64) },
      { ...scope(), programmes: {} },
      { ...scope(), programmes: { "fixture.other": [first] } },
      { ...scope(), programmes: { [programme]: [] } },
      { ...scope(), programmes: { [programme]: [""] } },
    ];
    for (const candidate of bad) expect(scopeRegistryIssues({ [id]: candidate }, { [id]: conversion }, links).length).toBeGreaterThan(0);
    expect(scopeRegistryIssues({ [id]: scope() }, {}, links)).toHaveLength(1);
    expect(scopeRegistryIssues({ [id]: scope() }, { [id]: conversion }, new Map())).toHaveLength(1);
  });
});
