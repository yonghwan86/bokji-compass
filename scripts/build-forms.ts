/** Build independent form overlays from committed public data; never rebuild welfare bundles. */
import { mkdir, readdir, readFile, writeFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { crc32, inflateRawSync } from "node:zlib";
import type { Program } from "../src/lib/data/types";
import type { ApplicationForm, FormFileFormat, FormLink, FormsRegion, FormsCoverage, ProgramFormEntry, FormStatus } from "../src/lib/data/forms";
import { normalizeCensus, censusLinkConflict } from "../src/lib/data/forms";
import { classifyFormRole, findFormCandidates } from "../src/lib/data/formMatching";
import { applicationRoute, formStatus, foundAttachmentSignal, validateFormLink, externalFormUrl, officialFormUrl, registeredAgencyForm, validateAgencyForm, type VerifiedAgencyForm } from "../src/lib/data/formPublication";
import { detailBucket } from "../src/lib/data/bucket";

export interface DownloadRecord {
  format: FormFileFormat; path: string; bytes: number; sha256: string; sourceUrl: string; downloadedAt: string;
  finalUrl?: string;
  pdf?: { path: string; bytes: number; sha256: string; sourceUrl: string };
  archive?: { path: string; bytes: number; sha256: string; member: string };
}
export interface DownloadManifest { schema: 1; forms: Record<string, DownloadRecord> }
export interface StoredOriginal { bytes: Buffer; format: FormFileFormat; pdf?: Buffer }
const digestOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const recordObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Match the downloader's exact endpoints and unambiguous attachment identity. */
function officialDownloadUrl(value: unknown): string | null {
  const safe = officialFormUrl(value);
  if (!safe) return null;
  const url = new URL(safe), ids = url.searchParams.getAll("flSeq");
  return ["/flDownload.do", "/LSW/flDownload.do", "/LSW/flDownloadPdf.do"].includes(url.pathname)
    && ids.length === 1 && /^\d+$/.test(ids[0]) ? safe : null;
}

function archivedMember(archive: Buffer, expectedName: string): Buffer {
  const end=archive.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if (end<0 || end+22>archive.length || end+22+archive.readUInt16LE(end+20)!==archive.length) throw new Error("Invalid source archive directory");
  let position=archive.readUInt32LE(end+16);
  const count=archive.readUInt16LE(end+10), limit=position+archive.readUInt32LE(end+12), found: Buffer[]=[];
  if (!count || limit>end) throw new Error("Invalid source archive directory");
  for (let index=0;index<count;index++) {
    if (position+46>limit || archive.readUInt32LE(position)!==0x02014b50) throw new Error("Invalid source archive member");
    const flags=archive.readUInt16LE(position+8), method=archive.readUInt16LE(position+10), size=archive.readUInt32LE(position+20);
    const nameLength=archive.readUInt16LE(position+28), next=position+46+nameLength+archive.readUInt16LE(position+30)+archive.readUInt16LE(position+32);
    if (next>limit) throw new Error("Invalid source archive member");
    const name=new TextDecoder(flags&0x800?"utf-8":"euc-kr",{fatal:true}).decode(archive.subarray(position+46,position+46+nameLength));
    if (name===expectedName) {
      const local=archive.readUInt32LE(position+42), expanded=archive.readUInt32LE(position+24);
      if (flags&1 || expanded>30*1024*1024 || local+30>position || archive.readUInt32LE(local)!==0x04034b50) throw new Error("Invalid source archive member");
      const start=local+30+archive.readUInt16LE(local+26)+archive.readUInt16LE(local+28);
      if (start+size>position) throw new Error("Invalid source archive member");
      const compressed=archive.subarray(start,start+size);
      const bytes=method===0?compressed:method===8?inflateRawSync(compressed,{maxOutputLength:30*1024*1024}):null;
      if (!bytes || bytes.length!==expanded) throw new Error("Unsupported source archive member");
      found.push(bytes);
    }
    position=next;
  }
  if (position!==limit || found.length!==1) throw new Error("Missing or ambiguous source archive member");
  return found[0];
}

export function validateDownloadManifest(value: unknown): DownloadManifest {
  if (!recordObject(value) || value.schema !== 1 || !recordObject(value.forms)) throw new Error("Invalid download manifest schema");
  for (const [id, entry] of Object.entries(value.forms)) {
    const agency=registeredAgencyForm(id);
    // An image original is only ever a registered agency attachment; the law
    // portal keeps exactly the formats it already had.
    const formats=agency?["hwp", "hwpx", "pdf", "jpg", "png"]:["hwp", "hwpx", "pdf", "txt", "gif"];
    if ((!/^(ordin|law|rule)-\d+$/.test(id) && !agency) || !recordObject(entry) || !formats.includes(String(entry.format))) throw new Error("Invalid downloaded form id/format");
    if (agency && (entry.sourceUrl!==agency.sourceUrl || entry.finalUrl!==agency.finalUrl || entry.sha256!==agency.sha256
        || entry.bytes!==agency.bytes || entry.format!==agency.format || entry.pdf!==undefined || entry.archive!==undefined)) throw new Error("Agency download identity mismatch: "+id);
    if (entry.path !== `originals/${id}.${entry.format}`) throw new Error("Downloaded original path/id mismatch: " + id);
    for (const file of [entry, ...(entry.pdf === undefined ? [] : [entry.pdf]), ...(entry.archive === undefined ? [] : [entry.archive])]) {
      if (!recordObject(file) || !Number.isSafeInteger(file.bytes) || Number(file.bytes) <= 0 || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid download bytes/hash: " + id);
    }
    if (entry.pdf !== undefined) {
      const pdf=entry.pdf as Record<string,unknown>;
      if (pdf.path !== `previews/${id}.pdf`) throw new Error("Downloaded PDF path/id mismatch: " + id);
      if (!officialDownloadUrl(pdf.sourceUrl)) throw new Error("Invalid official PDF source: "+id);
    }
    if (entry.archive !== undefined) {
      const archive = entry.archive as Record<string, unknown>;
      if (archive.path !== `source-archives/${id}.zip` || typeof archive.member !== "string" || !/\.hwpx?$/i.test(archive.member)) throw new Error("Invalid source archive/member: " + id);
    }
    if (!agency && !officialDownloadUrl(entry.sourceUrl)) throw new Error("Downloaded source must be an official attachment: " + id);
    if (typeof entry.downloadedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(entry.downloadedAt) || !Number.isFinite(Date.parse(entry.downloadedAt))) throw new Error("Invalid download timestamp: " + id);
  }
  return value as unknown as DownloadManifest;
}

/**
 * PNG 원본의 실제 프레임. 이미지를 다시 그리지 않고 청크 구조만 읽는다.
 * 서명·IHDR(위치·길이·크기)·IDAT 존재·IEND 종료·잘림·CRC를 확인하고, 애니메이션(acTL)은
 * 한 장 원본이 아니므로 받지 않는다. CRC는 Node 기본 zlib.crc32 를 쓰고 표를 따로 만들지 않는다.
 */
export function pngFrame(bytes: Buffer): { width: number; height: number } {
  const invalid = () => new Error("Invalid PNG original");
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) throw invalid();
  let position = 8, frame: { width: number; height: number } | undefined, data = false;
  while (position + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(position);
    if (length > 0x7fffffff || position + 12 + length > bytes.length) throw invalid();
    const type = bytes.subarray(position + 4, position + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type)) throw invalid();
    const chunk = bytes.subarray(position + 4, position + 8 + length);
    if (crc32(chunk) !== bytes.readUInt32BE(position + 8 + length)) throw invalid();
    if (type === "IHDR") {
      if (frame || length !== 13 || position !== 8) throw invalid();
      const width = chunk.readUInt32BE(4), height = chunk.readUInt32BE(8);
      if (!width || !height || width * height > 50_000_000) throw invalid();
      frame = { width, height };
    } else if (type === "acTL") throw invalid();
    else if (type === "IDAT") { if (!frame) throw invalid(); data = true; }
    else if (type === "IEND") {
      if (length !== 0 || position + 12 !== bytes.length || !frame || !data) throw invalid();
      return frame;
    }
    position += 12 + length;
  }
  throw invalid();
}

