/**
 * HWPX 본문(section0.xml)을 바이트 위치 기준으로 훑어보고, 정해 둔 칸의 글자만 바꾼다.
 *
 * 원본 XML을 다시 만들어 내지 않는다. 바꾸기로 한 글자 구간만 잘라 끼우므로
 * 네임스페이스·속성 순서·스타일·표 구조·문단 수는 원본 바이트 그대로 남는다.
 * 브라우저와 테스트 양쪽에서 같은 코드를 쓰려고 DOM API에 기대지 않는다.
 */

/** `<hp:t>` 안쪽 글자 한 토막 (XML 원본에서의 위치와, 실체 참조를 푼 글자). */
export interface TextSegment {
  /** 실제 글자 토막이 속한 런의 글자 모양. 혼합 글꼴의 입력 폭 검증에 쓴다. */
  charPrIDRef: number;
  /** `<hp:t>` 여는 태그 바로 뒤 */
  start: number;
  /** `</hp:t>` 여는 꺾쇠 자리 */
  end: number;
  text: string;
  /** `<hp:t/>`처럼 빈 태그면, 글자를 넣을 때 닫는 태그까지 다시 써야 한다. */
  selfClosingAt: number | null;
}

export interface ParagraphIndex {
  segments: TextSegment[];
  /** 문단 전체 글자 (토막을 이어 붙인 것) */
  text: string;
  /** 글자가 하나도 없는 문단에 글자를 넣을 자리 */
  emptyRun: { contentStart: number; selfClosingAt: number | null } | null;
  /** 이 문단의 문단 모양 — header.xml의 paraPr id. 칸 너비를 잴 때 쓴다. */
  paraPrIDRef: number;
  /** 첫 런의 글자 모양 — header.xml의 charPr id. */
  charPrIDRef: number;
  /** 줄바꿈·탭·그림·필드 등 단순 한 줄 글자 폭으로 검증할 수 없는 내용. */
  hasNonTextContent: boolean;
}

/** HWPUNIT 네 변 여백 */
export interface BoxMargin { left: number; right: number; top: number; bottom: number }

export interface CellIndex {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  paragraphs: ParagraphIndex[];
  /** `<hp:cellSz>` — 없으면 null */
  size: { width: number; height: number } | null;
  /** `<hp:cellMargin>` — 없으면 표의 `<hp:inMargin>`을 쓴다 */
  margin: BoxMargin | null;
  /** hasMargin이 참일 때만 셀 전용 여백을 쓰고, 아니면 표의 기본 여백을 쓴다. */
  hasOwnMargin: boolean;
}

/**
 * 그 표가 원문에서 어디에 놓여 있는지.
 * HWPX의 표는 언제나 어떤 문단 안에 들어 있다 — 섹션 본문 문단이거나, 다른 표의 칸 안 문단이다.
 * 원문 배치를 그대로 보여 주려면 어느 문단 뒤에 오는지를 알아야 한다.
 */
export type TableHost =
  | { kind: "body"; p: number }
  | { kind: "cell"; table: number; row: number; col: number; p: number };

export interface TableIndex {
  /** `<hp:tr>` 차례대로, 그 줄에 적힌 칸들 */
  rows: CellIndex[][];
  /** `<hp:inMargin>` — 칸에 여백이 적혀 있지 않을 때의 기본값 */
  inMargin: BoxMargin | null;
  /** 이 표를 담고 있는 문단. 글상자처럼 담은 문단을 찾지 못하면 null */
  host: TableHost | null;
}

export interface SectionIndex {
  tables: TableIndex[];
  /** 표 밖 본문 문단 (`<hs:sec>`의 바로 아래 `<hp:p>`) — 원문 순서대로 */
  body: ParagraphIndex[];
  /** 전체 `<hp:p>` 수 (문단 수가 그대로인지 확인할 때 쓴다) */
  paragraphCount: number;
  /** 전체 `<hp:tbl>` 수 */
  tableCount: number;
}

