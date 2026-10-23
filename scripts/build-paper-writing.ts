/**
 * 변환 HWPX → 범용 작성기 manifest 컴파일러.
 *
 * 설치된 한글로 공개 HWP 원본을 변환해 `public/forms/writing/v1/conversions.json`과
 * `converted/*.hwpx`를 만든다. 이 스크립트는 그 변환본의 **실제 Contents/sectionN.xml**을 열어
 *
 *   - 원문 표/칸/행·열 병합과 표 밖 본문을 그대로 그릴 수 있는 화면 구성(blocks)
 *   - 원본이 비워 둔 자리(빈 칸·밑줄·명확한 공백)와 인쇄된 표시칸만 모은 slots
 *   - 각 자리에 실제로 들어가는 글꼴 폭(HWPUNIT)
 *
 * 를 뽑아 `manifest/<formId>.json`과 작성 버튼 게이트용 `index/<bucket>.json`을 쓴다.
 *
 * 없는 법적 요건이나 수급 자격 판단을 만들지 않는다. 라벨·선택지 문구는 원본에 인쇄된
 * 글귀를 그대로 옮긴 것이고, 가리킬 글귀가 없는 자리는 추측하지 않고 미지원으로 남긴다.
 * 서명 자리·동의 표시·기관 접수란은 값을 받지 않는 잠긴 자리로 둔다.
 *
 *   npx tsx scripts/build-paper-writing.ts
 *   npx tsx scripts/build-paper-writing.ts --ids=ordin-19969911
 *   npx tsx scripts/build-paper-writing.ts --prune
 */
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { indexSection, paragraphInsertionStyle, type BoxMargin, type CellIndex, type ParagraphIndex, type SectionIndex } from "../src/lib/client/hwpxXml";
import { buildPaperPreviewText } from "../src/lib/client/paperWritingPreview";
import { findBoxes } from "../src/lib/client/paperWriting";
import { measurePaperText, measurePaperSourceRange, type PaperGlyphStyles, type PaperLineMetrics } from "../src/lib/client/paperTextMetrics";
import { estimateHwpTextWidth, type FormGlyphStyle } from "../src/lib/client/formGlyphMetrics";
import { detailBucket } from "../src/lib/data/bucket";
import { paperSlotAtKey, type PaperAt, type PaperCellView, type PaperIndexEntry, type PaperLockKind, type PaperManifest, type PaperNode, type PaperSegment, type PaperSlot, type PaperUnsupported, type PaperWritingScope } from "../src/lib/data/paperWritingTypes";
import writingHolds from "../pipeline/forms/reviews/paper-writing-holds.json";
import writingScopes from "../src/lib/data/paperWritingScopes.json";

/* ── 경로와 입력 ──────────────────────────────────────────────────── */

const PUBLIC = "public";
const WRITING = "public/forms/writing/v1";
const CONVERSIONS = `${WRITING}/conversions.json`;
const MANIFEST_DIR = `${WRITING}/manifest`;
const INDEX_DIR = `${WRITING}/index`;
/** 공개된 혜택–서식 연결. 사업별 검토표가 실존하는 연결만 지목하는지 보는 데 쓴다. */
const PROGRAMS_DIR = `${PUBLIC}/forms/v1/programs`;
const UNSUPPORTED = `${WRITING}/unsupported.json`;
const REPORT_DEFAULT = "logs/hwp-writing/paper-writing-report.json";
/** 시민이 직접 작성하는 서식만. 지급대장 같은 기관 서류는 작성기에 올리지 않는다. */
const CITIZEN_ROLES = ["application", "consent", "delegation", "supporting"];
const WRITING_HOLDS = writingHolds.forms as Record<string, { sourceSHA256: string; reason: string }>;
/** 사업별로 사람이 검토해 연 자리 목록. 비어 있으면 새로 열리는 자리가 없다. */
const WRITING_SCOPES = writingScopes as { schema: number; forms: Record<string, PaperWritingScope> };
const PREVIEW_TEXT = "Preview/PrvText.txt";
/** 빈 원본 그림 — 완성 파일에 남으면 낡은 미리보기가 된다. 어느 선언 파일에도 들어 있지 않다. */
const PREVIEW_IMAGE = "Preview/PrvImage.png";

const argument = (name: string, fallback = "") =>
  process.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = (name: string) => process.argv.slice(2).includes(`--${name}`);

const sha256 = (bytes: Uint8Array | Buffer) => createHash("sha256").update(bytes).digest("hex");
const readJson = <T,>(path: string): T => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as T;
function writeIfChanged(path: string, text: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return true;
}

export interface CatalogForm {
  id: string; title: string; displayTitle?: string; role: string; lawTitle: string; sourceKind?: string;
  file?: { hwp: string; format?: string; bytes: number; sha256: string };
}
export interface Conversion {
  source: { path: string; bytes: number; sha256: string; format: string };
  asset: { path: string; bytes: number; sha256: string };
  pageCount: number; checkedAt: string; sourceTextSha256: string; verification?: string; metadataSanitized?: boolean;
}

/* ── header.xml의 글자·문단 모양 (칸 너비를 재는 데 쓴다) ──────────── */

interface CharStyle { height: number; glyphs: PaperGlyphStyles }
interface ParaStyle { left: number; right: number; indent: number; lineSpacing: number }

/** `<tag ...>…</tag>` 또는 `<tag .../>` 한 덩어리씩 잘라 낸다. */
function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  let match: RegExpExecArray | null;
  while ((match = open.exec(xml))) {
    const head = xml.indexOf(">", match.index);
    if (head < 0) break;
    if (xml[head - 1] === "/") { out.push(xml.slice(match.index, head + 1)); continue; }
    const end = xml.indexOf(`</${tag}>`, head);
    if (end < 0) break;
    out.push(xml.slice(match.index, end + tag.length + 3));
    open.lastIndex = end;
  }
  return out;
}
const attribute = (text: string, name: string): string | null =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(text)?.[1] ?? null;
const numberAttribute = (text: string | null, name: string, fallback: number): number => {
  const raw = text === null ? null : attribute(text, name);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

function readStyles(headerXml: string): { chars: Map<number, CharStyle>; paras: Map<number, ParaStyle> } {
  const fonts = new Map<string, { family: string; embedded: boolean }>();
  for (const face of blocks(headerXml, "hh:fontface")) {
    const language = attribute(face, "lang")?.toLowerCase();
    for (const font of blocks(face, "hh:font")) {
      const id = attribute(font, "id");
      if (language && id !== null) fonts.set(`${language}/${id}`, {
        family: attribute(font, "face") ?? "",
        embedded: /^(?:1|true)$/i.test(attribute(font, "isEmbedded") ?? "0"),
      });
    }
  }
  const chars = new Map<number, CharStyle>();
  for (const block of blocks(headerXml, "hh:charPr")) {
    const id = Number(attribute(block, "id"));
    if (!Number.isFinite(id)) continue;
    const height = numberAttribute(block, "height", 0);
    const fontRef = blocks(block, "hh:fontRef")[0] ?? "";
    const glyph = (language: "hangul" | "latin" | "symbol"): FormGlyphStyle => {
      const font = fonts.get(`${language}/${attribute(fontRef, language)}`);
      return {
        family: font?.family ?? "", size: height,
        ratio: numberAttribute(blocks(block, "hh:ratio")[0] ?? null, language, 100),
        spacing: numberAttribute(blocks(block, "hh:spacing")[0] ?? null, language, 0),
        relSz: numberAttribute(blocks(block, "hh:relSz")[0] ?? null, language, 100),
        bold: blocks(block, "hh:bold").length > 0, italic: blocks(block, "hh:italic").length > 0,
        kerning: /^(?:1|true)$/i.test(attribute(block, "useKerning") ?? "0"),
        embedded: font?.embedded ?? false,
      };
    };
    chars.set(id, { height, glyphs: { hangul: glyph("hangul"), latin: glyph("latin"), symbol: glyph("symbol") } });
  }
  const paras = new Map<number, ParaStyle>();
  for (const block of blocks(headerXml, "hh:paraPr")) {
    const id = Number(attribute(block, "id"));
    if (!Number.isFinite(id)) continue;
    const sourceCase = blocks(block, "hp:case")[0] ?? block;
    const marginBlock = blocks(sourceCase, "hh:margin")[0] ?? "";
    // HWPUNIT case의 hc:left/right/intent — default의 문자단위 값과 섞지 않는다.
    const side = (name: string) => {
      const entry = blocks(marginBlock, name)[0];
      if (!entry) return 0;
      if (attribute(entry, "unit") && attribute(entry, "unit") !== "HWPUNIT") return NaN;
      return numberAttribute(entry, "value", NaN);
    };
    const spacing = blocks(sourceCase, "hh:lineSpacing")[0] ?? "";
    paras.set(id, {
      left: side("hc:left"), right: side("hc:right"), indent: side("hc:intent"),
      lineSpacing: attribute(spacing, "type") === "PERCENT" ? numberAttribute(spacing, "value", 130) : 130,
    });
  }
  return { chars, paras };
}

/* ── 원문 그대로의 칸 격자 (라벨을 원문에서 찾는 데 쓴다) ──────────── */

interface Grid { cells: CellIndex[]; at: (row: number, col: number) => CellIndex | undefined; colCount: number; rowCount: number }

function buildGrid(rows: CellIndex[][]): Grid {
  const map = new Map<string, CellIndex>();
  const cells: CellIndex[] = [];
  let colCount = 0;
  let rowCount = 0;
  for (const line of rows) {
    for (const cell of line) {
      cells.push(cell);
      colCount = Math.max(colCount, cell.col + cell.colSpan);
      rowCount = Math.max(rowCount, cell.row + cell.rowSpan);
      for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) {
        for (let col = cell.col; col < cell.col + cell.colSpan; col += 1) map.set(`${row}/${col}`, cell);
      }
    }
  }
  return { cells, colCount, rowCount, at: (row, col) => map.get(`${row}/${col}`) };
}

