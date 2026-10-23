import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyWritingScope, isPlaceholderExample, readProgrammeLinks, scopeRegistryIssues } from "../../scripts/build-paper-writing";
import { scopeManifestToProgram, validPaperManifest } from "@/lib/client/paperWriting";
import scopes from "@/lib/data/paperWritingScopes.json";
import type { PaperManifest, PaperSlot } from "@/lib/data/paperWritingTypes";

const PUBLIC = path.join(process.cwd(), "public");
// 기존 공개 산출물은 읽기만 한다.
const REAL = JSON.parse(readFileSync(path.join(PUBLIC, "forms/writing/v1/manifest/ordin-19969911.json"), "utf-8")) as PaperManifest;
const SOURCE = { sha256: REAL.source.sha256 };
const ASSET = { sha256: REAL.asset.sha256 };
const openIds = Object.values(REAL.slots).filter(slot => !slot.locked).map(slot => slot.id);
const lockedId = Object.values(REAL.slots).find(slot => slot.locked)?.id;
const slotsOf = (manifest: PaperManifest) => manifest.slots;

describe("per-programme writing scope", () => {
  it("binds each reviewed scope to the exact conversion and a published programme connection", () => {
    expect(scopes.schema).toBe(1);
    const conversions = JSON.parse(readFileSync(path.join(PUBLIC, "forms/writing/v1/conversions.json"), "utf8"));
    expect(scopeRegistryIssues(scopes.forms, conversions.forms, readProgrammeLinks())).toEqual([]);
  });

  it("opens nothing when there is neither a review table nor an existing manifest", () => {
    const scoped = applyWritingScope("ordin-19969911", slotsOf(REAL), SOURCE, ASSET);
    expect(Object.keys(scoped.slots)).toEqual([]);
    expect(scoped.programmeIds).toBeUndefined();
  });

  it("keeps the already verified slot set when only the fonts changed", () => {
    const baseline = { sourceSHA256: SOURCE.sha256, assetSHA256: ASSET.sha256, slotIds: openIds.slice(0, 3) };
    const grown = { ...slotsOf(REAL), "9/9/9/9/9": { ...Object.values(REAL.slots)[0], id: "9/9/9/9/9" } as PaperSlot };
    const scoped = applyWritingScope("ordin-19969911", grown, SOURCE, ASSET, undefined, baseline);
    // 새 글꼴로 더 읽히게 된 자리는 검토표 없이 늘어나지 않는다.
    expect(Object.keys(scoped.slots).sort()).toEqual(baseline.slotIds.sort());
    expect(Object.keys(scoped.slots)).not.toContain("9/9/9/9/9");
  });

  it("fails when a baseline or scope is bound to other bytes", () => {
    const wrong = { sourceSHA256: "0".repeat(64), assetSHA256: ASSET.sha256, slotIds: openIds };
    expect(() => applyWritingScope("ordin-19969911", slotsOf(REAL), SOURCE, ASSET, undefined, wrong)).toThrow();
    const scope = { sourceSHA256: SOURCE.sha256, assetSHA256: "0".repeat(64), programmes: { "g1.x": openIds.slice(0, 1) } };
    expect(() => applyWritingScope("ordin-19969911", slotsOf(REAL), SOURCE, ASSET, scope)).toThrow();
  });

  it("opens only the slots each programme was reviewed for", () => {
    const scope = { sourceSHA256: SOURCE.sha256, assetSHA256: ASSET.sha256,
      programmes: { "g1.a": openIds.slice(0, 2), "g1.b": openIds.slice(1, 3) } };
    const scoped = applyWritingScope("ordin-19969911", slotsOf(REAL), SOURCE, ASSET, scope);
    expect(scoped.programmeIds).toEqual(["g1.a", "g1.b"]);
    expect(Object.keys(scoped.slots).sort()).toEqual([...new Set(openIds.slice(0, 3))].sort());
    expect(scoped.programmeSlots!["g1.a"]).toEqual(openIds.slice(0, 2).sort());
  });

  it("rejects a review table naming a missing, locked or empty slot set", () => {
    const base = { sourceSHA256: SOURCE.sha256, assetSHA256: ASSET.sha256 };
    expect(() => applyWritingScope("x", slotsOf(REAL), SOURCE, ASSET, { ...base, programmes: {} })).toThrow();
    expect(() => applyWritingScope("x", slotsOf(REAL), SOURCE, ASSET, { ...base, programmes: { "g1.a": [] } })).toThrow();
    expect(() => applyWritingScope("x", slotsOf(REAL), SOURCE, ASSET, { ...base, programmes: { "g1.a": ["nope"] } })).toThrow();
    if (lockedId)
      expect(() => applyWritingScope("x", slotsOf(REAL), SOURCE, ASSET, { ...base, programmes: { "g1.a": [lockedId] } })).toThrow();
  });

  it("lets each programme see only its own cells at runtime", () => {
    const manifest: PaperManifest = { ...REAL, programmeIds: ["g1.a", "g1.b"],
      programmeSlots: { "g1.a": openIds.slice(0, 2), "g1.b": openIds.slice(2, 4) } };
    const a = scopeManifestToProgram(manifest, "g1.a")!;
    expect(Object.keys(a.slots).filter(id => !a.slots[id].locked).sort()).toEqual(openIds.slice(0, 2).sort());
    expect(Object.keys(a.slots)).not.toContain(openIds[2]);
    // 연결되지 않은 사업이나 사업 없이 들어온 주소는 받지 않는다.
    expect(scopeManifestToProgram(manifest, "g1.c")).toBeNull();
    expect(scopeManifestToProgram(manifest, null)).toBeNull();
    // 검토표가 가리킨 자리가 실제로 없으면 그 사업 화면을 열지 않는다.
    expect(scopeManifestToProgram({ ...manifest, programmeSlots: { "g1.a": ["nope"], "g1.b": openIds.slice(2, 4) } }, "g1.a")).toBeNull();
  });

  it("leaves forms without a review table working as before", () => {
    expect(scopeManifestToProgram(REAL, "g1.a")).toBe(REAL);
    expect(scopeManifestToProgram(REAL, null)).toBe(REAL);
  });

  it("keeps the published manifest valid and rejects a broken programme map", () => {
    expect(validPaperManifest(REAL, REAL.formId)).toBeTruthy();
    const scoped = { ...REAL, programmeIds: ["g1.a"], programmeSlots: { "g1.a": openIds.slice(0, 1) } };
    expect(validPaperManifest(scoped, REAL.formId)).toBeTruthy();
    for (const broken of [{ programmeIds: ["g1.a"] }, { programmeIds: [], programmeSlots: {} },
      { programmeIds: ["g1.a"], programmeSlots: { "g1.a": [] } },
      { programmeIds: ["g1.a"], programmeSlots: { "g1.a": ["nope"] } },
      { programmeIds: ["g1.a"], programmeSlots: { "g1.a": openIds.slice(0, 1), "g1.b": openIds.slice(1, 2) } }])
      expect(validPaperManifest({ ...REAL, ...broken }, REAL.formId)).toBeNull();
  });

  it("does not treat a printed example amount as a field name", () => {
    for (const text of ["00억원", "０0억원".replace("０", "0"), "×××억원", "XX원", "( 00억원 )"])
      expect(isPlaceholderExample(text)).toBe(true);
    // 실제 금액란이나 보통 문구까지 막지 않는다.
    for (const text of ["금액", "지원금액", "1,000원", "100만원", "신청금액(원)", "억원 단위로 적어 주세요", ""])
      expect(isPlaceholderExample(text)).toBe(false);
  });
});
