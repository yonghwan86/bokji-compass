/**
 * 변환한 양식(HWPX)의 정해진 빈칸만 채워 작성본을 만든다.
 *
 * - 원본 HWP와 변환본은 절대 덮어쓰지 않는다. 새 이름(*_작성본.hwpx)으로 내려받게만 한다.
 * - 꾸러미를 열기 전에 바이트 수와 SHA-256을 manifest 값과 맞춰 본다. 다르면 작성하지 않는다.
 * - 쓰기로 한 자리의 원문(expect)이 다르면 비슷한 자리를 찾지 않고 바로 멈춘다.
 * - 서명 자리·동의 표시·기관 접수란(잠긴 자리)은 값을 받지 않는다.
 * - 스타일·표 구조·여백·글꼴·법률 본문은 건드리지 않는다. 허용된 글자 구간만 잘라 끼운다.
 * - 적은 값은 브라우저 메모리에서만 쓰인다. 어디에도 보내지 않는다.
 */
import { buildPaperPreviewText } from "./paperWritingPreview";
import { HwpxMismatchError, applyEdits, findParagraph, indexSection, paragraphInsertionStyle, replaceParagraphRanges, type ParagraphIndex, type SectionIndex, type ParagraphOp, type SourceEdit } from "./hwpxXml";
import { decodeUtf8, encodeUtf8, readHwpx, writeHwpx } from "./hwpxZip";
import { detailBucket } from "../data/bucket";
import { measurePaperSourceRange, measurePaperText, type PaperGlyphStyles, type PaperLineMetrics } from "./paperTextMetrics";
import {
  normalizePaperInput, paperSlotAtKey,
  type PaperAt, type PaperChecks, type PaperIndexEntry, type PaperIndexShard, type PaperManifest, type PaperNode, type PaperSlot, type PaperValues,
} from "../data/paperWritingTypes";

/** `[  ]` 안을 √로 바꿀 때, 원래 폭을 지키려고 공백 두 칸을 √ 한 글자로 바꾼다. */
const TICK = "√";
/** `□`는 같은 폭의 `■`로 바꾼다 — 한글 기본 글꼴에 모두 들어 있는 글자다. */
const FILLED = "■";

export interface PaperDocument {
  bytes: Uint8Array;
  fileName: string;
}

export interface PaperInput {
  values: PaperValues;
  checks: PaperChecks;
}

export const paperFileName = (manifest: PaperManifest): string => {
  const title = manifest.title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 100);
  return `${title || "신청서"}_작성본.hwpx`;
};

/**
 * 원본에 인쇄된 표시칸을 찾는 규칙.
 * 컴파일러(`scripts/build-paper-writing.ts`)와 작성기가 똑같은 규칙으로 세야
 * 모양별 차례(box)로 같은 자리를 다시 찾을 수 있다.
 */
export function findBoxes(text: string): { from: number; to: number; shape: "bracket" | "square"; box: number }[] {
  const out: { from: number; to: number; shape: "bracket" | "square"; box: number }[] = [];
  [...text.matchAll(/\[ *\]/g)].forEach((match, index) =>
    out.push({ from: match.index!, to: match.index! + match[0].length, shape: "bracket", box: index }));
  [...text.matchAll(/[□☐]/g)].forEach((match, index) =>
    out.push({ from: match.index!, to: match.index! + match[0].length, shape: "square", box: index }));
  return out.sort((a, b) => a.from - b.from);
}

/** 한글 문서(XML)에 넣을 수 없는 글자인지 본다. */
export function badPaperCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    // 짝이 맞지 않는 대리쌍(lone surrogate)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return true;                        // 제어문자
    if (code >= 0x80 && code <= 0x9f) return true;                        // C1 제어문자
    if ((code & 0xfffe) === 0xfffe) return true;                          // 각 평면의 비문자
    if (code >= 0xfdd0 && code <= 0xfdef) return true;                    // 비문자 구간
    if (code > 0xffff) return true;                                       // 한글 서식 글꼴 밖(보조 평면)
  }
  return false;
}

