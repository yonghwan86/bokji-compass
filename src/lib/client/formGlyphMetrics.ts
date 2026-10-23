import data from "../data/formGlyphMetrics.json";

/** One source charPr/language binding. size and the result use HWPUNIT (1/100 pt). */
export interface FormGlyphStyle {
  family: string;
  size: number;
  bold?: boolean;
  italic?: boolean;
  /** Source charPr ratio, spacing and relSz percentages. */
  ratio?: number;
  spacing?: number;
  relSz?: number;
  /** Pair shaping and embedded fonts need their own evidence. */
  kerning?: boolean;
  embedded?: boolean;
}

export type FormGlyphResult =
  | {
      supported: true;
      /** Conservative sum of glyph advances, not a rendered line/ink bounding box. */
      advance: number;
      unit: "HWPUNIT";
      family: string;
      sourceSha256: string;
      collectionIndex: number;
      conservative: true;
      /** Negative spacing never makes this estimate smaller. */
      negativeSpacingIgnored: boolean;
    }
  | {
      supported: false;
      reason: "unknown_font" | "unsupported_style" | "unsupported_character"
        | "unsupported_layout_option" | "invalid_metrics";
      codePoint?: number;
      /** UTF-16 offset; the entered text is not copied into the result. */
      offset?: number;
    };

type Font = (typeof data.fonts)[number];
const normalizeFamily = (family: string) => family.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
const families = new Map<string, Font[]>();
for (const font of data.fonts) {
  for (const alias of font.aliases) {
    const key = normalizeFamily(alias);
    const entries = families.get(key) ?? [];
    if (!entries.includes(font)) entries.push(font);
    families.set(key, entries);
  }
}

/**
 * Uses measured hmtx advances for printable ASCII, complete Hangul syllables,
 * and the explicit per-font source symbols included in the evidence table.
 * Unknown names/styles/code points are unsupported; no guessed fallback font.
 *
 * The caller must choose each run's actual language-specific font/ratio/relSz.
 * Positive spacing reserves the largest of base/scaled em per character,
 * including the final character; negative spacing gives no width discount.
 * This deliberately over-reserves spacing without claiming Hancom shaping.
 * Each character rounds up to a whole HWPUNIT. Cell/paragraph margins, wrapping,
 * line height, fallback on another device and final rendering remain separate.
 */
export function measureFormGlyphAdvance(text: string, style: FormGlyphStyle): FormGlyphResult {
  const ratio = style.ratio ?? 100;
  const relSz = style.relSz ?? 100;
  const spacing = style.spacing ?? 0;
  if (typeof text !== "string" || typeof style.family !== "string"
    || !Number.isFinite(style.size) || style.size <= 0
    || !Number.isFinite(ratio) || ratio <= 0
    || !Number.isFinite(relSz) || relSz <= 0 || !Number.isFinite(spacing)) {
    return { supported: false, reason: "invalid_metrics" };
  }
  if (style.kerning || style.embedded) return { supported: false, reason: "unsupported_layout_option" };
  const candidates = families.get(normalizeFamily(style.family));
  if (!candidates) return { supported: false, reason: "unknown_font" };
  const font = candidates.find(item => item.bold === !!style.bold && item.italic === !!style.italic);
  if (!font) return { supported: false, reason: "unsupported_style" };
  const scaledEm = style.size * ratio * relSz / 10_000;
  const spacingAdvance = Math.max(0, spacing) / 100
    * Math.max(style.size, style.size * relSz / 100, scaledEm);
  let advance = 0;
  let offset = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    let glyph: number | null | undefined;
    if (codePoint >= data.asciiStart && codePoint <= data.asciiEnd) glyph = font.ascii[codePoint - data.asciiStart];
    else if (font.hangulComplete && codePoint >= data.hangulStart && codePoint <= data.hangulEnd) glyph = font.hangulMaxAdvance;
    else glyph = (font.symbols as Readonly<Record<string, number | undefined>>)[character];
    if (glyph === null || glyph === undefined) {
      return { supported: false, reason: "unsupported_character", codePoint, offset };
    }
    // Multiply integers before dividing, avoiding 0.91 * 1100 rounding to 1001.000...1.
    advance += Math.ceil(glyph * style.size * ratio * relSz / (font.unitsPerEm * 10_000) + spacingAdvance);
    offset += character.length;
  }
  if (!Number.isSafeInteger(advance)) return { supported: false, reason: "invalid_metrics" };
  return {
    supported: true, advance, unit: "HWPUNIT", family: font.family,
    sourceSha256: font.sourceSha256, collectionIndex: font.collectionIndex,
    conservative: true, negativeSpacingIgnored: spacing < 0,
  };
}

/** Integration name: advance is returned in HWPUNIT, never CSS pixels or half-em units. */
export const estimateHwpTextWidth = measureFormGlyphAdvance;