export class HwpxMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HwpxMismatchError";
  }
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML 실체 참조를 푼다. 서식 본문에는 수치 참조도 드물게 쓰여 함께 처리한다. */
export function decodeXmlText(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITY[name] ?? whole;
  });
}

/** 입력 글자를 XML 본문에 넣을 수 있게 바꾼다. 넣을 수 없는 글자는 받지 않는다. */
export function escapeXmlText(value: string): string {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 && char !== "\t") throw new HwpxMismatchError("문서에 넣을 수 없는 문자가 있습니다.");
    if (code >= 0xd800 && code <= 0xdfff) throw new HwpxMismatchError("문서에 넣을 수 없는 문자가 있습니다.");
  }
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface StackEntry {
  name: string;
  /** 여는 태그 바로 뒤 */
  contentStart: number;
  node?: unknown;
}

const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR.exec(tag))) out[match[1]] = match[2];
  return out;
}

const margin = (tag: string): BoxMargin => {
  const attrs = attributes(tag);
  return { left: Number(attrs.left) || 0, right: Number(attrs.right) || 0, top: Number(attrs.top) || 0, bottom: Number(attrs.bottom) || 0 };
};

/**
 * section0.xml을 한 번 훑어 표·칸·문단·글자 토막의 위치를 모은다.
 * 표 안의 표가 있어도 안쪽 칸의 문단이 바깥 칸에 섞이지 않도록 부모 관계로 가른다.
 */