const cellText = (cell: CellIndex) => cell.paragraphs.map(paragraph => paragraph.text).join(" ").replace(/\s+/g, " ").trim();
const tidy = (value: string) => value.replace(/\s+/g, " ").trim();

/** 그 칸을 가리키는 원문 글귀 — 같은 줄 왼쪽, 그다음 같은 열 위쪽에서 찾는다. */
function cellLabels(grid: Grid, cell: CellIndex): { row: string | null; column: string | null } {
  let rowLabel: string | null = null;
  for (let col = cell.col - 1; col >= 0; col -= 1) {
    const neighbour = grid.at(cell.row, col);
    if (!neighbour || neighbour === cell) continue;
    const text = cellText(neighbour);
    if (text) { rowLabel = text; break; }
  }
  let columnLabel: string | null = null;
  for (let row = cell.row - 1; row >= 0; row -= 1) {
    const neighbour = grid.at(row, cell.col);
    if (!neighbour || neighbour === cell) continue;
    const text = cellText(neighbour);
    if (text) {
      // 위 행의 한 작은 칸을 표 전체 폭의 구분선/여백 라벨로 빌려 쓰지 않는다.
      const signatureRow = grid.cells.some(other => other.row === neighbour.row && SIGNATURE.test(cellText(other)));
      if (!signatureRow && neighbour.col === cell.col && neighbour.colSpan === cell.colSpan) columnLabel = text;
      break;
    }
  }
  return { row: rowLabel, column: columnLabel };
}

/* ── 잠긴 자리(값을 받지 않는 자리) 판별 ──────────────────────────── */

const SIGNATURE = /서명|날인|직인|무인|\(인\)|인영|도장/;
const AGENCY = /담당\s*공무원|접수\s*번호|접수\s*일|접수\s*인|접수란|처리\s*기간|처리\s*기관|처리\s*부서|수수료|담당자|확인자|결재|결\s*의|기안|공무원\s*확인/;
const CONSENT = /동의합니다|동의하지|동의\s*여부|동의함|동의서|동의\s*하지|서약|확인합니다|열람\s*동의|제공\s*동의|수집\s*·?\s*이용\s*동의/;
// 짧은 동의 선택지는 체크에만 적용한다. 같은 문단의 성명 등 입력까지 잠그지 않는다.
const CONSENT_CHOICE = /(?:^|[^가-힣]|미\s*|수신\s*|열람\s*|제공\s*|이용\s*|수집\s*|활용\s*)동\s*의(?=$|[^가-힣]|함|합|하|서|여부)/;
const TRAILING_CONSENT = /(미\s*동\s*의|동\s*의(?:\s*하지\s*않(?:음|습니다)|함|합니다)?)[\s,]*$/;
const CONSENT_INFO_HEADING = /^(?:수집[·ㆍ]?이용목적|개인정보수집항목)$/;
const INSTRUCTION_HEADING = /^(?:[<〈]?\s*)?(?:작성\s*방법(?:\s*및\s*유의\s*사항)?|처리\s*절차)(?:\s*[>〉])?$/;
const INSTRUCTION_EXAMPLE = /(?:\[ *\]|□|☐).*(?:안에|에)\s*["“']?[√✓].*(?:표시|표를)|^(?:※\s*)?(?:예시|작성\s*예|기재\s*예|예\s*[:：])/;
/** 인쇄된 별지 표식·개정 이력과 설명문은 옆의 여백에 이름을 부여하지 않는다. */
function printedReferenceLabel(label: string): boolean {
  const compact = label.normalize("NFKC").replace(/\s+/g, "").replace(/^[■□○●]/, "")
    .replace(/[【〔]/g, "[").replace(/[】〕]/g, "]").replace(/[ㆍᆞ]/g, "·");
  return /^(?:[^<>\[\]]*(?:법|조례|규칙|지침))?\[?(?:별지(?:제?\d+(?:[-의]\d+)?호?)?(?:서식)?|서식제?\d+호)\]?(?:<[^<>]*>|\([^()]*관련\)|제\d+조(?:제\d+항)?관련)*$/.test(compact)
    || /^<(?:개정|신설)[^<>]*>$/.test(compact)
    || /접수[ㆍ·]?보관되지않|(?:신청|제출|동의|확인|허가)합니다/.test(compact);
}
const shortFieldLabel = (label: string | null) => !!label && label.length <= 50 && /[가-힣A-Za-z]/.test(label)
  && !printedReferenceLabel(label)
  && !/작성\s*방법|처리\s*절차|유의\s*사항|구비\s*서류|제출\s*서류|신청서\s*작성|귀하|\d\s*쪽|\[ *\]|[□☐]/.test(label)
  && !/(?:신청서|위임장|이사장|시장|군수|구청장|도지사|장관)\s*$/.test(label);

const LOCK_REASON = {
  signature: "서명·날인 자리예요. 인쇄한 뒤 직접 서명하거나 도장을 찍어 주세요.",
  consent: "동의·확인 표시예요. 원문을 읽고 인쇄한 뒤 직접 표시해 주세요.",
  agency: "접수기관이 적는 칸이에요. 신청인이 채우지 않아요.",
} as const;

type FormHeadingRole = "agency" | "citizen";
/** 짧은 독립 제목만 판별한다. 본문의 담당 공무원 확인 문구는 문서 역할을 바꾸지 않는다. */
function formHeadingRole(text: string): FormHeadingRole | null {
  const heading = tidy(text).replace(/^[□■○●]\s*/, "")
    .replace(/^(?:\[[^\]]{0,40}\]|〔[^〕]{0,40}〕|【[^】]{0,40}】)\s*/, "")
    .replace(/\s*[(（][^()（）]{0,40}[)）]\s*$/, "");
  if (!heading || heading.length > 90 || /[。!?;]|(?:작성|제출|보관)하여|하여야|습니다/.test(heading)) return null;
  const compact = heading.replace(/\s+/g, "");
  if (/(?:대장|검토조서|심사조서|검토서|심사결과표|(?:지급|지원)대상(?:자)?(?:명부|명단|내역))$/.test(compact)) return "agency";
  if (/(?:신청서|동의서|위임장|청구서|신고서|서약서)$/.test(compact)) return "citizen";
  return null;
}

/** 표 전체 폭의 제목만 역할 경계로 사용한다. 한쪽 기관 확인란은 포함하지 않는다. */
function tableHeadingRoles(grid: Grid): { row: number; role: FormHeadingRole }[] {
  return grid.cells.filter(cell => cell.col === 0 && cell.colSpan === grid.colCount)
    .flatMap(cell => cell.paragraphs.flatMap(paragraph => {
      const role = formHeadingRole(paragraph.text);
      return role ? [{ row: cell.row, role }] : [];
    })).sort((a, b) => a.row - b.row);
}

/* ── 원본이 비워 둔 자리 찾기 ─────────────────────────────────────── */

interface Blank { from: number; to: number; pad: " " | "_"; align?: "right"; token?: "년" | "월" | "일"; prefix?: true }

/** 인쇄된 년·월·일 순서가 명확한 날짜만. 날짜 글자는 치환 범위에 넣지 않는다. */
function dateBlanks(text: string): Blank[] {
  const result: Blank[] = [];
  for (const match of text.matchAll(/년( {2,})월( {2,})일(?![가-힣])/g)) {
    const year = match.index!;
    if (year > 0 && /[가-힣]/.test(text[year - 1])) continue;
    const month = year + 1 + match[1].length;
    const day = month + 1 + match[2].length;
    const preceding = / +$/.exec(text.slice(0, year));
    if (preceding && !/\d$/.test(text.slice(0, year - preceding[0].length))) {
      result.push({ from: year - preceding[0].length, to: year, pad: " ", align: "right", token: "년" });
    } else if (year === 0 || !/[\d가-힣 ]/.test(text[year - 1])) {
      result.push({ from: year, to: year, pad: " ", token: "년", prefix: true });
    }
    result.push({ from: year + 1, to: month, pad: " ", align: "right", token: "월" });
    result.push({ from: month + 1, to: day, pad: " ", align: "right", token: "일" });
  }
  return result;
}