/** 적은 값이 원본 칸에 실제로 들어가는지 본다. 글자 수가 아니라 너비로 잰다. */
export function paperFieldError(slot: PaperSlot, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (slot.locked) return `${slot.label}은(는) ${slot.locked.reason}`;
  if (slot.kind === "check") return null;
  if (badPaperCharacter(value)) return `${slot.label}에 한글 문서로 옮길 수 없는 문자가 있어요. 한글·영문·숫자·기호로 적어 주세요.`;
  if (slot.token) {
    const numeric = /^\d+$/.test(value) ? Number(value) : NaN;
    const max = slot.token === "년" ? 9999 : slot.token === "월" ? 12 : 31;
    if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > max
      || (slot.token === "년" ? value.length !== 4 : value.length > 2)) {
      return slot.token === "년" ? "연도는 네 자리 숫자로 적어 주세요." : `${slot.label}은(는) 1부터 ${max} 사이 숫자로 적어 주세요.`;
    }
  }
  const width = slot.width ? measurePaperText(value, slot.width.styles) : null;
  if (width === null) return `${slot.label}의 글꼴 또는 글자 폭을 확인하지 못했어요. 공식 원본으로 작성해 주세요.`;
  if (width > slot.width!.available) {
    return slot.kind === "text"
      ? `${slot.label}은(는) 원본 서식 칸에 들어가는 만큼만 적을 수 있어요. 내용을 짧게 적어 주세요.`
      : `${slot.label}은(는) 원본이 비워 둔 자리에 들어가는 만큼만 적을 수 있어요. 내용을 짧게 적어 주세요.`;
  }
  return null;
}

function checkMark(slot: PaperSlot): ParagraphOp {
  const boxes = findBoxes(slot.expect).filter(box => box.shape === slot.boxShape);
  const found = boxes[slot.box ?? 0];
  if (!found) throw new HwpxMismatchError("원본 서식에서 표시칸을 찾지 못했습니다.");
  if (found.shape === "square") return { from: found.from, to: found.to, value: FILLED };
  const inner = found.to - found.from - 2;
  return { from: found.from, to: found.to, value: `[${TICK}${" ".repeat(Math.max(0, inner - 2))}]` };
}

function slotOp(slot: PaperSlot, value: string, metrics: PaperLineMetrics): ParagraphOp {
  if (slot.kind === "check") return checkMark(slot);
  if (slot.kind === "text") return { from: 0, to: slot.expect.length, value };
  const from = slot.from ?? 0;
  if (slot.kind === "prefix") {
    // 인쇄된 글자를 지우지 않고 그 앞에만 끼워 넣는다. 뒤에 올 글자가 다르면 멈춘다.
    const after = slot.after ?? "";
    if (!after || slot.to !== from || slot.expect.slice(from, from + after.length) !== after) {
      throw new HwpxMismatchError("원본 서식의 글자 자리가 분석해 둔 것과 다릅니다.");
    }
    return { from, to: from, value };
  }
  const to = slot.to ?? 0;
  const room = to - from;
  const pad = slot.pad ?? " ";
  const blank = slot.expect.slice(from, to);
  if (blank.length !== room || [...blank].some(char => char !== pad)) {
    throw new HwpxMismatchError("원본 서식의 빈칸 자리가 분석해 둔 것과 다릅니다.");
  }
  // 원본이 비워 둔 자리의 너비를 넘지 않는 동안에는 채움 문자를 덜어 내 줄 길이를 지킨다.
  // 넘칠 때는 채움을 모두 비우고, 늘어난 너비가 원본 칸에 들어가는지 문단 단위로 다시 본다.
  const room10 = measurePaperSourceRange(slot.expect, metrics, from, to);
  const used = slot.width ? measurePaperText(value, slot.width.styles) : null;
  const padWidth = slot.width ? measurePaperText(pad, slot.width.styles) : null;
  if (room10 === null || used === null || padWidth === null) throw new HwpxMismatchError("원본 빈칸의 글꼴 폭을 확인할 수 없습니다.");
  const fill = pad.repeat(used >= room10 || padWidth <= 0 ? 0 : Math.floor((room10 - used) / padWidth));
  return { from, to, value: slot.align === "right" ? fill + value : value + fill };
}