/**
 * Walk the actual JPEG markers to the one frame header. This reads the image's
 * own structure only; whether the form is blank stays with the registered
 * whole-image review that these dimensions are checked against.
 */
export function jpegFrame(bytes: Buffer): { width: number; height: number } {
  const invalid = () => new Error("Invalid JPEG original");
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw invalid();
  const frames: { width: number; height: number }[] = [];
  let position = 2;
  while (position + 2 <= bytes.length) {
    if (bytes[position] !== 0xff) throw invalid();
    let marker = bytes[position + 1];
    position += 2;
    while (marker === 0xff && position < bytes.length) marker = bytes[position++]; // fill bytes
    if (marker === 0xd9 || marker === 0xda) break; // end, or entropy-coded scan data
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // standalone markers
    if (position + 2 > bytes.length) throw invalid();
    const length = bytes.readUInt16BE(position);
    if (length < 2 || position + length > bytes.length) throw invalid();
    // SOF0..SOF15, excluding the DHT/JPG/DAC markers that share the range.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) throw invalid();
      frames.push({ height: bytes.readUInt16BE(position + 3), width: bytes.readUInt16BE(position + 5) });
    }
    position += length;
  }
  if (frames.length !== 1 || !frames[0].width || !frames[0].height || frames[0].width * frames[0].height > 50_000_000) throw invalid();
  return frames[0];
}

/**
 * Walk the actual cross-reference table and page tree to the number of pages.
 * This reads the document's own structure only; whether every rendered page is
 * a blank applicant form stays with the registered whole-original review that
 * this count is checked against. Cross-reference streams are not read here, so
 * a PDF this cannot account for fails instead of being counted loosely.
 */