/**
 * 인쇄된 문장 가운데 **명확히** 비워 둔 자리만 찾는다.
 * 글자 사이의 꾸미기용 공백을 빈칸으로 오해하지 않도록, 앞에 빈칸 표시가 있을 때만 받아들인다.
 *  - 밑줄 `___`
 *  - 괄호 안이 공백뿐인 `(     )`
 *  - 쌍점 뒤의 공백 `성명:        `
 *  - 날짜 줄의 `년 · 월 · 일` 앞 공백
 */
function findBlanks(text: string): Blank[] {
  const found: Blank[] = dateBlanks(text);
  const push = (from: number, to: number, pad: " " | "_", align?: "right") => {
    if (to <= from) return;
    const run = text.slice(from, to);
    // 전각 공백이 섞인 자리는 너비를 그대로 지킬 수 없어 받지 않는다.
    if ([...run].some(char => char !== pad)) return;
    if (found.some(other => from < other.to && other.from < to)) return;
    found.push({ from, to, pad, ...(align ? { align } : {}) });
  };
  for (const match of text.matchAll(/_{3,}/g)) push(match.index!, match.index! + match[0].length, "_");
  for (const match of text.matchAll(/[(（]( {3,})[)）]/g)) push(match.index! + 1, match.index! + 1 + match[1].length, " ");
  for (const match of text.matchAll(/[:：]( {4,})/g)) push(match.index! + match[0].length - match[1].length, match.index! + match[0].length, " ");
  return found.sort((a, b) => a.from - b.from);
}

/** 표시칸 찾기는 작성기와 똑같은 규칙(`findBoxes`)을 쓴다 — 모양별 차례로 자리를 다시 찾기 때문이다. */
type Box = ReturnType<typeof findBoxes>[number];

/** 표시칸 옆에 인쇄된 선택지 문구 — 그 칸 다음부터 다음 칸 앞까지. */
function boxLabel(text: string, boxes: Box[], position: number): string {
  const current = boxes[position];
  const previous = boxes[position - 1];
  const before = tidy(text.slice(previous ? previous.to : 0, current.from));
  const trailingConsent = TRAILING_CONSENT.test(tidy(text.slice(0, boxes[0].from)))
    ? TRAILING_CONSENT.exec(before) : null;
  if (trailingConsent) return trailingConsent[1];
  const next = boxes[position + 1];
  const after = tidy(text.slice(current.to, next ? next.from : text.length)).replace(/^[)\]]\s*/, "");
  if (after) return after.slice(0, 60);
  return before.slice(-60);
}