const sectionNumber = (name: string): number => Number(/(\d+)/.exec(name)![1]);

function paragraphAt(index: SectionIndex, at: PaperAt): ParagraphIndex {
  if (at.table === null) {
    const paragraph = index.body[at.p];
    if (!paragraph) throw new HwpxMismatchError("원본 서식의 본문 줄을 찾지 못했습니다.");
    return paragraph;
  }
  return findParagraph(index, at.table, at.row, at.col, at.p);
}

/** 한 섹션의 본문을 채운다. 쓸 자리가 없으면 원본 글자를 그대로 돌려준다. */
export function buildFilledPaperSection(manifest: PaperManifest, section: number, sectionXml: string, raw: PaperInput): string {
  const info = manifest.sections.find(entry => sectionNumber(entry.name) === section);
  if (!info) throw new HwpxMismatchError("분석해 둔 적 없는 본문입니다.");
  const index = indexSection(sectionXml);
  if (index.tableCount !== info.tableCount || index.paragraphCount !== info.paragraphCount) {
    throw new HwpxMismatchError("원본 서식의 구성이 분석해 둔 것과 달라 작성을 멈췄습니다.");
  }
  const { values, checks } = normalizePaperInput(manifest, raw.values, raw.checks);

  // 같은 날짜 줄의 세 칸을 모두 적었을 때에는 실제 달력에 있는 날인지도 확인한다.
  const dates = new Map<string, PaperSlot[]>();
  for (const slot of Object.values(manifest.slots)) {
    if (slot.at.section !== section || slot.locked || !slot.token) continue;
    const key = paperSlotAtKey(slot.at);
    dates.set(key, [...(dates.get(key) ?? []), slot]);
  }
  const validateDate = (date: Partial<Record<"년" | "월" | "일", number>>) => {
    if (date.년 && date.월 && date.일) {
      const parsed = new Date(Date.UTC(date.년, date.월 - 1, date.일));
      if (parsed.getUTCFullYear() !== date.년 || parsed.getUTCMonth() !== date.월 - 1 || parsed.getUTCDate() !== date.일) {
        throw new HwpxMismatchError("날짜가 달력에 있는 날인지 확인해 주세요.");
      }
    }
  };
  for (const slots of dates.values()) {
    let date: Partial<Record<"년" | "월" | "일", number>> = {};
    for (const slot of slots.sort((a, b) => (a.from ?? 0) - (b.from ?? 0))) {
      // 기간처럼 같은 줄에 날짜가 둘 이상 있어도 앞 날짜를 덮어쓰지 않는다.
      if (slot.token === "년" || date[slot.token!] !== undefined) { validateDate(date); date = {}; }
      if (values[slot.id]) date[slot.token!] = Number(values[slot.id]);
    }
    validateDate(date);
  }

  // 같은 문단을 여러 번 고치는 경우가 있어 문단별로 모아 한꺼번에 처리한다.
  const byParagraph = new Map<string, { at: PaperAt; expect: string; ops: (ParagraphOp & { styles: PaperGlyphStyles })[] }>();
  for (const slot of Object.values(manifest.slots)) {
    if (slot.at.section !== section || slot.locked) continue;
    const value = slot.kind === "check" ? (checks[slot.id] ? "√" : "") : (values[slot.id] ?? "");
    if (!value) continue;
    const problem = paperFieldError(slot, value);
    if (problem) throw new HwpxMismatchError(problem);
    const paragraph = paragraphAt(index, slot.at);
    if (paragraph.text !== slot.expect) {
      throw new HwpxMismatchError("원본 서식의 내용이 분석해 둔 것과 달라 작성을 멈췄습니다.");
    }
    const key = paperSlotAtKey(slot.at);
    const metrics = manifest.lineMetrics?.[key];
    if (!metrics || !slot.width) throw new HwpxMismatchError("원본 칸의 글꼴 폭 분석이 없어 작성을 멈췄습니다.");
    const box = slot.kind === "check" ? findBoxes(slot.expect).filter(box => box.shape === slot.boxShape)[slot.box ?? 0] : null;
    const insertion = slot.kind === "check" ? box?.from : slot.kind === "text" ? 0 : slot.from;
    const end = slot.kind === "check" ? box?.to : slot.kind === "text" ? slot.expect.length : slot.to;
    if (insertion === undefined || end === undefined || paragraphInsertionStyle(paragraph, insertion, end) !== slot.width.charPrIDRef) {
      throw new HwpxMismatchError("입력 위치의 글꼴이 분석 기록과 달라 작성을 멈췄습니다.");
    }
    const bucket = byParagraph.get(key) ?? { at: slot.at, expect: slot.expect, ops: [] };
    bucket.ops.push({ ...slotOp(slot, slot.kind === "check" ? "" : value, metrics), styles: slot.width.styles });
    byParagraph.set(key, bucket);
  }

  const edits: SourceEdit[] = [];
  for (const [key, bucket] of byParagraph) {
    // 표시칸을 채우면 줄이 한 칸 늘어날 수 있다 — 원본 칸을 넘지 않는지 본다.
    const metrics = manifest.lineMetrics![key];
    let grown = measurePaperSourceRange(bucket.expect, metrics);
    if (grown === null) throw new HwpxMismatchError("원본 문장의 글꼴 폭을 확인할 수 없습니다.");
    for (const op of bucket.ops) {
      const removed = measurePaperSourceRange(bucket.expect, metrics, op.from, op.to);
      const inserted = measurePaperText(op.value, op.styles);
      if (removed === null || inserted === null) throw new HwpxMismatchError("작성 결과의 글꼴 폭을 확인할 수 없습니다.");
      grown += inserted - removed;
    }
    if (grown > metrics.available) throw new HwpxMismatchError("적은 내용이 원본 칸보다 넓어 저장하지 않았습니다.");
    edits.push(...replaceParagraphRanges(paragraphAt(index, bucket.at), bucket.ops));
  }
  const filled = applyEdits(sectionXml, edits);
  const after = indexSection(filled);
  if (after.tableCount !== info.tableCount || after.paragraphCount !== info.paragraphCount) {
    throw new HwpxMismatchError("작성 결과의 문단·표 수가 원본과 달라 저장하지 않았습니다.");
  }
  return filled;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map(part => part.toString(16).padStart(2, "0")).join("");
}