export function pdfPageCount(bytes: Buffer): number {
  const invalid = () => new Error("Invalid PDF page structure");
  const text = bytes.toString("latin1");
  const marker = text.lastIndexOf("startxref");
  if (!text.startsWith("%PDF-") || !text.includes("%%EOF") || marker < 0) throw invalid();
  const offsets = new Map<number, number>(), sections = new Set<number>();
  let trailer = "", next: number | null = Number(/^[ \t\r\n]*(\d+)[ \t\r\n]/.exec(text.slice(marker + 9, marker + 40))?.[1]);
  while (next !== null) {
    const position: number = next;
    if (!Number.isSafeInteger(position) || position <= 0 || position >= text.length || sections.has(position)) throw invalid();
    sections.add(position);
    const table = /^[ \t\r\n]*xref[ \t]*\r?\n/.exec(text.slice(position, position + 24));
    if (!table) throw invalid();
    let cursor = position + table[0].length;
    for (;;) {
      const head = /^(\d+)[ \t]+(\d+)[ \t]*\r?\n/.exec(text.slice(cursor, cursor + 48));
      if (!head) break;
      cursor += head[0].length;
      const first = Number(head[1]);
      for (let index = 0; index < Number(head[2]); index++) {
        const row = /^(\d{10})[ \t]+(\d{5})[ \t]+([nf])[ \t]*\r?\n?/.exec(text.slice(cursor, cursor + 24));
        if (!row) throw invalid();
        // The newest table wins; older sections only fill objects it leaves out.
        if (row[3] === "n" && !offsets.has(first + index)) offsets.set(first + index, Number(row[1]));
        cursor += row[0].length;
      }
    }
    const end = text.indexOf("trailer", cursor);
    if (end < 0) throw invalid();
    const dictionary = text.slice(end, end + 4096);
    if (/\/XRefStm/.test(dictionary)) throw invalid();
    if (!trailer) trailer = dictionary;
    const previous = /\/Prev[ \t\r\n]+(\d+)/.exec(dictionary);
    next = previous ? Number(previous[1]) : null;
  }
  const reference = (dictionary: string, key: string) => Number(new RegExp(`/${key}[ \t\r\n]+(\\d+)[ \t\r\n]+\\d+[ \t\r\n]+R`).exec(dictionary)?.[1]);
  const body = (number: number) => {
    const offset = Number.isSafeInteger(number) ? offsets.get(number) : undefined;
    if (offset === undefined || offset <= 0 || offset >= text.length) throw invalid();
    const header = new RegExp(`^${number}[ \t\r\n]+\\d+[ \t\r\n]+obj`).exec(text.slice(offset, offset + 48));
    const close = text.indexOf("endobj", offset);
    if (!header || close < 0) throw invalid();
    return text.slice(offset + header[0].length, close);
  };
  const catalog = body(reference(trailer, "Root"));
  const root = reference(catalog, "Pages"), queue = [root], counted = new Set<number>();
  let pages = 0;
  const declared = Number(/\/Count[ \t\r\n]+(\d+)/.exec(body(root))?.[1]);
  while (queue.length) {
    const number = queue.shift()!;
    if (counted.has(number) || counted.size > 5000) throw invalid();
    counted.add(number);
    const node = body(number);
    if (/\/Type[ \t\r\n]*\/Page(?![a-zA-Z])/.test(node)) { pages++; continue; }
    if (!/\/Type[ \t\r\n]*\/Pages(?![a-zA-Z])/.test(node)) throw invalid();
    const kids = /\/Kids[ \t\r\n]*\[([^\]]*)\]/.exec(node);
    const children = [...(kids?.[1] ?? "").matchAll(/(\d+)[ \t\r\n]+\d+[ \t\r\n]+R/g)].map(match => Number(match[1]));
    if (!children.length) throw invalid();
    queue.push(...children);
  }
  if (!pages || !Number.isSafeInteger(declared) || declared !== pages) throw invalid();
  return pages;
}