export function indexSection(xml: string): SectionIndex {
  const tables: TableIndex[] = [];
  const body: ParagraphIndex[] = [];
  const stack: StackEntry[] = [];
  const deferredCellHosts: { host: Extract<TableHost, { kind: "cell" }>; cell: CellIndex }[] = [];
  let paragraphCount = 0;
  let cursor = 0;

  const parentOf = (name: string): StackEntry | undefined => {
    const top = stack[stack.length - 1];
    return top && top.name === name ? top : undefined;
  };

  /** 지금 열려 있는 가장 가까운 문단이 어디에 있는지 — 표를 그 문단 뒤에 놓으려고 쓴다. */
  const hostOfOpenParagraph = (): TableHost | null => {
    for (let level = stack.length - 1; level >= 0; level -= 1) {
      if (stack[level].name !== "hp:p") continue;
      const cellEntry = stack[level - 2];
      if (cellEntry?.name === "hp:tc" && stack[level - 1]?.name === "hp:subList") {
        const cell = cellEntry.node as CellIndex | undefined;
        const table = stack.slice(0, level - 2).reverse().find(entry => entry.name === "hp:tbl")?.node as TableIndex | undefined;
        if (!cell || !table) return null;
        const host: Extract<TableHost, { kind: "cell" }> = { kind: "cell", table: tables.indexOf(table), row: cell.row, col: cell.col, p: cell.paragraphs.length - 1 };
        // cellAddr can follow subList; a nested table is read before the
        // containing cell's actual address is known.
        deferredCellHosts.push({ host, cell });
        return host;
      }
      if (stack[level - 1]?.name === "hs:sec") return { kind: "body", p: body.length - 1 };
      return null;
    }
    return null;
  };

  while (cursor < xml.length) {
    const open = xml.indexOf("<", cursor);
    if (open < 0) break;
    if (xml.startsWith("<!--", open)) {
      cursor = xml.indexOf("-->", open) + 3;
      continue;
    }
    if (xml.startsWith("<?", open)) {
      cursor = xml.indexOf("?>", open) + 2;
      continue;
    }
    const close = xml.indexOf(">", open);
    if (close < 0) break;
    const tag = xml.slice(open, close + 1);
    cursor = close + 1;

    if (tag[1] === "/") {
      const name = tag.slice(2, -1).trim();
      while (stack.length && stack[stack.length - 1].name !== name) stack.pop();
      stack.pop();
      continue;
    }

    const selfClosing = tag.endsWith("/>");
    const nameEnd = tag.search(/[\s/>]/);
    const name = tag.slice(1, nameEnd < 0 ? tag.length - 1 : nameEnd);
    let node: unknown;

    if (/^hp:(?:tbl|pic|rect|ellipse|arc|polygon|curve|line|connectLine|ole|equation|container|video|chart|textart|ctrl|fieldBegin|fieldEnd|tab|lineBreak|compose|dutmal)$/.test(name)) {
      const paragraph = [...stack].reverse().find(entry => entry.name === "hp:p")?.node as ParagraphIndex | undefined;
      if (paragraph) paragraph.hasNonTextContent = true;
    }

    if (name === "hp:tbl") {
      const host = hostOfOpenParagraph();
      node = { rows: [], inMargin: null, host } as TableIndex;
      tables.push(node as TableIndex);
    } else if (name === "hp:inMargin") {
      const table = parentOf("hp:tbl")?.node as TableIndex | undefined;
      if (table) table.inMargin = margin(tag);
    } else if (name === "hp:tr") {
      const table = parentOf("hp:tbl")?.node as TableIndex | undefined;
      if (table) {
        node = [] as CellIndex[];
        table.rows.push(node as CellIndex[]);
      }
    } else if (name === "hp:tc") {
      const row = parentOf("hp:tr")?.node as CellIndex[] | undefined;
      if (row) {
        node = { row: -1, col: -1, rowSpan: 1, colSpan: 1, paragraphs: [], size: null, margin: null,
          hasOwnMargin: /^(?:1|true)$/i.test(attributes(tag).hasMargin ?? "0") } as CellIndex;
        row.push(node as CellIndex);
      }
    } else if (name === "hp:cellAddr" || name === "hp:cellSpan" || name === "hp:cellSz" || name === "hp:cellMargin") {
      const cell = parentOf("hp:tc")?.node as CellIndex | undefined;
      if (cell) {
        const attrs = attributes(tag);
        if (name === "hp:cellAddr") {
          cell.row = Number(attrs.rowAddr);
          cell.col = Number(attrs.colAddr);
        } else if (name === "hp:cellSpan") {
          cell.rowSpan = Number(attrs.rowSpan) || 1;
          cell.colSpan = Number(attrs.colSpan) || 1;
        } else if (name === "hp:cellSz") {
          cell.size = { width: Number(attrs.width) || 0, height: Number(attrs.height) || 0 };
        } else {
          if (cell.hasOwnMargin) cell.margin = margin(tag);
        }
      }
    } else if (name === "hp:p") {
      paragraphCount += 1;
      const subList = parentOf("hp:subList");
      const cell = subList && stack[stack.length - 2]?.name === "hp:tc"
        ? (stack[stack.length - 2].node as CellIndex | undefined)
        : undefined;
      // 표 안의 칸, 아니면 섹션 바로 아래의 본문 문단. 글상자 같은 다른 자리는 담지 않는다.
      const target = cell ? cell.paragraphs : parentOf("hs:sec") ? body : null;
      if (target) {
        node = { segments: [], text: "", emptyRun: null, paraPrIDRef: Number(attributes(tag).paraPrIDRef) || 0, charPrIDRef: 0, hasNonTextContent: false } as ParagraphIndex;
        target.push(node as ParagraphIndex);
      }
    } else if (name === "hp:run") {
      const paragraph = parentOf("hp:p")?.node as ParagraphIndex | undefined;
      node = { charPrIDRef: Number(attributes(tag).charPrIDRef) || 0 };
      if (paragraph && !paragraph.emptyRun) {
        paragraph.emptyRun = { contentStart: close + 1, selfClosingAt: selfClosing ? close - 1 : null };
        paragraph.charPrIDRef = Number(attributes(tag).charPrIDRef) || 0;
      }
    } else if (name === "hp:t") {
      const paragraph = stack[stack.length - 2]?.name === "hp:p" && parentOf("hp:run")
        ? (stack[stack.length - 2].node as ParagraphIndex | undefined)
        : undefined;
      if (paragraph) {
        const charPrIDRef = (parentOf("hp:run")?.node as { charPrIDRef?: number } | undefined)?.charPrIDRef ?? paragraph.charPrIDRef;
        if (selfClosing) {
          paragraph.segments.push({ start: close, end: close, text: "", selfClosingAt: close - 1, charPrIDRef });
        } else {
          const end = xml.indexOf("</hp:t>", close);
          if (end < 0) throw new HwpxMismatchError("본문 XML을 읽지 못했습니다.");
          // `<hp:t>` 안에는 줄바꿈(`<hp:lineBreak/>`)·탭 같은 요소가 섞여 있을 수 있다.
          // 그 요소는 건드리지 않고, 사이사이의 글자만 토막으로 잡는다.
          let found = false;
          let pos = close + 1;
          while (pos < end) {
            const mark = xml.indexOf("<", pos);
            const stop = mark < 0 || mark > end ? end : mark;
            if (stop > pos) {
              paragraph.segments.push({ start: pos, end: stop, text: decodeXmlText(xml.slice(pos, stop)), selfClosingAt: null, charPrIDRef });
              found = true;
            }
            if (stop >= end) break;
            const inner = xml.indexOf(">", stop);
            if (inner < 0 || inner > end) throw new HwpxMismatchError("본문 XML을 읽지 못했습니다.");
            pos = inner + 1;
          }
          if (!found) paragraph.segments.push({ start: close + 1, end: close + 1, text: "", selfClosingAt: null, charPrIDRef });
        }
      }
    }

    if (!selfClosing) stack.push({ name, contentStart: close + 1, node });
  }

  for (const { host, cell } of deferredCellHosts) { host.row = cell.row; host.col = cell.col; }
  for (const table of tables) {
    for (const row of table.rows) {
      for (const cell of row) {
        for (const paragraph of cell.paragraphs) paragraph.text = paragraph.segments.map(s => s.text).join("");
      }
    }
  }
  for (const paragraph of body) paragraph.text = paragraph.segments.map(s => s.text).join("");
  return { tables, body, paragraphCount, tableCount: tables.length };
}