/**
 * 변환한 양식에 적은 값을 넣어 작성본을 만든다.
 *
 * 낡은 빈 원본 그림(`Preview/PrvImage.png`)은 지운다 — 어느 선언 파일에도 들어 있지 않아
 * 규격상 안전하다. `Preview/PrvText.txt`는 `META-INF/container.xml`이 가리키는 항목이라
 * 반드시 남기고, 완성된 본문에서 다시 만들어 넣는다.
 */
export async function buildFilledPaper(manifest: PaperManifest, assetBytes: Uint8Array, input: PaperInput): Promise<PaperDocument> {
  if (assetBytes.byteLength !== manifest.asset.bytes) {
    throw new HwpxMismatchError("받아 온 양식 파일의 크기가 등록된 값과 다릅니다.");
  }
  if ((await sha256Hex(assetBytes)) !== manifest.asset.sha256) {
    throw new HwpxMismatchError("받아 온 양식 파일이 등록된 변환본과 다릅니다.");
  }
  const pkg = readHwpx(assetBytes);
  const actualSections = pkg.order.filter(name => /^Contents\/section\d+\.xml$/.test(name)).sort();
  const expectedSections = manifest.sections.map(info => info.name).sort();
  if (JSON.stringify(actualSections) !== JSON.stringify(expectedSections)) {
    throw new HwpxMismatchError("양식 파일의 본문 목록이 분석 기록과 다릅니다.");
  }
  const sections: SectionIndex[] = [];
  for (const info of manifest.sections) {
    if (!pkg.files[info.name]) throw new HwpxMismatchError("양식 파일에 본문이 없습니다.");
    const filled = buildFilledPaperSection(manifest, sectionNumber(info.name), decodeUtf8(pkg.files[info.name]), input);
    pkg.files[info.name] = encodeUtf8(filled);
    sections.push(indexSection(filled));
  }
  if (pkg.files[manifest.preview.textEntry]) {
    pkg.files[manifest.preview.textEntry] = encodeUtf8(buildPaperPreviewText(sections, manifest.preview.limit));
  }
  const dropped = new Set(manifest.preview.dropEntries);
  for (const name of dropped) {
    // 원본마다 리소스 선언이 다를 수 있으므로 컴파일러의 가정에만 기대지 않는다.
    for (const [entry, data] of Object.entries(pkg.files)) {
      if (/\.(?:xml|hpf)$/i.test(entry) && decodeUtf8(data).includes(name)) {
        throw new HwpxMismatchError("미리보기 그림을 참조하는 양식이라 작성본을 만들 수 없습니다. 공식 원본을 이용해 주세요.");
      }
    }
  }
  const order = pkg.order.filter(name => !dropped.has(name));
  const files: Record<string, Uint8Array> = {};
  for (const name of order) files[name] = pkg.files[name];
  return { bytes: writeHwpx({ order, files }), fileName: paperFileName(manifest) };
}