/** 빈칸 바로 앞에 인쇄된 글귀 — 쌍점·괄호·두 칸 이상 공백을 경계로 끊는다. */
function blankLabel(text: string, blank: Blank): string {
  if (blank.token) return blank.token;
  const before = text.slice(0, blank.from).replace(/[\s:：_(（]+$/, "");
  const parts = before.split(/[,·;、]|\s{2,}|[(（[]/);
  return tidy(parts[parts.length - 1] ?? "").slice(-40);
}

const NUMERIC_LABEL = /^(년|월|일|연도|생년월일|금액|나이|세|번호|우편번호)$/;
const inputKind = (label: string): PaperSlot["input"] | undefined => {
  if (/전화|연락처|휴대|핸드폰|팩스/.test(label)) return "tel";
  if (/전자우편|이메일|E-?mail/i.test(label)) return "email";
  if (NUMERIC_LABEL.test(label)) return "numeric";
  return undefined;
};

/* ── 한 서식 컴파일 ──────────────────────────────────────────────── */

/** `detected`는 원문에서 읽어 낸 후보 자리 전부. 실제로 공개하는 자리는 `manifest.slots`다. */
interface Compiled { manifest: PaperManifest; entry: PaperIndexEntry; detected: Record<string, PaperSlot> }

export interface WritingBaseline {
  sourceSHA256: string; assetSHA256: string; slotIds: string[];
  /** 이미 사업별로 나눠 공개한 서식이면 그 사업 목록. 검토표 없이 다시 합치지 않는다. */
  programmeIds?: string[];
}
export interface ScopedSlots { slots: Record<string, PaperSlot>; programmeSlots?: Record<string, string[]>; programmeIds?: string[] }

/**
 * 어떤 자리를 실제로 열지 정한다. 글꼴이 늘어 더 많은 칸을 읽을 수 있게 되어도,
 * 사람이 사업별로 검토한 목록이나 이미 검증된 기존 목록 없이는 저절로 열리지 않는다.
 *
 * - 검토표(scope)가 있으면 그 사업들이 지목한 자리만 열고 사업별 목록을 함께 싣는다.
 * - 검토표가 없고 기존 manifest(baseline)가 있으면 그 자리 집합을 그대로 지킨다.
 * - 둘 다 없으면 아무 자리도 열지 않는다. 그 서식은 화면 작성 미지원으로 남고,
 *   검증된 변환본 내려받기는 그대로 쓸 수 있다.
 *
 * 잠긴 자리는 어느 경로로도 열지 않는다.
 */
export function applyWritingScope(formId: string, slots: Record<string, PaperSlot>,
    source: { sha256: string }, asset: { sha256: string },
    scope?: PaperWritingScope, baseline?: WritingBaseline): ScopedSlots {
  const keep = (ids: Iterable<string>) => {
    const out: Record<string, PaperSlot> = {};
    for (const id of ids) if (slots[id]) out[id] = slots[id];
    return out;
  };
  const locked = (id: string) => !!slots[id]?.locked;
  if (scope) {
    if (scope.sourceSHA256 !== source.sha256 || scope.assetSHA256 !== asset.sha256)
      throw new Error("Writing scope is bound to different source/asset bytes: " + formId);
    const programmeIds = Object.keys(scope.programmes).sort();
    if (!programmeIds.length) throw new Error("Writing scope names no programme: " + formId);
    const programmeSlots: Record<string, string[]> = {};
    const union = new Set<string>();
    for (const programId of programmeIds) {
      const ids = scope.programmes[programId];
      if (!Array.isArray(ids) || !ids.length) throw new Error("Writing scope names no slot: " + formId + "/" + programId);
      for (const id of ids) {
        if (!slots[id]) throw new Error("Writing scope names a slot that does not exist: " + formId + "/" + id);
        if (locked(id)) throw new Error("Writing scope names a locked slot: " + formId + "/" + id);
        union.add(id);
      }
      programmeSlots[programId] = [...new Set(ids)].sort();
    }
    return { slots: keep(union), programmeSlots, programmeIds };
  }
  if (baseline) {
    if (baseline.sourceSHA256 !== source.sha256 || baseline.assetSHA256 !== asset.sha256)
      throw new Error("Existing manifest is bound to different source/asset bytes: " + formId);
    // 사업별로 나눠 공개한 서식은 그 검토표가 있어야 다시 만든다. 기존 산출물을 근거로
    // 사업 구분을 지우고 합집합을 열면, 다른 사업 화면에 검토하지 않은 칸이 생긴다.
    if (baseline.programmeIds?.length)
      throw new Error("Programme-scoped manifest needs its own review table to rebuild: " + formId);
    // 이미 검증된 자리만 그대로 둔다. 새 글꼴로 더 읽히게 된 자리는 검토표 없이 늘리지 않는다.
    return { slots: keep(baseline.slotIds.filter(id => !locked(id))) };
  }
  return { slots: {} };
}

/** 원본이 보기로 적어 둔 금액 예시. 이런 글자를 입력칸 이름으로 쓰지 않는다. */
export function isPlaceholderExample(text: string): boolean {
  return /^[\s(]*(?:[0O]{2,}|[×xX✕]{2,})\s*(?:억\s*)?원[\s)]*$/.test(text ?? "");
}

export function compileForm(formId: string, form: CatalogForm, conversion: Conversion, assetBytes: Uint8Array,
    scope?: PaperWritingScope, baseline?: WritingBaseline): Compiled {
  validateConversion(formId, form, conversion, assetBytes);
  // 다운로드에 승인한 일부와 실제 입력 가능한 부분이 다른 묶음 서식은 자동으로 열지 않는다.
  const writingHold = WRITING_HOLDS[formId];
  if (writingHold) {
    if (writingHold.sourceSHA256 !== conversion.source.sha256) throw new Error("화면 작성 보류 후 원본이 바뀌어 적용 범위 재검토가 필요합니다.");
    throw new Error(writingHold.reason);
  }
  const files = unzipSync(assetBytes);
  const order = Object.keys(files);
  if (order[0] !== "mimetype" || strFromU8(files["mimetype"]).trim() !== "application/hwp+zip") {
    throw new Error("변환본이 한글 꾸러미 구성이 아닙니다");
  }
  if (!files["Contents/header.xml"] || !files["Contents/section0.xml"]) throw new Error("변환본에 본문·스타일이 없습니다");
  const { chars, paras } = readStyles(strFromU8(files["Contents/header.xml"]));

  const sectionNames = order.filter(name => /^Contents\/section\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)/.exec(a)![1]) - Number(/(\d+)/.exec(b)![1]));
  const indexes: SectionIndex[] = sectionNames.map(name => indexSection(strFromU8(files[name])));
  const sectionNumbers = sectionNames.map(name => Number(/section(\d+)/.exec(name)![1]));

  const slots: Record<string, PaperSlot> = {};
  /** 각 후보 자리가 덮고 있는 원문 글자. 공개하지 않을 때 그대로 되돌려 놓는 데 쓴다. */
  const printed = new Map<string, string>();
  const capacities: Record<string, number> = {};
  const held = new Map<string, { reason: string; count: number; at?: PaperAt }>();
  const documentBlocks: PaperNode[] = [];
  let consentLocked = 0;
  let agencyLocked = 0;

  /** 열지 못한 자리를 이유별로 모은다 — 같은 이유가 여러 칸에서 나오면 건수만 센다. */
  const hold = (reason: string, at?: PaperAt) => {
    const row = held.get(reason) ?? { reason, count: 0, ...(at ? { at } : {}) };
    row.count += 1;
    held.set(reason, row);
  };

  const lineMetrics: Record<string, PaperLineMetrics> = {};
  const supportedStyles = (styles: PaperGlyphStyles) =>
    Object.values(styles).every(style => estimateHwpTextWidth("", style).supported);
  const approximateBudget = (available: number, styles: PaperGlyphStyles) =>
    Math.max(0, Math.ceil(available / Math.max(1, styles.latin.size / 2)));

  /** 원본 한 줄의 실제 폭과 각 run의 UTF-16 범위를 결속한다. 여러 빈 줄을 합쳐 폭을 늘리지 않는다. */
  const paragraphMetrics = (table: { inMargin: BoxMargin | null }, cell: CellIndex, paragraph: ParagraphIndex): PaperLineMetrics | null => {
    const para = paras.get(paragraph.paraPrIDRef);
    if (!cell.size || !para) return null;
    const inset = cell.margin ?? table.inMargin ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const available = cell.size.width - inset.left - inset.right - para.left - para.right - Math.max(0, para.indent);
    if (!Number.isFinite(available) || available <= 0) return null;
    const runs: PaperLineMetrics["runs"] = [];
    let offset = 0;
    for (const segment of paragraph.segments) {
      const style = chars.get(segment.charPrIDRef);
      if (!style) return null;
      runs.push({ from: offset, to: offset + segment.text.length, styles: style.glyphs });
      offset += segment.text.length;
    }
    if (offset !== paragraph.text.length) return null;
    if (!runs.length) {
      const style = chars.get(paragraph.charPrIDRef);
      if (!style) return null;
      runs.push({ from: 0, to: 0, styles: style.glyphs });
    }
    return { available, runs };
  };

  // 실제 치환기가 선택하는 오른쪽 run/빈 run/문단 끝 규칙을 그대로 공유한다.
  const insertionStyles = (paragraph: ParagraphIndex, from: number, to = from) =>
    chars.get(paragraphInsertionStyle(paragraph, from, to))?.glyphs ?? null;

  /**
   * 한 문단을 화면 조각으로 바꾼다. 인쇄된 글자는 그대로, 원본이 비워 둔 자리와
   * 인쇄된 표시칸만 입력 조각으로 바꾼다.
   */
  const paragraphNode = (
    at: PaperAt, paragraph: ParagraphIndex,
    context: { label: string | null; hint: string | null; lock: PaperLockKind | null; metrics: PaperLineMetrics | null; allowEmpty: boolean; allowFields: boolean },
  ): PaperNode => {
    const text = paragraph.text;
    const key = paperSlotAtKey(at);
    if (paragraph.hasNonTextContent) {
      hold("그림·필드·탭·강제줄바꿈 등이 있는 문단은 한 줄 입력 범위를 보장할 수 없어 원문으로 두었습니다.", at);
      return { kind: "paragraph", at, segments: text ? [{ kind: "text", text }] : [] };
    }
    const metrics = context.metrics;
    if (metrics) {
      lineMetrics[key] = metrics;
      capacities[key] = approximateBudget(metrics.available, metrics.runs[0].styles);
    }
    if (!context.allowFields) return { kind: "paragraph", at, segments: text ? [{ kind: "text", text }] : [] };
    const paragraphLock = context.lock ?? (CONSENT.test(text) ? "consent" : AGENCY.test(text) ? "agency" : null);
    const sourceWidth = metrics ? measurePaperSourceRange(text, metrics) : null;
    let remainingGrowth = sourceWidth === null || !metrics ? 0 : Math.max(0, metrics.available - sourceWidth);
    const metricHold = (styles: PaperGlyphStyles | null) => {
      const font = styles && Object.entries(styles).find(([, style]) => !estimateHwpTextWidth("", style).supported);
      const reason = !metrics ? "원본 칸·문단의 한 줄 너비 정보를 확인할 수 없어 인쇄한 뒤 직접 작성해 주세요."
        : !styles ? "원본 입력 위치의 글꼴 참조가 없어 인쇄한 뒤 직접 작성해 주세요."
          : font ? `원본 ${font[0]} 글꼴(${font[1].family || "이름 미확인"}) 또는 글꼴 옵션을 지원하지 않아 인쇄한 뒤 직접 작성해 주세요.`
            : sourceWidth === null ? "원문에 글리프 폭을 확인할 수 없는 문자가 있어 인쇄한 뒤 직접 작성해 주세요."
              : sourceWidth > metrics.available ? "원본문단이 확인한 한 줄 폭을 넘으므로 줄바꿈을 보장할 수 없어 인쇄한 뒤 직접 작성해 주세요."
                : "입력 자리·표시 기호의 폭 또는 남은 줄 여유가 부족하여 인쇄한 뒤 직접 작성해 주세요.";
      hold(reason, at);
    };

    /** `covered`는 이 자리가 덮고 있는 원문 글자 — 공개하지 않으면 그 글자를 되돌려 놓는다. */
    const add = (slot: PaperSlot, covered: string) => {
      slots[slot.id] = slot; printed.set(slot.id, covered);
      return { kind: "slot" as const, id: slot.id };
    };
    const lockOf = (kind: PaperLockKind | null) => kind ? { locked: { kind, reason: LOCK_REASON[kind] } } : {};
    const countLock = (kind: PaperLockKind | null) => {
      if (kind === "consent") consentLocked += 1;
      if (kind === "agency") agencyLocked += 1;
    };

    // 셀 전체가 비어 있는 값칸의 첫 문단만. 법문/동의문 사이 빈 줄은 입력칸이 아니다.
    if (text.trim() === "") {
      if (!context.allowEmpty || at.table === null) return { kind: "paragraph", at, segments: text ? [{ kind: "text", text }] : [] };
      if (!shortFieldLabel(context.label)) {
        hold("원본에 이 칸을 가리키는 글귀가 없어 어떤 칸인지 알려 드릴 수 없어요.", at);
        return { kind: "paragraph", at, segments: text ? [{ kind: "text", text }] : [] };
      }
      const styles = insertionStyles(paragraph, 0, text.length);
      if (!metrics || !styles || !supportedStyles(styles) || sourceWidth === null) {
        metricHold(styles);
        return { kind: "paragraph", at, segments: text ? [{ kind: "text", text }] : [] };
      }
      const label = context.label!;
      const lock = context.lock ?? (SIGNATURE.test(label) ? "signature" : AGENCY.test(label) ? "agency" : CONSENT.test(label) ? "consent" : null);
      countLock(lock);
      return {
        kind: "paragraph", at,
        segments: [add({
          id: key, kind: "text", at, expect: text, budget: approximateBudget(metrics.available, styles),
          width: { available: metrics.available, styles, charPrIDRef: paragraphInsertionStyle(paragraph, 0, text.length) },
          label, ...(context.hint ? { context: context.hint } : {}),
          ...(inputKind(label) ? { input: inputKind(label) } : {}), ...lockOf(lock),
        }, text)],
      };
    }

    // 인쇄된 글자가 있는 줄 — 비워 둔 자리와 표시칸만 입력으로 바꾼다.
    if (INSTRUCTION_EXAMPLE.test(text)) return { kind: "paragraph", at, segments: [{ kind: "text", text }] };
    const boxes = findBoxes(text);
    const blanks = findBlanks(text).filter(blank => !boxes.some(box => blank.from < box.to && box.from < blank.to));
    const marks = [
      ...blanks.map(blank => ({ ...blank, sort: blank.from, make: (): PaperSegment => {
        const label = blankLabel(text, blank) || context.label || "";
        if (!label) {
          hold("빈칸 앞에 이름이 적혀 있지 않아 어떤 칸인지 알려 드릴 수 없어요.", at);
          return { kind: "text", text: text.slice(blank.from, blank.to) };
        }
        const styles = insertionStyles(paragraph, blank.from, blank.to);
        const reserved = metrics ? measurePaperSourceRange(text, metrics, blank.from, blank.to) : null;
        if (!metrics || !styles || !supportedStyles(styles) || sourceWidth === null || reserved === null || sourceWidth > metrics.available) {
          metricHold(styles); return { kind: "text", text: text.slice(blank.from, blank.to) };
        }
        let available = reserved;
        if (blank.prefix) {
          const digits = [..."0123456789"].map(digit => measurePaperText(digit, styles));
          if (digits.some(value => value === null)) { metricHold(styles); return { kind: "text", text: "" }; }
          const needed = Math.max(...digits as number[]) * 4;
          if (remainingGrowth < needed) { metricHold(styles); return { kind: "text", text: "" }; }
          available = needed; remainingGrowth -= needed;
        }
        const following = tidy(text.slice(blank.to, blank.to + 14));
        const lock = paragraphLock ?? (SIGNATURE.test(label) || (/^[)）]?\s*[(（]?\s*(서명|날인)/.test(following) && !/[:：]\s*$/.test(text.slice(0, blank.from))) ? "signature" : null);
        countLock(lock);
        return add({
          id: `${key}#${blank.prefix ? "p" : "i"}${blank.from}`, kind: blank.prefix ? "prefix" : "inline", at, expect: text,
          from: blank.from, to: blank.to, pad: blank.pad, ...(blank.align ? { align: blank.align } : {}),
          ...(blank.prefix ? { after: blank.token } : {}), ...(blank.token ? { token: blank.token } : {}),
          budget: approximateBudget(available, styles), width: { available, styles, charPrIDRef: paragraphInsertionStyle(paragraph, blank.from, blank.to) }, label, context: tidy(text).slice(0, 160),
          ...(inputKind(label) ? { input: inputKind(label) } : {}), ...lockOf(lock),
        }, text.slice(blank.from, blank.to));
      } })),
      ...boxes.map((box, position) => ({ ...box, sort: box.from, make: (): PaperSegment => {
        const label = boxLabel(text, boxes, position);
        if (!label) {
          hold("표시칸 옆에 선택지 문구가 없어 무엇을 고르는지 알려 드릴 수 없어요.", at);
          return { kind: "text", text: text.slice(box.from, box.to) };
        }
        // 개인정보 안내문의 소제목 앞 사각형은 동의 선택지가 아니다.
        if (box.shape === "square" && CONSENT_INFO_HEADING.test(label.replace(/\s+/g, ""))) {
          return { kind: "text", text: text.slice(box.from, box.to) };
        }
        // 한 칸짜리 사각형은 제목/불릿일 수도 있다. 선택 문맥 없는 단일 표시는 추정하지 않는다.
        if (box.shape === "square" && boxes.length === 1 && !CONSENT.test(text) && !CONSENT_CHOICE.test(text)) {
          hold("선택지인지 확인할 수 없는 표시 기호는 원문 그대로 두었습니다.", at);
          return { kind: "text", text: text.slice(box.from, box.to) };
        }
        const styles = insertionStyles(paragraph, box.from, box.to);
        const marked = box.shape === "square" ? "■" : `[√${" ".repeat(Math.max(0, box.to - box.from - 4))}]`;
        const reserved = metrics ? measurePaperSourceRange(text, metrics, box.from, box.to) : null;
        const required = styles ? measurePaperText(marked, styles) : null;
        if (!metrics || !styles || !supportedStyles(styles) || sourceWidth === null || sourceWidth > metrics.available
          || reserved === null || required === null || Math.max(0, required - reserved) > remainingGrowth) {
          metricHold(styles); return { kind: "text", text: text.slice(box.from, box.to) };
        }
        remainingGrowth -= Math.max(0, required - reserved);
        const consentChoice = CONSENT_CHOICE.test(label)
          || (CONSENT_CHOICE.test(text) && /^(?:예|아니오|아니요)(?=$|[^가-힣])/.test(label));
        const lock = paragraphLock ?? (consentChoice ? "consent" : SIGNATURE.test(label) ? "signature" : null);
        countLock(lock);
        return add({
          id: `${key}#c${box.shape[0]}${box.box}`, kind: "check", at, expect: text,
          box: box.box, boxShape: box.shape, budget: 0, width: { available: Math.max(reserved, required), styles, charPrIDRef: paragraphInsertionStyle(paragraph, box.from, box.to) },
          label, context: tidy(text).slice(0, 160), ...lockOf(lock),
        }, text.slice(box.from, box.to));
      } })),
    ].sort((a, b) => a.sort - b.sort);

    const segments: PaperSegment[] = [];
    let cursor = 0;
    for (const mark of marks) {
      if (mark.from > cursor) segments.push({ kind: "text", text: text.slice(cursor, mark.from) });
      segments.push(mark.make());
      cursor = mark.to;
    }
    if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
    // 이웃한 원문 조각은 하나로 합쳐 둔다 (표시칸을 열지 못한 자리도 원문 그대로 남는다).
    const merged: PaperSegment[] = [];
    for (const segment of segments) {
      const last = merged[merged.length - 1];
      if (segment.kind === "text" && last?.kind === "text") last.text += segment.text;
      else merged.push(segment);
    }
    return { kind: "paragraph", at, segments: merged };
  };

  const tableNode = (indexNumber: number, tableIndex: number, initialAgency = false, parentAgency = false): PaperNode => {
    const section = sectionNumbers[indexNumber];
    const index = indexes[indexNumber];
    const table = index.tables[tableIndex];
    const grid = buildGrid(table.rows);
    const headings = tableHeadingRoles(grid);
    const instructionRows = grid.cells.filter(cell => cell.paragraphs.some(p => INSTRUCTION_HEADING.test(tidy(p.text)))).map(cell => cell.row);
    const instructionFrom = instructionRows.length ? Math.min(...instructionRows) : Infinity;
    const rows: PaperCellView[][] = table.rows.map(line => line.map(cell => {
      let agencyRegion = initialAgency;
      for (const heading of headings) {
        if (heading.row > cell.row) break;
        agencyRegion = heading.role === "agency";
      }
      // 기관 작성 칸 안의 중첩표는 내부 제목에 관계없이 같은 작성 주체를 유지한다.
      agencyRegion ||= parentAgency;
      const labels = cellLabels(grid, cell);
      const label = labels.row ?? labels.column;
      const hint = [labels.column, labels.row].filter((value): value is string => !!value && value !== label).join(" · ") || null;
      const lock: PaperLockKind | null = agencyRegion || (label && AGENCY.test(label)) ? "agency"
        : label && SIGNATURE.test(label) ? "signature"
        : labels.column && AGENCY.test(labels.column) ? "agency" : null;
      const nodes: PaperNode[] = [];
      const nestedCell = index.tables.some(nested => nested.host?.kind === "cell" && nested.host.table === tableIndex
        && nested.host.row === cell.row && nested.host.col === cell.col);
      const wholeEmptyCell = !nestedCell && cell.paragraphs.every(paragraph => paragraph.text.trim() === "" && !paragraph.hasNonTextContent);
      cell.paragraphs.forEach((paragraph, p) => {
        const at: PaperAt = { section, table: tableIndex, row: cell.row, col: cell.col, p };
        nodes.push(paragraphNode(at, paragraph, {
          label, hint, lock,
          metrics: paragraphMetrics(table, cell, paragraph),
          allowEmpty: wholeEmptyCell && p === 0,
          allowFields: cell.row < instructionFrom,
        }));
        index.tables.forEach((nested, nestedIndex) => {
          if (nested.host?.kind === "cell" && nested.host.table === tableIndex
            && nested.host.row === cell.row && nested.host.col === cell.col && nested.host.p === p) {
            nodes.push(tableNode(indexNumber, nestedIndex, lock === "agency", lock === "agency"));
          }
        });
      });
      const role = nodes.some(node => node.kind === "paragraph" && node.segments.some(segment => segment.kind === "slot" && !slots[segment.id]?.locked)) ? "entry" : "printed";
      return { row: cell.row, col: cell.col, rowSpan: cell.rowSpan, colSpan: cell.colSpan, role, nodes } satisfies PaperCellView;
    }));
    return { kind: "table", index: tableIndex, colCount: grid.colCount, rows };
  };

  indexes.forEach((index, indexNumber) => {
    const section = sectionNumbers[indexNumber];
    let agencyRegion = false;
    index.body.forEach((paragraph, p) => {
      const heading = formHeadingRole(paragraph.text);
      if (heading) agencyRegion = heading === "agency";
      const at: PaperAt = { section, table: null, row: 0, col: 0, p };
      if (paragraph.text !== "") documentBlocks.push(paragraphNode(at, paragraph, { label: null, hint: null, lock: agencyRegion ? "agency" : null, metrics: null, allowEmpty: false, allowFields: true }));
      index.tables.forEach((table, tableIndex) => {
        if (table.host?.kind === "body" && table.host.p === p) {
          documentBlocks.push(tableNode(indexNumber, tableIndex, agencyRegion));
          const lastHeading = tableHeadingRoles(buildGrid(table.rows)).at(-1);
          if (lastHeading) agencyRegion = lastHeading.role === "agency";
        }
      });
    });
    for (const table of index.tables) {
      if (table.host === null) hold("본문에서 자리를 찾지 못한 표는 화면에 보여 드리지 않아요. 원본 받기로 확인해 주세요.");
    }
  });

  // 미리보기 글 — 이 규칙이 빈 원본의 미리보기를 그대로 재현하는지 확인해 남긴다.
  const originalPreview = files[PREVIEW_TEXT] ? strFromU8(files[PREVIEW_TEXT]) : "";
  const full = buildPaperPreviewText(indexes, null);
  const limit = originalPreview && originalPreview.length < full.length ? originalPreview.length : null;
  const exact = !!files[PREVIEW_TEXT] && buildPaperPreviewText(indexes, limit) === originalPreview;

  // 검토표/기존 목록이 정하는 자리만 남긴다. 잠긴 자리는 어느 경로로도 열리지 않는다.
  const scoped = applyWritingScope(formId, slots, conversion.source, conversion.asset, scope, baseline);
  const lockedSlots = Object.fromEntries(Object.entries(slots).filter(([, slot]) => slot.locked));
  const published: Record<string, PaperSlot> = { ...lockedSlots, ...scoped.slots };

  // 공개하지 않은 후보 자리는 덮고 있던 원문 글자로 되돌린다. 그러지 않으면 원본에 인쇄된
  // 빈칸·표시칸이 화면에서 사라져 원문과 다르게 보인다. 셀의 역할도 되돌린 뒤에 다시 센다.
  const restore = (nodes: PaperNode[]): PaperNode[] => nodes.map(node => {
    if (node.kind === "table") {
      return { ...node, rows: node.rows.map(line => line.map(cell => {
        const restored = restore(cell.nodes);
        const role = restored.some(child => child.kind === "paragraph" && child.segments
          .some(segment => segment.kind === "slot" && !published[segment.id]?.locked)) ? "entry" : "printed";
        return { ...cell, role, nodes: restored } satisfies PaperCellView;
      })) };
    }
    if (!node.segments.some(segment => segment.kind === "slot" && !published[segment.id])) return node;
    const merged: PaperSegment[] = [];
    for (const segment of node.segments) {
      const next: PaperSegment = segment.kind === "slot" && !published[segment.id]
        ? { kind: "text", text: printed.get(segment.id) ?? "" } : segment;
      const last = merged[merged.length - 1];
      if (next.kind === "text" && last?.kind === "text") last.text += next.text;
      else merged.push({ ...next });
    }
    return { ...node, segments: merged };
  });
  const blocks = restore(documentBlocks);
  // 읽을 수는 있었지만 아직 사업별 검토를 마치지 않아 열지 않은 칸도 그대로 알려 준다.
  for (const slot of Object.values(slots)) {
    if (!slot.locked && !published[slot.id]) hold("이 사업에서 화면 입력을 제공하지 않는 칸이에요. 원본을 확인하고 필요한 부분은 직접 적어 주세요.", slot.at);
  }

  const openCount = Object.values(published).filter(slot => !slot.locked).length;
  const lockedCount = Object.values(published).length - openCount;
  const unsupported: PaperUnsupported[] = [...held.values()].sort((a, b) => b.count - a.count);
  const manual = [
    "인쇄한 뒤 서명란에 직접 서명하거나 도장을 찍어 주세요. 이 화면은 서명을 만들지 않아요.",
    ...(consentLocked ? ["동의·확인 표시는 원문을 읽고 인쇄한 뒤 직접 표시해 주세요."] : []),
    ...(agencyLocked ? ["담당 공무원 확인란·접수란은 접수기관이 적는 칸이에요."] : []),
    ...(unsupported.length ? ["화면에서 열지 못한 칸은 인쇄한 뒤 직접 적어 주세요. 어떤 칸인지는 아래에 적어 두었어요."] : []),
    "내려받기는 접수 완료가 아니에요. 접수기관의 신청 안내와 구비서류를 함께 확인해 주세요.",
  ];

  const manifest: PaperManifest = {
    schema: 1, formId,
    title: form.displayTitle ?? form.title,
    lawTitle: form.lawTitle,
    sourceKind: form.sourceKind ?? "",
    source: { path: conversion.source.path, bytes: conversion.source.bytes, sha256: conversion.source.sha256, format: "hwp" },
    asset: conversion.asset,
    pageCount: conversion.pageCount,
    checkedAt: conversion.checkedAt,
    sourceTextSha256: conversion.sourceTextSha256,
    sections: sectionNames.map((name, section) => ({ name, tableCount: indexes[section].tableCount, paragraphCount: indexes[section].paragraphCount })),
    preview: { textEntry: PREVIEW_TEXT, exact, limit, dropEntries: files[PREVIEW_IMAGE] ? [PREVIEW_IMAGE] : [] },
    blocks, slots: published, capacities, lineMetrics, unsupported, manual,
    ...(scoped.programmeSlots ? { programmeSlots: scoped.programmeSlots, programmeIds: scoped.programmeIds } : {}),
  };

  const text = JSON.stringify(manifest);
  return {
    manifest,
    detected: slots,
    entry: {
      source: manifest.source, asset: manifest.asset,
      manifest: `/forms/writing/v1/manifest/${formId}.json`,
      manifestSha256: sha256(Buffer.from(text, "utf8")),
      pageCount: manifest.pageCount, checkedAt: manifest.checkedAt,
      slotCount: openCount, lockedCount,
      ...(scoped.programmeIds ? { programmeIds: scoped.programmeIds } : {}),
    },
  };
}

/* ── 실행 ────────────────────────────────────────────────────────── */

/** 공개 원본과 최종 메타데이터 정리본을 정확히 결속한다. 함수 자체는 파일을 쓰지 않는다. */
export function validateConversion(formId: string, form: CatalogForm, conversion: Conversion, bytes?: Uint8Array): void {
  if (!/^[A-Za-z0-9_-]+$/.test(formId) || form.id !== formId) throw new Error("서식 식별자가 공개 목록과 다릅니다");
  if (!form.file) throw new Error("공개 목록에 파일이 없는 서식입니다");
  if (!CITIZEN_ROLES.includes(form.role)) throw new Error(`시민이 작성하는 서식이 아닙니다 (role=${form.role})`);
  if (form.file.format !== "hwp" || conversion.source.format !== "hwp") throw new Error("원본이 HWP가 아닙니다");
  if (conversion.metadataSanitized !== true) throw new Error("변환본 메타데이터 정리가 확인되지 않았습니다");
  if (![conversion.source.sha256, conversion.asset.sha256, conversion.sourceTextSha256].every(value => /^[a-f0-9]{64}$/.test(value))) {
    throw new Error("원본·변환본·본문 SHA-256이 올바르지 않습니다");
  }
  if (conversion.source.path !== form.file.hwp || conversion.source.bytes !== form.file.bytes
    || conversion.source.sha256 !== form.file.sha256) throw new Error("변환 기록이 공개 목록의 원본과 다릅니다");
  const expected = `/forms/writing/v1/converted/${formId}-${conversion.source.sha256.slice(0, 12)}-${conversion.asset.sha256.slice(0, 12)}.hwpx`;
  if (conversion.asset.path !== expected) throw new Error("변환본 경로가 원본·변환본 SHA와 묶이지 않았습니다");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(conversion.checkedAt)) throw new Error("checkedAt이 날짜가 아닙니다");
  if (!Number.isSafeInteger(conversion.pageCount) || conversion.pageCount <= 0) throw new Error("pageCount가 없습니다");
  if (!Number.isSafeInteger(conversion.asset.bytes) || conversion.asset.bytes <= 0) throw new Error("변환본 크기가 올바르지 않습니다");
  if (bytes && (bytes.byteLength !== conversion.asset.bytes || sha256(bytes) !== conversion.asset.sha256)) {
    throw new Error("변환본의 바이트 수·SHA-256이 변환 기록과 다릅니다");
  }
}