export function findCell(index: SectionIndex, table: number, row: number, col: number): CellIndex {
  const target = index.tables[table];
  if (!target) throw new HwpxMismatchError(`원본 서식의 표 ${table}을(를) 찾지 못했습니다.`);
  for (const line of target.rows) for (const cell of line) if (cell.row === row && cell.col === col) return cell;
  throw new HwpxMismatchError(`원본 서식의 칸 ${table}/${row}/${col}을(를) 찾지 못했습니다.`);
}

export function findParagraph(index: SectionIndex, table: number, row: number, col: number, p: number): ParagraphIndex {
  const cell = findCell(index, table, row, col);
  const paragraph = cell.paragraphs[p];
  if (!paragraph) throw new HwpxMismatchError(`원본 서식의 칸 ${table}/${row}/${col}의 ${p}번째 줄을 찾지 못했습니다.`);
  return paragraph;
}

/** 원본에서 잘라 끼울 한 조각. */
export interface SourceEdit {
  start: number;
  end: number;
  xml: string;
}

/** 문단 글자 중 [from, to) 구간을 value로 바꾸라는 요청. */
export interface ParagraphOp {
  from: number;
  to: number;
  value: string;
}

/** 경계에서 시작하는 입력은 오른쪽 런에 넣는다. 문단 끝에만 마지막 런을 쓴다. */
function insertionSegment(paragraph: ParagraphIndex, position: number, to = position): number {
  let offset = 0;
  for (let index = 0; index < paragraph.segments.length; index += 1) {
    const end = offset + paragraph.segments[index].text.length;
    if ((to === position && position === offset && end === offset) || (position >= offset && position < end)) return index;
    offset = end;
  }
  return position === offset ? paragraph.segments.length - 1 : -1;
}

export function paragraphInsertionStyle(paragraph: ParagraphIndex, position: number, to = position): number {
  const index = insertionSegment(paragraph, position, to);
  return index < 0 ? paragraph.charPrIDRef : paragraph.segments[index].charPrIDRef;
}