/* ── 공개 자료 읽기 ──────────────────────────────────────────────── */

export const FORM_ID = /^(?:ordin|law|rule)-\d{1,20}$|^agency-\d{5}-[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export const CONVERTED = /^\/forms\/writing\/v1\/converted\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,120}-[a-f0-9]{12}\.hwpx$/;
const MANIFEST = /^\/forms\/writing\/v1\/manifest\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,120}\.json$/;
export const hex64 = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export const convertedPath = (formId: string, sourceSha: string, assetSha: string) =>
  `/forms/writing/v1/converted/${formId}-${sourceSha.slice(0, 12)}-${assetSha.slice(0, 12)}.hwpx`;

export const paperFormIdIsValid = (value: string) => FORM_ID.test(value);

const cache = new Map<string, Promise<unknown | null>>();
export async function getJson<T>(path: string): Promise<T | null> {
  if (!cache.has(path)) {
    const request = fetch(path, { signal: AbortSignal.timeout(15000) })
      .then(response => (response.ok ? response.json() : null))
      .then((data: unknown) => ((data as { schema?: number })?.schema === 1 ? (data as T) : null))
      .catch(() => null)
      .then(data => { if (!data) cache.delete(path); return data; });
    cache.set(path, request as Promise<unknown | null>);
  }
  return cache.get(path) as Promise<T | null>;
}

/** 작성 버튼 게이트용 — 그 서식의 원본·변환본 신원만 들어 있다. */
export function loadPaperIndexShard(bucket: string): Promise<PaperIndexShard | null> {
  if (!/^[0-9a-f]{2}$/.test(bucket)) return Promise.resolve(null);
  return getJson<PaperIndexShard>(`/forms/writing/v1/index/${bucket}.json`);
}

/**
 * 그 사업에 연결된 서식들의 변환 기록. 쓰이는 샤드만 받는다.
 * 한 서식이라도 읽지 못하면 그 서식은 결과에 들어가지 않는다 — 작성 버튼이 나오지 않는다.
 */
export async function loadPaperEntries(formIds: string[]): Promise<Record<string, PaperIndexEntry>> {
  const wanted = formIds.filter(formId => FORM_ID.test(formId));
  const buckets = [...new Set(wanted.map(detailBucket))];
  const shards = await Promise.all(buckets.map(loadPaperIndexShard));
  const out: Record<string, PaperIndexEntry> = {};
  for (const shard of shards) {
    if (!shard || !/^[0-9a-f]{2}$/.test(shard.bucket)) continue;
    for (const formId of wanted) {
      const entry = shard.forms?.[formId];
      if (!entry || detailBucket(formId) !== shard.bucket) continue;
      if (entry.source?.format !== "hwp" || !hex64(entry.source.sha256) || !positive(entry.source.bytes)) continue;
      if (!entry.asset || !hex64(entry.asset.sha256) || !positive(entry.asset.bytes) || !CONVERTED.test(entry.asset.path)) continue;
      if (entry.asset.path !== convertedPath(formId, entry.source.sha256, entry.asset.sha256)) continue;
      if (entry.manifest !== `/forms/writing/v1/manifest/${formId}.json` || !hex64(entry.manifestSha256)) continue;
      if (!positive(entry.slotCount)) continue;
      out[formId] = entry;
    }
  }
  return out;
}