export function buildIndexSummary(buckets: [string, Record<string, PaperIndexEntry>][], conversions: number, unsupported: number) {
  const formIds = buckets.flatMap(([, forms]) => Object.keys(forms)).sort();
  return { schema: 1, generatedAt: new Date().toISOString(), sharded: true,
    buckets: buckets.map(([bucket]) => bucket), formIds, counts: { conversions, writable: formIds.length, unsupported } };
}

/* ── 기존 공개 범위 snapshot · 검토표 확인 ────────────────────────── */

export interface ScopeIssue { formId: string; reason: string }

/**
 * 이미 공개한 manifest 한 건에서 baseline 을 뽑는다.
 * 색인에 적힌 해시·신원과 실제 파일이 한 글자라도 다르면 근거로 쓰지 않는다 —
 * 그때 사람이 확인한 바로 그 산출물만 "이미 검증된 범위"가 될 수 있다.
 */
export function baselineFromPublished(formId: string, entry: PaperIndexEntry, manifestText: string): WritingBaseline {
  if (entry.manifest !== `/forms/writing/v1/manifest/${formId}.json`) throw new Error(`색인의 manifest 주소가 서식과 다릅니다: ${formId}`);
  if (sha256(Buffer.from(manifestText, "utf8")) !== entry.manifestSha256) throw new Error(`공개된 manifest 가 색인의 SHA-256 과 다릅니다: ${formId}`);
  const manifest = JSON.parse(manifestText) as PaperManifest;
  if (manifest.schema !== 1 || manifest.formId !== formId) throw new Error(`공개된 manifest 의 서식 식별자가 다릅니다: ${formId}`);
  if (manifest.source.sha256 !== entry.source.sha256 || manifest.asset.sha256 !== entry.asset.sha256) {
    throw new Error(`공개된 manifest 와 색인의 원본·변환본 신원이 다릅니다: ${formId}`);
  }
  if (manifest.source.path !== entry.source.path || manifest.source.bytes !== entry.source.bytes
      || manifest.source.format !== entry.source.format
      || manifest.asset.path !== entry.asset.path || manifest.asset.bytes !== entry.asset.bytes) {
    throw new Error(`공개된 manifest 와 색인의 원본·변환본 주소 또는 크기가 다릅니다: ${formId}`);
  }
  if (JSON.stringify([...(manifest.programmeIds ?? [])].sort()) !== JSON.stringify([...(entry.programmeIds ?? [])].sort())) {
    throw new Error(`공개된 manifest 와 색인의 사업별 작성 범위가 다릅니다: ${formId}`);
  }
  const slots = Object.values(manifest.slots);
  const open = slots.filter(slot => !slot.locked);
  if (open.length !== entry.slotCount || slots.length - open.length !== entry.lockedCount) {
    throw new Error(`공개된 manifest 의 자리 수가 색인과 다릅니다: ${formId}`);
  }
  if (!open.length) throw new Error(`공개된 manifest 에 열린 자리가 없습니다: ${formId}`);
  return {
    sourceSHA256: manifest.source.sha256, assetSHA256: manifest.asset.sha256,
    slotIds: open.map(slot => slot.id).sort(),
    ...(manifest.programmeIds?.length ? { programmeIds: [...manifest.programmeIds] } : {}),
  };
}