/**
 * 한 문단에 대한 바꾸기 요청을 모아 한 번에 처리한다.
 * 문단은 여러 `<hp:t>`로 쪼개져 있을 수 있어, 요청이 걸친 토막마다 조각을 만든다.
 * 한 문단을 여러 번 고치는 경우(표시칸 여러 개 + 빈칸 채우기)를 한꺼번에 다뤄야
 * 같은 토막을 두 번 덮어쓰는 일이 생기지 않는다.
 */
export function replaceParagraphRanges(paragraph: ParagraphIndex, ops: ParagraphOp[]): SourceEdit[] {
  const sorted = [...ops].sort((a, b) => a.from - b.from || a.to - b.to);
  let previousEnd = -1;
  for (const op of sorted) {
    if (op.from < 0 || op.to < op.from || op.to > paragraph.text.length) throw new HwpxMismatchError("바꿀 위치가 원본 범위를 벗어났습니다.");
    if (op.from < previousEnd) throw new HwpxMismatchError("바꿀 자리가 서로 겹칩니다.");
    previousEnd = op.to;
  }

  if (paragraph.segments.length === 0) {
    const value = sorted.map(op => op.value).join("");
    if (sorted.some(op => op.from !== 0 || op.to !== 0)) throw new HwpxMismatchError("빈 칸에서 바꿀 글자를 찾지 못했습니다.");
    if (!value) return [];
    const run = paragraph.emptyRun;
    if (!run) throw new HwpxMismatchError("글자를 넣을 수 있는 자리를 찾지 못했습니다.");
    const escaped = escapeXmlText(value);
    if (run.selfClosingAt !== null) {
      return [{ start: run.selfClosingAt, end: run.selfClosingAt + 2, xml: `><hp:t>${escaped}</hp:t></hp:run>` }];
    }
    return [{ start: run.contentStart, end: run.contentStart, xml: `<hp:t>${escaped}</hp:t>` }];
  }

  const edits: SourceEdit[] = [];
  const placed = new Set<ParagraphOp>();
  let offset = 0;
  for (const [segmentIndex, segment] of paragraph.segments.entries()) {
    const segFrom = offset;
    const segTo = offset + segment.text.length;
    offset = segTo;
    const touching = sorted.filter(op => op.from === op.to
      ? insertionSegment(paragraph, op.from) === segmentIndex
      : op.from < segTo && op.to > segFrom);
    if (!touching.length) continue;
    let cursor = segFrom;
    let content = "";
    for (const op of touching) {
      const cut = Math.max(op.from, cursor);
      if (cut > cursor) content += escapeXmlText(paragraph.text.slice(cursor, cut));
      if (!placed.has(op)) {
        content += escapeXmlText(op.value);
        placed.add(op);
      }
      cursor = Math.max(cursor, Math.min(op.to, segTo));
    }
    if (cursor < segTo) content += escapeXmlText(paragraph.text.slice(cursor, segTo));
    if (segment.selfClosingAt !== null) {
      if (!content) continue;
      edits.push({ start: segment.selfClosingAt, end: segment.selfClosingAt + 2, xml: `>${content}</hp:t>` });
      continue;
    }
    edits.push({ start: segment.start, end: segment.end, xml: content });
  }
  if (placed.size !== sorted.length) throw new HwpxMismatchError("바꿀 글자 자리를 찾지 못했습니다.");
  return edits;
}

/** 조각들을 뒤에서부터 끼워 넣는다. 겹치는 조각이 있으면 바꾸지 않고 멈춘다. */
export function applyEdits(xml: string, edits: SourceEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let previousStart = Number.POSITIVE_INFINITY;
  let out = xml;
  for (const edit of sorted) {
    if (edit.end > previousStart) throw new HwpxMismatchError("바꿀 자리가 서로 겹칩니다.");
    out = out.slice(0, edit.start) + edit.xml + out.slice(edit.end);
    previousStart = edit.start;
  }
  return out;
}