/** 꼭 필요한 값이 모두 들어 있고 서로 묶여 있는 manifest만 받아들인다. */
/**
 * 그 사업에서 쓸 수 있는 자리만 남긴다. 사업별 검토표가 있는 서식은 해당 사업에서만 열리고,
 * 연결되지 않은 사업이나 다른 사업의 칸은 주소를 직접 넣어도 받지 않는다.
 */
export function scopeManifestToProgram(manifest: PaperManifest, programId: string | null): PaperManifest | null {
  if (!manifest.programmeIds?.length) return manifest;
  if (!programId || !manifest.programmeIds.includes(programId)) return null;
  const allowed = new Set(manifest.programmeSlots?.[programId] ?? []);
  if (!allowed.size) return null;
  const slots = Object.fromEntries(Object.entries(manifest.slots)
    .filter(([id, slot]) => slot.locked || allowed.has(id)));
  // 검토표가 가리킨 자리가 하나라도 실제로 없으면 그 사업의 화면을 열지 않는다.
  for (const id of allowed) if (!manifest.slots[id] || manifest.slots[id].locked) return null;
  // 다른 사업의 입력칸을 숨겨도 그 자리에 인쇄된 □·괄호·공백은 남긴다.
  // 저장 대상은 위에서 제한한 slots뿐이며 원본 양식 보기는 원문을 유지한다.
  const originalText = (slot: PaperSlot): string => {
    if (slot.kind === "text") return slot.expect;
    if (slot.kind === "prefix") return "";
    if (slot.kind === "inline") return slot.expect.slice(slot.from, slot.to);
    const box = findBoxes(slot.expect).filter(item => item.shape === slot.boxShape)[slot.box ?? 0];
    return box ? slot.expect.slice(box.from, box.to) : "";
  };
  const printed = (nodes: PaperNode[]): PaperNode[] => nodes.map(node => node.kind === "table"
    ? { ...node, rows: node.rows.map(row => row.map(cell => ({ ...cell, nodes: printed(cell.nodes) }))) }
    : { ...node, segments: node.segments.map(segment => segment.kind === "slot" && !slots[segment.id] && manifest.slots[segment.id]
      ? { kind: "text" as const, text: originalText(manifest.slots[segment.id]) } : segment) });
  return { ...manifest, slots, blocks: printed(manifest.blocks) };
}