/**
 * 공개된 색인 전체를 훑어 기존 작성 범위를 snapshot 한다. 읽기만 한다.
 * `only` 를 주면 그 서식의 manifest 만 읽지만, 색인 자체의 중복·버킷 검사는 전부 돌린다.
 */
export function readPublishedBaselines(indexDir = INDEX_DIR, publicRoot = PUBLIC, only?: Set<string>): Map<string, WritingBaseline> {
  const out = new Map<string, WritingBaseline>();
  if (!existsSync(indexDir)) return out;
  const seen = new Set<string>();
  for (const name of readdirSync(indexDir).sort()) {
    if (!name.endsWith(".json")) continue;
    const shard = readJson<{ schema: number; bucket: string; forms: Record<string, PaperIndexEntry> }>(join(indexDir, name));
    if (shard.schema !== 1 || shard.bucket !== name.replace(/\.json$/, "")) throw new Error(`색인 샤드가 올바르지 않습니다: ${name}`);
    for (const [formId, entry] of Object.entries(shard.forms)) {
      if (detailBucket(formId) !== shard.bucket) throw new Error(`색인 샤드가 서식의 버킷과 다릅니다: ${formId} (${name})`);
      if (seen.has(formId)) throw new Error(`같은 서식이 색인 샤드 두 곳에 있습니다: ${formId}`);
      seen.add(formId);
      if (only && !only.has(formId)) continue;
      const path = join(publicRoot, entry.manifest.replace(/^\//, ""));
      if (!existsSync(path)) throw new Error(`색인이 가리키는 manifest 가 없습니다: ${formId}`);
      out.set(formId, baselineFromPublished(formId, entry, readFileSync(path, "utf8")));
    }
  }
  return out;
}

/** 공개된 혜택–서식 연결. 검토표는 실제로 이어진 사업만 지목할 수 있다. */
export function readProgrammeLinks(dir = PROGRAMS_DIR): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!existsSync(dir)) throw new Error(`공개 혜택 연결 자료가 없습니다: ${dir}`);
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const shard = readJson<{ programs?: { id: string; links?: { formId: string }[] }[] }>(join(dir, name));
    for (const program of shard.programs ?? []) {
      for (const link of program.links ?? []) {
        if (!out.has(link.formId)) out.set(link.formId, new Set());
        out.get(link.formId)!.add(program.id);
      }
    }
  }
  return out;
}

