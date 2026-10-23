import { estimateHwpTextWidth, type FormGlyphStyle } from "./formGlyphMetrics";

/** 원본 charPr의 언어별 글꼴 결속. 확인하지 못한 글꼴은 대체하지 않는다. */
export interface PaperGlyphStyles {
  hangul: FormGlyphStyle;
  latin: FormGlyphStyle;
  symbol: FormGlyphStyle;
}

export interface PaperLineMetrics {
  /** 여백과 들여쓰기를 뺀 한 줄의 폭, HWPUNIT. */
  available: number;
  runs: { from: number; to: number; styles: PaperGlyphStyles }[];
}

/** 글리프 advance의 보수적 합. 실제 조판·대체 글꼴의 결과를 보장하는 값은 아니다. */
export function measurePaperText(text: string, styles: PaperGlyphStyles): number | null {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const style = code >= 0x20 && code <= 0x7e ? styles.latin
      : code >= 0xac00 && code <= 0xd7a3 ? styles.hangul : styles.symbol;
    const measured = estimateHwpTextWidth(char, style);
    if (!measured.supported) return null;
    width += measured.advance;
  }
  return width;
}

export function measurePaperSourceRange(text: string, metrics: PaperLineMetrics, from = 0, to = text.length): number | null {
  let width = 0, covered = from;
  for (const run of metrics.runs) {
    const start = Math.max(from, run.from), end = Math.min(to, run.to);
    if (end <= start) continue;
    if (start !== covered) return null;
    const measured = measurePaperText(text.slice(start, end), run.styles);
    if (measured === null) return null;
    width += measured; covered = end;
  }
  return covered === to ? width : null;
}