export function validPaperManifest(value: unknown, formId: string): PaperManifest | null {
  const row = value as PaperManifest | null;
  if (!row || typeof row !== "object" || row.schema !== 1 || row.formId !== formId) return null;
  if (!FORM_ID.test(row.formId) || typeof row.title !== "string" || !row.title.trim()) return null;
  if (!row.source || row.source.format !== "hwp" || !hex64(row.source.sha256) || !positive(row.source.bytes)) return null;
  if (!row.asset || !hex64(row.asset.sha256) || !positive(row.asset.bytes) || !CONVERTED.test(row.asset.path)) return null;
  if (row.asset.path !== convertedPath(formId, row.source.sha256, row.asset.sha256)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.checkedAt) || !positive(row.pageCount)) return null;
  if (!Array.isArray(row.sections) || !row.sections.length) return null;
  if (row.sections.some(info => !/^Contents\/section\d+\.xml$/.test(info.name)
    || !Number.isSafeInteger(info.tableCount) || !positive(info.paragraphCount))) return null;
  if (!row.preview || row.preview.textEntry !== "Preview/PrvText.txt"
    || (row.preview.limit !== null && !positive(row.preview.limit))
    || !Array.isArray(row.preview.dropEntries) || row.preview.dropEntries.some(name => name !== "Preview/PrvImage.png")) return null;
  if (!Array.isArray(row.blocks) || !row.slots || typeof row.slots !== "object" || !row.capacities || !row.lineMetrics) return null;
  // 사업별 검토표가 실려 있으면 그 모양이 온전해야 한다.
  if (row.programmeIds !== undefined || row.programmeSlots !== undefined) {
    const ids = row.programmeIds, map = row.programmeSlots;
    if (!Array.isArray(ids) || !ids.length || !map || typeof map !== "object") return null;
    if (ids.some(id => typeof id !== "string" || !id.trim() || !Array.isArray(map[id]) || !map[id].length)) return null;
    if (Object.keys(map).length !== ids.length) return null;
    for (const id of ids) if (map[id].some(slotId => typeof slotId !== "string" || !row.slots[slotId])) return null;
  }
  const sections = new Set(row.sections.map(info => sectionNumber(info.name)));
  for (const [id, slot] of Object.entries(row.slots)) {
    if (slot.id !== id || !sections.has(slot.at.section) || typeof slot.expect !== "string"
      || typeof slot.label !== "string" || !slot.label.trim()
      || !Number.isSafeInteger(slot.budget) || slot.budget < 0) return null;
    if (slot.kind === "inline" && !(typeof slot.from === "number" && typeof slot.to === "number"
      && slot.from >= 0 && slot.to > slot.from && slot.to <= slot.expect.length
      && (slot.pad === " " || slot.pad === "_")
      && [...slot.expect.slice(slot.from, slot.to)].every(char => char === slot.pad))) return null;
    // 끼워 쓰는 자리는 지우는 범위가 없어야 하고(from === to), 바로 뒤 원문이 실제로 그 글자여야 한다.
    if (slot.kind === "prefix" && !(typeof slot.from === "number" && slot.to === slot.from
      && slot.from >= 0 && typeof slot.after === "string" && slot.after.length > 0
      && slot.expect.slice(slot.from, slot.from + slot.after.length) === slot.after
      && slot.token !== undefined)) return null;
    if (slot.kind === "check" && !(Number.isSafeInteger(slot.box) && (slot.box ?? -1) >= 0
      && (slot.boxShape === "bracket" || slot.boxShape === "square"))) return null;
    if (slot.kind === "text" && !/^ *$/.test(slot.expect)) return null;
    if (!["text", "inline", "prefix", "check"].includes(slot.kind)) return null;
    if (!slot.locked) {
      const metrics = row.lineMetrics[paperSlotAtKey(slot.at)];
      if (!slot.width || !Number.isFinite(slot.width.available) || slot.width.available < 0
        || !Number.isSafeInteger(slot.width.charPrIDRef)
        || !slot.width.styles || !metrics || !Number.isFinite(metrics.available) || metrics.available <= 0
        || !Array.isArray(metrics.runs)) return null;
    }
  }
  return row;
}

export async function loadPaperManifest(formId: string): Promise<PaperManifest | null> {
  if (!FORM_ID.test(formId)) return null;
  const entry = (await loadPaperEntries([formId]))[formId];
  if (!entry) return null;
  const path = `/forms/writing/v1/manifest/${formId}.json`;
  if (!MANIFEST.test(path)) return null;
  try {
    const response = await fetch(path, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await sha256Hex(bytes) !== entry.manifestSha256) return null;
    const manifest = validPaperManifest(JSON.parse(decodeUtf8(bytes)), formId);
    if (!manifest || manifest.source.path !== entry.source.path || manifest.source.bytes !== entry.source.bytes
      || manifest.source.sha256 !== entry.source.sha256 || manifest.asset.path !== entry.asset.path
      || manifest.asset.bytes !== entry.asset.bytes || manifest.asset.sha256 !== entry.asset.sha256) return null;
    return manifest;
  } catch { return null; }
}

/** 변환한 양식만 받아 온다. 작성한 값은 이 요청에 들어가지 않는다. */
export async function fetchPaperAsset(manifest: PaperManifest): Promise<Uint8Array> {
  if (!CONVERTED.test(manifest.asset.path)) throw new HwpxMismatchError("양식 파일 주소가 올바르지 않습니다.");
  const response = await fetch(manifest.asset.path, { cache: "force-cache", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("작성용 양식 파일을 받지 못했습니다.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== manifest.asset.bytes) throw new HwpxMismatchError("받아 온 양식 파일의 크기가 등록된 값과 다릅니다.");
  if ((await sha256Hex(bytes)) !== manifest.asset.sha256) throw new HwpxMismatchError("받아 온 양식 파일이 등록된 변환본과 다릅니다.");
  return bytes;
}