/**
 * 이 서식의 작성 범위를 무엇으로 정할지 고른다.
 * 검토표가 있으면 그것이 기준이고, 원본·변환본이 바뀐 기존 범위는 근거로 쓰지 않는다.
 */
export function writingBasis(formId: string, conversion: Conversion,
    registry: Record<string, PaperWritingScope>, baselines: Map<string, WritingBaseline>):
    { scope?: PaperWritingScope; baseline?: WritingBaseline; rebound: boolean } {
  const scope = registry[formId];
  const published = baselines.get(formId);
  const bound = !!published && published.sourceSHA256 === conversion.source.sha256
    && published.assetSHA256 === conversion.asset.sha256;
  return {
    ...(scope ? { scope } : {}),
    ...(bound ? { baseline: published } : {}),
    rebound: !!published && !bound && !scope,
  };
}

/**
 * 검토표를 쓰기 전에 보는 것들. 여기서 걸리면 공개 산출물을 하나도 바꾸지 않고 멈춘다.
 * 자리 id 가 실제로 있는지·잠겨 있는지는 변환본을 열어야 알 수 있어 컴파일에서 본다.
 */
export function scopeRegistryIssues(registry: Record<string, PaperWritingScope>,
    conversions: Record<string, Conversion>, links: Map<string, Set<string>>): ScopeIssue[] {
  const issues: ScopeIssue[] = [];
  const short = (value: string) => (typeof value === "string" ? value.slice(0, 12) : String(value));
  for (const formId of Object.keys(registry).sort()) {
    const scope = registry[formId];
    const conversion = conversions[formId];
    if (!conversion) { issues.push({ formId, reason: "검토표가 변환 기록에 없는 서식을 지목합니다" }); continue; }
    if (scope.sourceSHA256 !== conversion.source.sha256) {
      issues.push({ formId, reason: `검토표의 원본 SHA 가 지금 변환 기록과 다릅니다 (검토표 ${short(scope.sourceSHA256)} / 현재 ${short(conversion.source.sha256)})` });
    }
    if (scope.assetSHA256 !== conversion.asset.sha256) {
      issues.push({ formId, reason: `검토표의 변환본 SHA 가 지금 변환 기록과 다릅니다 (검토표 ${short(scope.assetSHA256)} / 현재 ${short(conversion.asset.sha256)})` });
    }
    const programmes = Object.keys(scope.programmes ?? {});
    if (!programmes.length) { issues.push({ formId, reason: "검토표가 사업을 하나도 지목하지 않았습니다" }); continue; }
    const linked = links.get(formId) ?? new Set<string>();
    for (const programId of programmes.sort()) {
      const ids = scope.programmes[programId];
      if (!Array.isArray(ids) || !ids.length) issues.push({ formId, reason: `검토표의 ${programId} 에 자리 목록이 없습니다` });
      else if (ids.some(id => typeof id !== "string" || !id)) issues.push({ formId, reason: `검토표의 ${programId} 에 자리 id 가 아닌 값이 있습니다` });
      if (!linked.has(programId)) issues.push({ formId, reason: `${programId} 은(는) 이 서식과 연결된 공개 혜택이 아닙니다` });
    }
  }
  return issues;
}

