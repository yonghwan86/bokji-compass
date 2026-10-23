import { describe, expect, it } from "vitest";
import data from "@/lib/data/formGlyphMetrics.json";
import { estimateHwpTextWidth, measureFormGlyphAdvance, type FormGlyphStyle } from "@/lib/client/formGlyphMetrics";

const source: FormGlyphStyle = { family: "함초롬바탕", size: 1000 };
function width(text: string, style: FormGlyphStyle = source) {
  const result = measureFormGlyphAdvance(text, style);
  expect(result.supported).toBe(true);
  if (!result.supported) throw new Error(result.reason);
  return result.advance;
}

describe("source-bound glyph advances", () => {
  it("uses actual HCR Batang W/M, space and Hangul advances", () => {
    expect(width("W")).toBe(910);
    expect(width("M")).toBe(839);
    expect(width(" ")).toBe(300);
    expect(width("가한글힣")).toBe(4 * 970);
    expect(width("W M가")).toBe(910 + 300 + 839 + 970);
    expect(estimateHwpTextWidth("W", source)).toMatchObject({ supported: true, advance: 910, unit: "HWPUNIT" });
  });

  it("does not accept the old half-em estimate for Goyang proxy-name W25", () => {
    const measured = width("W".repeat(25), { ...source, size: 1100 });
    expect(measured).toBe(25025);
    expect(measured).toBeGreaterThan(14562 - 141 - 141);
    expect(width("M".repeat(25), { ...source, size: 1100 })).toBe(923 * 25);
  });

  it("uses ratio and relative size, and rounds each glyph upward", () => {
    expect(width("W", { ...source, ratio: 80, relSz: 50 })).toBe(364);
    expect(width("M", { ...source, size: 1100 })).toBe(923);
    expect(width("MM", { ...source, size: 1100 })).toBe(1846);
  });

  it("reserves positive spacing and never discounts negative spacing", () => {
    expect(width("WW", { ...source, spacing: 10 })).toBe(2020);
    expect(width("W", { ...source, ratio: 80, relSz: 50, spacing: 10 })).toBe(464);
    expect(width("W", { ...source, spacing: -20 })).toBe(910);
    expect(measureFormGlyphAdvance("W", { ...source, spacing: -20 })).toMatchObject({ negativeSpacingIgnored: true });
  });

  it("preserves spaces and supports only proven family aliases/styles", () => {
    expect(width(" W ")).toBe(1510);
    expect(width("W", { family: "HCR Batang", size: 1000 })).toBe(910);
    expect(width("W", { ...source, bold: true })).toBe(910);
    expect(measureFormGlyphAdvance("가", { family: "돋움", size: 1000, bold: true }))
      .toEqual({ supported: false, reason: "unsupported_style" });
    expect(measureFormGlyphAdvance("가", { family: "없는글꼴", size: 1000 }))
      .toEqual({ supported: false, reason: "unknown_font" });
  });

  it.each(["é", "ㄱ", "\n", "\t", "😀", "\ud800"])("does not invent an advance for %j", text => {
    expect(measureFormGlyphAdvance(text, source)).toMatchObject({ supported: false, reason: "unsupported_character", offset: 0 });
  });

  it("reports the unsupported character position without returning entered text", () => {
    expect(measureFormGlyphAdvance("가é", source))
      .toEqual({ supported: false, reason: "unsupported_character", codePoint: 0xe9, offset: 1 });
  });

  it("measures the exact checkbox symbols instead of assuming spaces and ticks have equal width", () => {
    expect(width("√")).toBe(970);
    expect(width("□")).toBe(970);
    expect(width("■")).toBe(970);
    expect(width("☐")).toBe(970);
    expect(width("[√]") - width("[  ]")).toBe(370);
    expect(width("·ㆍ…※")).toBe(320 + 970 + 960 + 770);
  });

  it("keeps absent per-font symbols unsupported instead of using another font's metrics", () => {
    expect(measureFormGlyphAdvance("☐", { family: "바탕", size: 1000 }))
      .toEqual({ supported: false, reason: "unsupported_character", codePoint: 0x2610, offset: 0 });
    expect(measureFormGlyphAdvance("—", { family: "HY신명조", size: 1000 }))
      .toEqual({ supported: false, reason: "unsupported_character", codePoint: 0x2014, offset: 0 });
  });

  it("rejects shaping/embedded font assumptions and invalid sizes", () => {
    for (const extra of [{ kerning: true }, { embedded: true }]) {
      expect(measureFormGlyphAdvance("가", { ...source, ...extra })).toEqual({ supported: false, reason: "unsupported_layout_option" });
    }
    for (const size of [0, -1, NaN, Infinity]) {
      expect(measureFormGlyphAdvance("가", { ...source, size })).toEqual({ supported: false, reason: "invalid_metrics" });
    }
    expect(width("")).toBe(0);
  });

  it("keeps provenance without file paths, usernames or font binaries in the small table", () => {
    expect(data.fonts.length).toBe(15);
    expect(JSON.stringify(data).length).toBeLessThan(20000);
    for (const font of data.fonts) {
      expect(font.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(font.collectionIndex).toBeGreaterThanOrEqual(0);
      expect(font.ascii).toHaveLength(95);
    }
    expect(JSON.stringify(data)).not.toMatch(/C:|Users|Windows|\.tt[fc]|localPath|filePath/i);
    expect(measureFormGlyphAdvance("W", source)).toMatchObject({
      sourceSha256: "0dbeb7b129fcec63f8d6b7f1d3b5bb991c1d599e725286518ccc598de643f014",
    });
  });
});