/** The downloader checks ZIP CRC/XML fully. Recheck the signed bytes and basic container identity here. */
export function validateOriginalFile(bytes: Buffer, format: FormFileFormat): void {
  if (format === "hwp") {
    const legacy=Buffer.from("HWP Document File V3.00 ");
    if (bytes.subarray(0,legacy.length).equals(legacy) && bytes.length>128) return;
    if (bytes.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1" || !bytes.includes(Buffer.from("HWP Document File"))) throw new Error("Invalid HWP signature");
    return;
  }
  if (format === "pdf") {
    if (bytes.subarray(0,5).toString()!=="%PDF-" || !bytes.includes(Buffer.from("%%EOF"))) throw new Error("Invalid PDF original");
    return;
  }
  if (format === "gif") {
    if (bytes.length<14 || !["GIF87a","GIF89a"].includes(bytes.subarray(0,6).toString()) || !bytes.readUInt16LE(6) || !bytes.readUInt16LE(8) || bytes[bytes.length-1]!==0x3b) throw new Error("Invalid GIF original");
    return;
  }
  if (format === "jpg") { jpegFrame(bytes); return; }
  if (format === "png") { pngFrame(bytes); return; }
  if (format === "txt") {
    let text: string;
    try { text=new TextDecoder("utf-8",{fatal:true}).decode(bytes); }
    catch { text=new TextDecoder("euc-kr",{fatal:true}).decode(bytes); }
    if (text.trim().length<10 || /[\u0000-\u0008\u000e-\u001f]/.test(text) || /<!doctype|<html|<script/i.test(text)) throw new Error("Invalid TXT original");
    return;
  }
  try {
    if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) throw new Error();
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0 || end + 22 > bytes.length || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) throw new Error();
    let position = bytes.readUInt32LE(end + 16), mime = false, section = false;
    const count = bytes.readUInt16LE(end + 10), directoryEnd = position + bytes.readUInt32LE(end + 12);
    if (!count || directoryEnd > end) throw new Error();
    for (let index = 0; index < count; index++) {
      if (position + 46 > directoryEnd || bytes.readUInt32LE(position) !== 0x02014b50) throw new Error();
      const nameLength = bytes.readUInt16LE(position + 28);
      const next = position + 46 + nameLength + bytes.readUInt16LE(position + 30) + bytes.readUInt16LE(position + 32);
      if (next > directoryEnd) throw new Error();
      const name = bytes.subarray(position + 46, position + 46 + nameLength).toString("utf8");
      if (/^Contents\/section\d+\.xml$/.test(name) && bytes.readUInt32LE(position + 24) > 0) section = true;
      if (name === "mimetype") {
        const local = bytes.readUInt32LE(position + 42), size = bytes.readUInt32LE(position + 20);
        if (local + 30 > position || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== 0) throw new Error();
        const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
        if (start + size > position) throw new Error();
        mime = bytes.subarray(start, start + size).toString("utf8").trim() === "application/hwp+zip";
      }
      position = next;
    }
    if (position !== directoryEnd || !mime || !section) throw new Error();
  } catch { throw new Error("Invalid HWPX ZIP/mimetype/section structure"); }
}

export async function loadDownloadedOriginals(input: string, value: unknown, forms: Record<string, ApplicationForm>): Promise<Map<string, StoredOriginal>> {
  const manifest = validateDownloadManifest(value), root = await realpath(input);
  const originals = new Map<string, StoredOriginal>();
  const load = async (file: { path: string; bytes: number; sha256: string }) => {
    const target = await realpath(path.resolve(root, file.path)), relative = path.relative(root, target);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Download path escapes forms directory");
    const bytes = await readFile(target);
    if (bytes.length !== file.bytes || digestOf(bytes) !== file.sha256) throw new Error("Downloaded file hash/length mismatch: " + file.path);
    return bytes;
  };
  for (const [id, entry] of Object.entries(manifest.forms)) {
    const metadata = forms[id];
    let registered: VerifiedAgencyForm | undefined;
    if (id.startsWith("agency-")) {
      if (!metadata || metadata.id!==id) throw new Error("Missing agency form metadata: "+id);
      registered = validateAgencyForm(metadata);
    } else if (!metadata || metadata.id !== id || !officialDownloadUrl(metadata.sourceUrl) || new URL(metadata.sourceUrl).searchParams.get("flSeq") !== new URL(entry.sourceUrl).searchParams.get("flSeq")) throw new Error("Downloaded source does not match form metadata: " + id);
    const bytes = await load(entry);
    validateOriginalFile(bytes, entry.format);
    if (entry.format === "jpg" || entry.format === "png") {
      const review = registered?.visualReview, frame = entry.format === "png" ? pngFrame(bytes) : jpegFrame(bytes);
      if (review?.kind !== "whole-original-image" || frame.width !== review.width || frame.height !== review.height) throw new Error("Image original differs from the reviewed whole image: " + id);
    }
    // A scanned PDF original is published on a whole-original page review, so
    // the actual document must have exactly the pages that were read.
    if (entry.format === "pdf" && registered?.visualReview) {
      const review = registered.visualReview;
      if (review.kind !== "whole-original-pdf" || pdfPageCount(bytes) !== review.pageCount) throw new Error("PDF original differs from the reviewed whole original: " + id);
    }
    if (entry.archive) {
      const archive = await load(entry.archive);
      if (archive.length < 22 || archive.readUInt32LE(0) !== 0x04034b50) throw new Error("Invalid source archive ZIP header: " + id);
      if (!archivedMember(archive,entry.archive.member).equals(bytes)) throw new Error("Original differs from reviewed source archive member: " + id);
    }
    let pdf: Buffer | undefined;
    if (entry.pdf) {
      if (!metadata.officialPdfUrl || !officialDownloadUrl(metadata.officialPdfUrl) || new URL(metadata.officialPdfUrl).searchParams.get("flSeq")!==new URL(entry.pdf.sourceUrl).searchParams.get("flSeq")) throw new Error("PDF source does not match form metadata: "+id);
      pdf = await load(entry.pdf);
      if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid downloaded PDF header: " + id);
    }
    originals.set(id, { bytes, format: entry.format, ...(pdf ? { pdf } : {}) });
  }
  return originals;
}