function main() {
  const catalog = readJson<{ schema: number; forms: Record<string, CatalogForm> }>("public/forms/v1/catalog.json");
  if (catalog.schema !== 1) throw new Error("catalog.json schema가 1이 아닙니다");
  const conversions = readJson<{ schema: number; forms: Record<string, Conversion> }>(CONVERSIONS);
  if (conversions.schema !== 1) throw new Error("conversions.json schema가 1이 아닙니다");

  const only = argument("ids").split(",").filter(Boolean);
  const ids = (only.length ? only : Object.keys(conversions.forms)).sort();

  // 검토표를 먼저 본다. 여기서 걸리면 공개 산출물을 하나도 바꾸지 않고 멈춘다.
  if (WRITING_SCOPES.schema !== 1) throw new Error("paperWritingScopes.json schema가 1이 아닙니다");
  const registry = WRITING_SCOPES.forms;
  const issues = scopeRegistryIssues(registry, conversions.forms, readProgrammeLinks());
  if (issues.length) {
    throw new Error("사업별 검토표를 쓸 수 없습니다 (공개 산출물을 바꾸지 않았습니다):\n"
      + issues.map(issue => `  ${issue.formId}: ${issue.reason}`).join("\n"));
  }
  // 이미 공개한 작성 범위를 먼저 snapshot 한다 — 읽기만 한다.
  // 글꼴이 늘어 더 많은 칸을 읽게 되어도 이 범위를 넘겨 열지 않는다.
  if (flag("progress")) process.stderr.write("snapshot published writing scope\n");
  const baselines = readPublishedBaselines(INDEX_DIR, PUBLIC, only.length ? new Set(only) : undefined);
  const missingScopes = [...baselines].filter(([formId, baseline]) => baseline.programmeIds?.length && !registry[formId]);
  if (missingScopes.length) {
    throw new Error("이미 사업별로 구분한 작성 범위의 검토표가 없습니다 (공개 산출물을 바꾸지 않았습니다): "
      + missingScopes.map(([formId]) => formId).join(", "));
  }

  const shards = new Map<string, Record<string, PaperIndexEntry>>();
  const written: string[] = [];
  const skipped: { formId: string; sourceSHA256: string | null; sourceRole: string | null; reason: string; lockedCount: number | null; details: PaperUnsupported[] }[] = [];
  const report: { formId: string; slots: number; locked: number; unsupported: number; previewExact: boolean; sections: number; basis: "scope" | "baseline" }[] = [];
  /** 기존에 열려 있었지만 원본·변환본이 바뀌어 그 범위를 더 쓸 수 없는 서식 */
  const rebound: { formId: string; publishedSource: string; currentSource: string; publishedAsset: string; currentAsset: string }[] = [];
  /** 기존 범위 안에서 이번에 열리지 않은 자리 (늘어난 경우는 오류로 멈춘다) */
  const drift: { formId: string; publishedBefore: number; openedNow: number; missing: string[] }[] = [];

  for (const formId of ids) {
    if (flag("progress")) process.stderr.write(`compile ${formId}\n`);
    const conversion = conversions.forms[formId];
    const form = catalog.forms[formId];
    let details: PaperUnsupported[] = [];
    let lockedCount: number | null = null;
    try {
      if (!conversion) throw new Error("conversions.json에 없는 서식입니다");
      if (!form) throw new Error("공개 목록에 없는 서식입니다");
      validateConversion(formId, form, conversion);
      const assetPath = join(PUBLIC, conversion.asset.path.replace(/^\//, ""));
      if (!existsSync(assetPath)) throw new Error("변환본 파일이 아직 없습니다");
      const bytes = new Uint8Array(readFileSync(assetPath));
      validateConversion(formId, form, conversion, bytes);

      // 검토표가 있으면 그것이 기준이다. 없으면 이미 공개한 범위를 그대로 지킨다.
      const { scope, baseline, rebound: changed } = writingBasis(formId, conversion, registry, baselines);
      if (changed) {
        const published = baselines.get(formId)!;
        rebound.push({ formId, publishedSource: published.sourceSHA256, currentSource: conversion.source.sha256,
          publishedAsset: published.assetSHA256, currentAsset: conversion.asset.sha256 });
        throw new Error("원본·변환본이 바뀌어 이미 검증한 작성 범위를 그대로 쓸 수 없습니다. 사업별 검토표가 필요합니다.");
      }
      const compiled = compileForm(formId, form, conversion, bytes, scope, baseline);
      if (baseline && !scope) {
        const openIds = Object.values(compiled.manifest.slots).filter(slot => !slot.locked).map(slot => slot.id);
        const allowed = new Set(baseline.slotIds), openedNow = new Set(openIds);
        const grown = openIds.filter(id => !allowed.has(id));
        if (grown.length) throw new Error(`이미 검증한 범위에 없던 자리가 열렸습니다: ${grown.slice(0, 5).join(", ")}`);
        const missing = baseline.slotIds.filter(id => !openedNow.has(id));
        if (missing.length) drift.push({ formId, publishedBefore: baseline.slotIds.length, openedNow: openIds.length, missing: missing.slice(0, 20) });
      }
      if (!compiled.entry.slotCount) {
        details = compiled.manifest.unsupported;
        lockedCount = compiled.entry.lockedCount;
        skipped.push({ formId, sourceSHA256: form.file!.sha256, sourceRole: form.role,
          reason: "현재 지원 범위에서 화면 입력을 열 수 있는 자리가 없습니다. 원본에 신청란이 없다는 뜻은 아닙니다.", lockedCount, details });
        const path = join(MANIFEST_DIR, `${formId}.json`);
        if (existsSync(path)) unlinkSync(path);
        continue;
      }
      const path = join(MANIFEST_DIR, `${formId}.json`);
      if (writeIfChanged(path, JSON.stringify(compiled.manifest))) written.push(formId);
      const bucket = detailBucket(formId);
      if (!shards.has(bucket)) shards.set(bucket, {});
      shards.get(bucket)![formId] = compiled.entry;
      report.push({
        formId, slots: compiled.entry.slotCount, locked: compiled.entry.lockedCount,
        unsupported: compiled.manifest.unsupported.length, previewExact: compiled.manifest.preview.exact,
        sections: compiled.manifest.sections.length, basis: scope ? "scope" : "baseline",
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // 검토표가 있는 서식을 조용히 미지원으로 내려보내지 않는다. 색인·미지원 목록을 쓰지 않고 멈춘다.
      if (registry[formId]) throw new Error(`검토표가 있는 ${formId} 을(를) 컴파일할 수 없습니다: ${reason}`);
      skipped.push({ formId, sourceSHA256: form?.file?.sha256 ?? null, sourceRole: form?.role ?? null,
        reason, lockedCount, details });
      const path = join(MANIFEST_DIR, `${formId}.json`);
      if (existsSync(path)) unlinkSync(path);
    }
  }

  // 일부만 다시 컴파일하는 경우에도 샤드는 전체를 유지해야 한다 — 기존 샤드를 읽어 합친다.
  if (only.length && existsSync(INDEX_DIR)) {
    for (const name of readdirSync(INDEX_DIR)) {
      const bucket = name.replace(/\.json$/, "");
      const existing = readJson<{ forms: Record<string, PaperIndexEntry> }>(join(INDEX_DIR, name));
      const merged = { ...existing.forms, ...(shards.get(bucket) ?? {}) };
      for (const formId of skipped.map(row => row.formId)) delete merged[formId];
      shards.set(bucket, merged);
    }
  }

  const buckets = [...shards.entries()].filter(([, forms]) => Object.keys(forms).length).sort(([a], [b]) => a.localeCompare(b));
  // 부분 재생성도 이전 미지원 판정을 보존하고, 이번에 재검사한 ID만 교체한다.
  const allHeld = new Map<string, typeof skipped[number]>();
  if (only.length && existsSync(UNSUPPORTED)) {
    for (const row of readJson<{ forms: typeof skipped }>(UNSUPPORTED).forms) allHeld.set(row.formId, row);
  }
  for (const id of ids) allHeld.delete(id);
  for (const row of skipped) allHeld.set(row.formId, row);
  const heldForms = [...allHeld.values()].sort((a, b) => a.formId.localeCompare(b.formId));
  writeIfChanged(UNSUPPORTED, JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(), forms: heldForms }));
  for (const [bucket, forms] of buckets) {
    const sorted = Object.fromEntries(Object.keys(forms).sort().map(key => [key, forms[key]]));
    writeIfChanged(join(INDEX_DIR, `${bucket}.json`), JSON.stringify({ schema: 1, bucket, forms: sorted }));
  }
  if (existsSync(INDEX_DIR)) {
    const keep = new Set(buckets.map(([bucket]) => `${bucket}.json`));
    for (const name of readdirSync(INDEX_DIR)) if (!keep.has(name)) unlinkSync(join(INDEX_DIR, name));
  }
  writeIfChanged(join(WRITING, "index.json"), JSON.stringify(buildIndexSummary(buckets, Object.keys(conversions.forms).length, heldForms.length)));

  if (flag("prune")) {
    const live = new Set(buckets.flatMap(([, forms]) => Object.keys(forms)));
    if (existsSync(MANIFEST_DIR)) {
      for (const name of readdirSync(MANIFEST_DIR)) if (!live.has(name.replace(/\.json$/, ""))) unlinkSync(join(MANIFEST_DIR, name));
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    conversions: Object.keys(conversions.forms).length,
    compiled: report.length, rewritten: written.length, skipped: skipped.length,
    scoped: report.filter(row => row.basis === "scope").length,
    fromBaseline: report.filter(row => row.basis === "baseline").length,
    publishedBaselines: baselines.size, registryForms: Object.keys(registry).length,
    previewNotExact: report.filter(row => !row.previewExact).map(row => row.formId),
    multiSection: report.filter(row => row.sections > 1).map(row => row.formId),
    forms: report, held: skipped, rebound, drift,
  };
  writeIfChanged(argument("report", REPORT_DEFAULT), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({
    conversions: summary.conversions, compiled: summary.compiled, rewritten: summary.rewritten,
    skipped: summary.skipped, scoped: summary.scoped, fromBaseline: summary.fromBaseline,
    publishedBaselines: summary.publishedBaselines, registryForms: summary.registryForms,
    rebound: rebound.length, drift: drift.length,
    previewNotExact: summary.previewNotExact.length, multiSection: summary.multiSection.length,
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