/**
 * 링크 검증은 form.file 을 쓰기 전에 돈다. 법정 체인 경로만은 원본 SHA 에 묶여야 하므로,
 * 그 링크를 볼 때만 실제 내려받아 둔 바이트에서 같은 방식으로 파일 신원을 만들어 건넨다.
 * 공개 단계는 그대로 승인된 원본을 요구하며, 여기서 만든 값은 검증에만 쓰고 저장하지 않는다.
 */
export function withStatutoryOriginalIdentity(form: ApplicationForm | undefined, link: { formId: string; scopeReference?: { kind?: string } },
    originals: Map<string, StoredOriginal>, hash: (bytes: Buffer) => string): ApplicationForm | undefined {
  if (!form || form.file || link.scopeReference?.kind !== "statutory-chain") return form;
  const original = originals.get(link.formId);
  if (!original) return form;
  const digest = hash(original.bytes);
  return { ...form, file: { hwp: `/forms/files/${link.formId}-${digest.slice(0, 12)}.${original.format}`,
    format: original.format, bytes: original.bytes.length, sha256: digest } };
}

export function requireApprovedOriginals(published: Set<string>, originals: Map<string, StoredOriginal>, manifestPresent: boolean): void {
  for (const id of published) if ((manifestPresent || id.startsWith("agency-")) && !originals.has(id)) throw new Error("Approved form has no downloaded original: " + id);
}

async function main() {
  const root = process.cwd();
  const input = path.join(root, "pipeline/forms");
  const output = path.join(root, "public/forms");
  const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, "utf8"));
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const counts = (): Record<FormStatus, number> => ({ available: 0, online: 0, review: 0, missing: 0 });
  const generatedAt = new Date().toISOString();
  interface SourceForm extends Omit<ApplicationForm, "role" | "file"> { declaredKind: string; bytes: number; sha256: string }
  interface Review extends FormLink { programIds: string[] }
  interface PdfCheck { verified: boolean; originalSha256: string; pdfSha256: string; pages: number }
  interface PortalEntry { checkedAt: string; candidateCount: number; outcome: "candidate" | "not_found"; candidates: { formId: string; reason: string }[] }
  const source = await json<{ sourceNote: string; forms: SourceForm[] }>(path.join(input, "source-manifest.json"));
  const reviews = await json<{ rows: Review[]; programNotes?: Record<string, string> }>(path.join(input, "reviewed-links.json"));
  const portalForms = await json<{ forms: Record<string, ApplicationForm> }>(path.join(input, "portal-forms.json")).catch(() => null);
  const portalMatches = await json<{ programs: Record<string, PortalEntry> }>(path.join(input, "portal-matches.json")).catch(() => null);
  const portalScan = await json<NonNullable<FormsCoverage["portalScan"]>>(path.join(input, "portal-scan.json")).catch(() => null);
  const portalReviews = await json<{ rows: Review[]; forms: Record<string, ApplicationForm>; programNotes?: Record<string, string> }>(path.join(input, "portal-reviewed-links.json")).catch(() => null);
  const pdfChecks = await json<Record<string, PdfCheck>>(path.join(input, "pdf-checks.json")).catch((): Record<string, PdfCheck> => ({}));
  const downloads = await json<unknown>(path.join(input, "download-manifest.json"))
    .catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
  const excludedAssociations = await json<{schema:number;rows:{programId:string;formId:string;reason:string;evidenceUrl:string;checkedAt:string}[]}>(path.join(input,"reviews/rejected-associations.json"))
    .catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return {schema:1,rows:[]};throw error;});
  const regionIndex = await json<{ sidos: { code: string; name: string; sigungus: { code: string; name: string }[] }[] }>(path.join(root, "public/bundles/v1/regions.json"));
  const metadata = await json<{ counts: { uniquePrograms: number } }>(path.join(root, "public/bundles/v1/meta.json"));
  const programs = new Map<string, Program>();
  for (const filename of (await readdir(path.join(root, "public/bundles/v1/details"))).filter(name => /^[0-9a-f]{2}\.json$/.test(name)).sort()) {
    const shard = await json<Record<string, Program>>(path.join(root, "public/bundles/v1/details", filename));
    for (const [id, program] of Object.entries(shard)) {
      if (program.id !== id || programs.has(id)) throw new Error("Duplicate/mismatched program id");
      programs.set(id, program);
    }
  }
  // Summary metadata can lag manual additions. Reconcile actual visible records
  // with detail shards rather than dropping records to match a stale counter.
  const activeIds = new Set<string>();
  const bundleRoot = path.join(root, "public/bundles/v1");
  const visibleFiles = ["national.json"];
  for (const scope of ["sido", "sigungu"]) {
    for (const name of await readdir(path.join(bundleRoot, scope))) if (/^\d{5}\.json$/.test(name)) visibleFiles.push(`${scope}/${name}`);
  }
  for (const file of visibleFiles) {
    const bundle = await json<{ programs: Program[] }>(path.join(bundleRoot, file));
    for (const program of bundle.programs) activeIds.add(program.id);
  }
  if (activeIds.size !== programs.size || [...activeIds].some(id => !programs.has(id))) throw new Error("Visible program index and detail shards differ");
  if (programs.size !== metadata.counts.uniquePrograms) console.warn(`Source summary: ${metadata.counts.uniquePrograms}; reconciled visible/detail records: ${programs.size}. Using actual records.`);
  const forms: Record<string, ApplicationForm> = {};
  const originals = new Map<string, StoredOriginal>();
  for (const raw of source.forms) {
    if (!/^ordin-\d+$/.test(raw.id) || forms[raw.id] || !externalFormUrl(raw.sourceUrl)) throw new Error("Invalid source form");
    const bytes = await readFile(path.join(input, "originals", raw.id + ".hwp"));
    if (bytes.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1" || hash(bytes) !== raw.sha256 || bytes.length !== raw.bytes) throw new Error("Original HWP hash/type mismatch: " + raw.id);
    forms[raw.id] = {
      id: raw.id, title: raw.title, role: classifyFormRole(raw.title, raw.declaredKind),
      lawTitle: raw.lawTitle, lawId: raw.lawId, annexId: raw.annexId, annexNumber: raw.annexNumber,
      regionCode: raw.regionCode, regionLabel: raw.regionLabel, effectiveDate: raw.effectiveDate,
      sourceUrl: raw.sourceUrl, lawUrl: raw.lawUrl, fetchedAt: raw.fetchedAt,
    };
    originals.set(raw.id, { bytes, format: "hwp" });
  }
  for (const raw of Object.values(portalForms?.forms || {})) {
    if (!/^(ordin|law|rule)-\d+$/.test(raw.id) || !officialFormUrl(raw.sourceUrl) || !officialFormUrl(raw.lawUrl)) throw new Error("Invalid portal form metadata");
    if (!forms[raw.id]) forms[raw.id] = raw;
  }
  for (const raw of Object.values(portalReviews?.forms || {})) {
    if (raw.sourceKind==="agency" || raw.id.startsWith("agency-")) validateAgencyForm(raw);
    else if (!/^(ordin|law|rule)-\d+$/.test(raw.id) || !officialFormUrl(raw.sourceUrl) || !officialFormUrl(raw.lawUrl)) throw new Error("Invalid reviewed portal form");
    // Explicit source audits may establish the actual effective date, distinct
    // from a publication date supplied by the bulk annex catalogue.
    forms[raw.id] = { ...forms[raw.id], ...raw };
  }
  // Local file metadata is derived only from verified bytes and approved links.
  for (const form of Object.values(forms)) delete form.file;
  if (downloads !== undefined) {
    for (const [id, original] of await loadDownloadedOriginals(input, downloads, forms)) {
      const preserved = originals.get(id);
      if (preserved && (preserved.format !== original.format || !preserved.bytes.equals(original.bytes))) throw new Error("Downloaded original conflicts with preserved source: " + id);
      originals.set(id, original);
    }
  }
  if (portalScan?.status === "complete" && (portalScan.checkedPrograms !== programs.size || programs.size !== Object.keys(portalMatches?.programs || {}).length)) throw new Error("Incomplete program-by-program portal search");
  // 전수 조사 결과는 아직 없을 수 있다. 있으면 모든 사업을 정확히 한 번씩 덮어야 하고,
  // 모자라거나 남는 입력은 조용히 버리지 않고 빌드를 세운다.
  const auditPath = path.join(input, "source-audit.json");
  const census = await readFile(auditPath, "utf8").then(text => normalizeCensus(JSON.parse(text), programs.keys()))
    .catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  const links = new Map<string, FormLink[]>();
  const published = new Set<string>();
  const rejected = new Set<string>();
  if (excludedAssociations.schema!==1 || !Array.isArray(excludedAssociations.rows)) throw new Error("Invalid rejected association audit");
  for (const row of excludedAssociations.rows) {
    if (!programs.has(row.programId) || !forms[row.formId] || typeof row.reason!=="string" || row.reason.trim().length<10 || !officialFormUrl(row.evidenceUrl) || !/^\d{4}-\d{2}-\d{2}$/.test(row.checkedAt)) throw new Error("Invalid rejected association evidence");
    const key=row.programId+"/"+row.formId;
    if (rejected.has(key)) throw new Error("Duplicate rejected association");
    rejected.add(key);
  }
  for (const review of [...reviews.rows, ...(portalReviews?.rows || [])]) {
    const { programIds, ...link } = review;
    for (const id of programIds) {
      const program = programs.get(id);
      if (!program) throw new Error("Reviewed program no longer exists: " + id);
      if (rejected.has(id+"/"+link.formId)) throw new Error("Association has conflicting approval and rejection: "+id+"/"+link.formId);
      validateFormLink(program, withStatutoryOriginalIdentity(forms[link.formId], link, originals, hash), link);
      if (links.get(id)?.some(other => other.formId === link.formId)) throw new Error("Duplicate reviewed association");
      links.set(id, [...(links.get(id) || []), link]);
      published.add(link.formId);
    }
  }
  requireApprovedOriginals(published, originals, downloads !== undefined);
  await mkdir(path.join(output, "files"), { recursive: true });
  await mkdir(path.join(output, "v1/programs"), { recursive: true });
  const expectedAssets = new Set<string>();
  for (const id of published) {
    const original = originals.get(id);
    if (!original) {
      if (!officialDownloadUrl(forms[id].sourceUrl)) throw new Error("Reviewed external form must link to an official attachment");
      continue;
    }
    const { bytes, format } = original;
    const digest = hash(bytes), stem = `${id}-${digest.slice(0, 12)}`;
    const hwpName = stem + "." + format;
    await writeFile(path.join(output, "files", hwpName), bytes);
    expectedAssets.add(hwpName);
    forms[id].file = { hwp: `/forms/files/${hwpName}`, format, bytes: bytes.length, sha256: digest };
    if (format === "pdf") forms[id].file!.pdf = forms[id].file!.hwp;
    const check = pdfChecks[id];
    let pdf = format === "pdf" ? undefined : original.pdf;
    // An image original gets no rendered stand-in: only its own bytes are published.
    if (format !== "pdf" && format !== "jpg" && format !== "png" && !pdf && check?.verified) {
      const pdfPath = path.join(input, "previews", id + ".pdf");
      pdf = await readFile(pdfPath);
      if (check.originalSha256 !== digest || hash(pdf) !== check.pdfSha256 || check.pages < 1 || pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF preview no longer matches checked original");
    }
    if (pdf) {
      const pdfName = stem + ".pdf";
      await writeFile(path.join(output, "files", pdfName), pdf);
      expectedAssets.add(pdfName);
      forms[id].file!.pdf = `/forms/files/${pdfName}`;
    }
  }
  // Revoke only files owned by this generator; never recursively delete a directory.
  const assetsDirectory = path.resolve(output, "files");
  for (const name of await readdir(assetsDirectory)) {
    if (!/^(?:(ordin|law|rule)-\d+|agency-\d{5}-[a-zA-Z0-9][a-zA-Z0-9_-]{0,79})-[a-f0-9]{12}\.(hwp|hwpx|pdf|txt|gif|jpg|png)$/.test(name) || expectedAssets.has(name)) continue;
    const target = path.resolve(assetsDirectory, name);
    if (path.dirname(target) !== assetsDirectory) throw new Error("Unexpected asset path");
    await unlink(target);
  }
  const regions = new Map<string, FormsRegion>();
  const addRegion = (key: string, label: string, scope: FormsRegion["scope"]) => regions.set(key, { key, label, scope, total: 0, counts: counts() });
  addRegion("national", "전국 공통", "national");
  for (const sido of regionIndex.sidos) {
    addRegion("s" + sido.code, sido.name, "sido");
    for (const city of sido.sigungus) addRegion("g" + city.code, `${sido.name} ${city.name}`, "sigungu");
  }
  const entries = new Map<string, ProgramFormEntry[]>();
  const globalCounts = counts();
  const reviewQueue: { programId: string; programName: string; formId: string; reason: string }[] = [];
  for (const program of programs.values()) {
    const areaKey = program.id.startsWith("n.") ? "national" : /^([sg]\d{5})\./.exec(program.id)?.[1];
    if (!areaKey || !regions.has(areaKey)) throw new Error("Unknown program area: " + program.id);
    const approved = links.get(program.id) || [];
    const portalEntry = portalMatches?.programs[program.id];
    const candidates = (portalMatches ? portalEntry?.candidates || [] : findFormCandidates(program, Object.values(forms)))
      .filter(item => forms[item.formId] && !rejected.has(program.id+"/"+item.formId) && !approved.some(link => link.formId === item.formId));
    const applyUrl = applicationRoute(program);
    const investigation = census?.programs.get(program.id);
    const status = formStatus(approved, candidates.map(item => item.formId), applyUrl, foundAttachmentSignal(investigation?.state));
    const conflict = investigation && censusLinkConflict(program.id, investigation, approved.length > 0);
    if (conflict) throw new Error("source-audit.json: " + conflict);
    const entry: ProgramFormEntry = { id: program.id, name: program.name, areaKey, status, links: approved,
      candidateFormIds: candidates.map(item => item.formId), ...(applyUrl ? { applyUrl } : {}),
      ...(program.applyType ? { applyType: program.applyType } : {}),
      ...((portalReviews?.programNotes?.[program.id] || reviews.programNotes?.[program.id]) ? { note: portalReviews?.programNotes?.[program.id] || reviews.programNotes?.[program.id] } : {}),
      ...(portalScan ? { portalSearch: { checkedAt: portalEntry?.checkedAt || portalScan.checkedAt,
        outcome: portalScan.status !== "complete" || !portalEntry ? "incomplete" as const : approved.length ? "linked" as const : candidates.length ? "candidate" as const : "not_found" as const,
        candidateCount: candidates.length, method: "full-index" as const } } : {}),
      ...(investigation ? { investigation } : {}) };
    entries.set(areaKey, [...(entries.get(areaKey) || []), entry]);
    const region = regions.get(areaKey)!;
    region.total++; region.counts[status]++; globalCounts[status]++;
    for (const candidate of candidates) reviewQueue.push({ programId: program.id, programName: program.name, ...candidate });
  }
  const writeJSON = (file: string, data: unknown) => writeFile(file, JSON.stringify(data) + "\n", "utf8");
  const regionList = [...regions.values()];
  for (const region of regionList) {
    const rows = (entries.get(region.key) || []).sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
    await writeJSON(path.join(output, "v1/programs", region.key + ".json"), { schema: 1, generatedAt, region, programs: rows, catalogSharded: !!portalScan });
  }
  const coverage: FormsCoverage = { schema: 1, generatedAt, totalPrograms: programs.size, counts: globalCounts,
    totalForms: Object.keys(forms).length, publishedForms: published.size,
    excludedForms: Object.values(forms).filter(form => ["deleted", "administrative", "reference"].includes(form.role)).length,
    sourceNote: census ? `수록된 사업 자료 ${programs.size.toLocaleString("ko-KR")}건을 한 건씩 조사한 결과입니다(혜택 가짓수가 아니라 자료 건수입니다). 목록을 맞춰 본 것과 법령 본문·기관 안내 페이지를 실제로 열어 읽은 것은 구분해 적고, 열지 못한 자료도 건수로 남깁니다. 아직 찾지 못했다는 것이 신청서가 없다는 뜻은 아닙니다.`
      : portalScan ? "국가법령정보센터의 법령·자치법규·행정규칙 별표·서식 목록을 전국 사업과 대조했습니다. 연결 확인 자료와 적용 검토 중인 후보를 구분합니다. 기관의 별도 사업 공고에만 있는 서식은 이 목록에 없을 수 있습니다." : "전국 사업 목록의 연결 상태를 집계합니다. 현재 확보한 파일은 고양시 자치법규 서식이며, 원문을 대조한 일부 사업부터 제공하고 있습니다. 전국 신청서를 모두 확보한 상태는 아닙니다.",
    regions: regionList, ...(portalScan ? { portalScan } : {}),
    ...(census ? { investigationSummary: { ...census.summary, checkedAt: census.checkedAt } } : {}) };
  await writeJSON(path.join(output, "v1/coverage.json"), coverage);
  await writeJSON(path.join(output, "v1/catalog.json"), { schema: 1, generatedAt, forms });
  if (portalScan) {
    await mkdir(path.join(output, "v1/catalog"), { recursive: true });
    const shards = new Map<string, Record<string, ApplicationForm>>();
    for (const form of Object.values(forms)) {
      const bucket = detailBucket(form.id);
      if (!shards.has(bucket)) shards.set(bucket, {});
      shards.get(bucket)![form.id] = form;
    }
    for (let n = 0; n < 256; n++) {
      const bucket = n.toString(16).padStart(2, "0");
      await writeJSON(path.join(output, "v1/catalog", bucket + ".json"), { schema: 1, generatedAt, forms: shards.get(bucket) || {} });
    }
  }
  await writeJSON(path.join(input, "review-queue.json"), { generatedAt, candidates: reviewQueue });
  console.log(JSON.stringify({ totalPrograms: programs.size, areas: regions.size, counts: globalCounts, publishedForms: published.size, pdfPreviews: Object.values(forms).filter(form => form.file?.pdf).length, excludedForms: coverage.excludedForms, candidateLinks: reviewQueue.length,
    census: census ? { checkedAt: census.checkedAt, counts: census.summary.counts, lawBodiesRead: census.summary.lawBodiesRead, lawFailures: census.summary.lawFailures, pagesRead: census.summary.pagesRead, pageFailures: census.summary.pageFailures, officialAttachments: census.summary.officialAttachments } : "not supplied" }, null, 2));
}

if (process.argv[1] && /(?:^|[\\/])build-forms\.(?:ts|js)$/.test(process.argv[1])) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
