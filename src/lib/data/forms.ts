import sourceExclusions from "./sourceExclusions.json";
/** Public blank application documents only. No applicant data enters this catalogue. */
export type FormStatus = "available" | "online" | "review" | "missing";
/** 'missing'은 '서식이 없다'가 아니라 '아직 출처를 찾는 중'이다. 라벨이 부재를 뜻하게 쓰지 않는다. */
export const FORM_STATUS_LABEL: Record<FormStatus, string> = {
  available: "신청 서류 연결 확인", online: "온라인 신청 안내", review: "연결 검토 중", missing: "신청서 찾는 중",
};
export type FormRole = "application" | "consent" | "delegation" | "supporting" | "reference" | "administrative" | "deleted" | "unclassified";
export type FormFileFormat = "hwp" | "hwpx" | "pdf" | "txt" | "gif" | "jpg" | "png";
/**
 * 본문 글자가 없는 이미지 원본(jpg 또는 png)의 근거 — 사람이 그 이미지 전체를 직접 본 기록이다.
 * 기계 판독이 아니라 검토자의 확인이며, 등록된 SHA·확인일·크기에 묶인다.
 * 빈 신청 서식이고 기입된 개인정보가 없다는 확인을 그대로 싣는다.
 */
export interface AgencyVisualReview {
  kind: "whole-original-image";
  checkedAt: string;
  sha256: string;
  width: number;
  height: number;
  frames: 1;
  blankApplicantForm: true;
  noFilledPersonalData: true;
  evidenceNote: string;
}
/**
 * 본문 글자층이 없는 스캔 PDF 원본(pdf)의 근거 — 사람이 그 PDF의 모든 페이지를
 * 띄워 직접 본 기록이다. 기계가 글자를 뽑아낸 결과가 아니라 검토자의 확인이며,
 * 등록된 SHA·확인일·페이지 수에 묶인다. pagesRead는 page-1부터 모든 페이지를
 * 빠짐없이 적어야 하고, 빈 신청 서식이고 기입된 개인정보가 없다는 확인을 싣는다.
 */
export interface AgencyPdfReview {
  kind: "whole-original-pdf";
  checkedAt: string;
  sha256: string;
  pageCount: number;
  pagesRead: string[];
  blankApplicantForm: true;
  noFilledPersonalData: true;
  evidenceNote: string;
}
/** 스캔 원본의 전체 확인 — 이미지는 프레임, PDF는 페이지 단위다. 서로의 kind를 주장할 수 없다. */
export type AgencyOriginalReview = AgencyVisualReview | AgencyPdfReview;
/**
 * 개별 검토한 기관 서식의 대체 근거 — 그 사업의 공식 신청 안내 자체다.
 * 안내 원문이 이 첨부의 사용처를 밝힌 경우에 쓰며, 조례가 없다고 주장하지 않는다.
 * 법령 칸은 ID를 추측하지 않고 빈 문자열로 남긴다(lawUrl도 빈 문자열이다).
 */
export interface AgencyAuthorityBasis {
  kind: "official-program";
  /** 실제 안내·공고 제목 그대로. */
  title: string;
  evidenceUrl: string;
  checkedAt: string;
  evidenceNote: string;
  pageSHA256: string;
}
export interface ApplicationForm {
  id: string;
  title: string;
  /** Audited selected forms inside a combined official attachment. Original title is retained. */
  displayTitle?: string;
  role: FormRole;
  lawTitle: string;
  lawId: string;
  annexId: string;
  annexNumber: string;
  regionCode: string;
  regionLabel: string;
  effectiveDate: string;
  sourceUrl: string;
  lawUrl: string;
  fetchedAt: string;
  sourceKind?: "ordin" | "law" | "rule" | "agency";
  dateKind?: "effective" | "promulgated" | "issued" | "published" | "checked";
  /** Exact reviewed agency source; no Law.go.kr annex identity is implied. */
  agency?: {
    agencyName: string; sourcePageUrl: string; finalUrl: string; attachmentId: string;
    sha256: string; bytes: number; format: "hwp" | "hwpx" | "pdf" | "jpg" | "png";
    checkedAt: string; authorityEvidenceUrl: string;
    /** 공식 신청 안내를 근거로 등록한 경우에만 실린다. */
    authorityBasis?: AgencyAuthorityBasis;
    /** 스캔 원본(jpg·png 전체 이미지 / pdf 전체 페이지)에만 실린다. 다른 형식은 이 확인을 주장할 수 없다. */
    visualReview?: AgencyOriginalReview;
  };
  officialPdfUrl?: string;
  /** hwp is the legacy original-file property; format identifies the actual bytes. */
  file?: { hwp: string; format?: FormFileFormat; pdf?: string; bytes: number; sha256: string };
}
export interface FormLink {
  formId: string;
  /** Selected applicant part of a combined original, for this benefit. */
  displayTitle?: string;
  use: "main" | "additional" | "conditional";
  condition?: string;
  evidenceUrl: string;
  evidenceNote: string;
  checkedAt: string;
  scopeBasis?: "provincial-law-reference" | "national-law-reference" | "official-application-reference" | "municipal-application-reference" | "national-municipal-intake-reference";
  programEvidenceUrl?: string;
  /** Exact official law history reviewed for this benefit; never a global title alias. */
  renamedLawReference?: {
    kind: "exact-stable-ordinance-history";
    programId: string;
    formLawId: string;
    stableLawId: string;
    priorLawId: string;
    transitionLawId: string;
    citedLawTitle: string;
    priorRuleTitle: string;
    currentRuleTitle: string;
    provinceCode: string;
    municipalityCode: string;
    historyEvidenceUrl: string;
    transitionEvidenceUrl: string;
    currentEvidenceUrl: string;
    checkedAt: string;
    purposeArticleLink: string;
    transitionBasis: string;
    scopeRestriction: string;
  };
  /** 전국 사업의 한 시·군·구가 자기 주민에게 따로 배포하는 선택 접수 서식.
   *  기관 원본에만 쓰며 관할을 바꾸지 않는다. 그 도시를 고른 사람에게만 보인다. */
  nationalMunicipalIntakeReference?: {
    kind: "municipal-intake";
    programmeId: string;
    sigungu: string;
    municipality: string;
    /** 그 도시의 현행 안내 페이지와 거기서 실제로 내려받는 파일. */
    municipalPageUrl: string;
    downloadUrl: string;
    sourceSHA256: string;
    municipalPageSHA256: string;
    httpStatus: number;
    checkedAt: string;
    /** 초기 신청만. 환급·정산 단계로 넓히지 않는다. */
    stage: "initial-application";
    /** 그 페이지가 같은 서비스의 같은 단계임을 말하는 문장. */
    sameServiceEvidence: string;
    /** 그 페이지가 어떤 주민까지 이 서식으로 받는지 말하는 문장. */
    populationEvidence: string;
    /** 이 도시 주민의 선택 경로라는 제한. */
    scopeRestriction: string;
  };
  municipalApplicationReference?: {
    sido: string;
    sigungu: string;
    municipality: string;
    programEvidenceUrl: string;
    checkedAt: string;
    httpStatus: number;
    programSpecific: boolean;
    reference: string;
    municipalArticle: string;
    formEvidence: string;
    scopeRestriction: string;
  };
  scopeReference?: {
    /** statutory-chain 은 법이 전국 공통 서식 하나를 그 급여의 신청서로 지정한 경우만이며,
     *  별도로 선별한 verifiedStatutoryApplications 등록에 referenceId 로 묶인다. */
    kind: "cited-local-law" | "program-documents" | "statutory-chain";
    referencedLawTitle: string;
    annexNumber: string;
    basis: string;
    sourceLawTitle?: string;
    sourceLawId?: string;
    article?: string;
    /** statutory-chain 전용 — 등록 항목의 키와 그 원본 바이트의 해시를 그대로 적는다. */
    referenceId?: string;
    sourceSHA256?: string;
  };
}
export interface ProgramFormEntry {
  id: string;
  name: string;
  areaKey: string;
  status: FormStatus;
  links: FormLink[];
  candidateFormIds: string[];
  applyUrl?: string;
  applyType?: "self" | "auto" | "institution" | "unknown";
  note?: string;
  portalSearch?: {
    outcome: "linked" | "candidate" | "not_found" | "incomplete";
    checkedAt: string;
    candidateCount: number;
    method: "full-index";
  };
  /** 전수 조사 결과. 없으면 옛 자료 — 조사한 적 있는 것처럼 보이면 안 된다. */
  investigation?: Investigation;
}
export interface FormsRegion {
  key: string;
  label: string;
  scope: "national" | "sido" | "sigungu";
  total: number;
  counts: Record<FormStatus, number>;
}
export interface FormsCoverage {
  schema: 1;
  generatedAt: string;
  totalPrograms: number;
  counts: Record<FormStatus, number>;
  totalForms: number;
  publishedForms: number;
  excludedForms: number;
  sourceNote: string;
  regions: FormsRegion[];
  portalScan?: {
    status: "complete" | "incomplete";
    indexedForms: number;
    checkedPrograms: number;
    checkedAt: string;
    sources: { kind: string; total: number; collected: number }[];
  };
  /** 전수 조사 집계. 목록 대조와 실제 본문·페이지 확인을 구분해 적는다. */
  investigationSummary?: CensusSummary & { checkedAt: string };
}
export interface FormsCatalog {
  schema: 1;
  generatedAt: string;
  forms: Record<string, ApplicationForm>;
}
export interface FormsRegionBundle {
  schema: 1;
  generatedAt: string;
  region: FormsRegion;
  programs: ProgramFormEntry[];
  catalogSharded?: boolean;
}

/* ── 전수 조사(census) ─────────────────────────────────────────────
   네 가지 FormStatus는 그대로 두고, 조사 단계는 따로 싣는다.
   어떤 단계도 '신청서가 없다'는 뜻이 아니며, 읽지 못한 자료는 숫자로 남긴다. */
export type InvestigationState = "confirmed" | "candidate" | "attachment_found" | "document_mentioned" | "automatic" | "institution" | "needs_source";
/** 확인이 많이 된 단계부터. 화면의 집계·선택 상자도 이 순서를 쓴다. */
export const INVESTIGATION_STATES: InvestigationState[] = ["confirmed", "attachment_found", "candidate", "document_mentioned", "automatic", "institution", "needs_source"];
export const INVESTIGATION_LABEL: Record<InvestigationState, string> = {
  confirmed: "신청 서류 원문 확인",
  attachment_found: "공식 안내 첨부자료 확인",
  candidate: "관련 서식 검토 중",
  document_mentioned: "준비서류 안내 확인",
  automatic: "자동 지원 방식 — 확인 필요",
  institution: "기관 추천 방식 — 확인 필요",
  needs_source: "출처 찾는 중",
};
/** 단계마다 '무엇을 했고 무엇이 남았는지'를 한 문장으로. 부재를 뜻하는 문구를 쓰지 않는다. */
export const INVESTIGATION_NOTE: Record<InvestigationState, string> = {
  confirmed: "신청에 쓰는 서류를 공식 원문과 대조해 연결했어요. 주신청서인지 함께 내는 서류인지 아래 안내와 접수기관의 최신 안내를 확인해 주세요.",
  attachment_found: "이 사업의 공식 안내 페이지에 올라온 자료를 찾았어요. 신청서가 맞는지, 다른 서류가 더 필요한지는 확인 중이에요.",
  candidate: "이름과 근거 법령이 비슷한 서식을 찾았어요. 이 사업에 적용되는 서식인지 확인 중이에요.",
  document_mentioned: "공식 자료에 신청서나 준비서류가 적혀 있어요. 서식 파일은 아직 찾는 중이에요.",
  automatic: "자료에 자동 지원 방식으로 적힌 사업이에요. 신청서가 필요 없다는 뜻은 아니며, 별도 신청이 필요한지 담당기관에 확인해 주세요.",
  institution: "자료에 기관 추천·선정 방식으로 적힌 사업이에요. 신청서가 필요 없다는 뜻은 아니며, 추천 절차와 서류를 담당기관에 확인해 주세요.",
  needs_source: "아직 공식 출처에서 신청서를 찾지 못했어요. 신청서가 없다는 뜻은 아니에요. 담당기관 공고에 서식이 따로 있을 수 있어요.",
};
export interface SourceLink {
  title: string;
  url: string;
  /** official_page=사업 안내 페이지, attachment=그 페이지에 올라온 파일. 승인된 신청서(FormLink)가 아니다. */
  kind: "official_page" | "attachment";
  /** Source-reviewed purpose, author or old-version condition; not a FormLink approval. */
  note?: string;
}
export interface Investigation {
  state: InvestigationState;
  checkedAt: string;
  applicationMentioned: boolean;
  documentNames: string[];
  lawChecks: { searched: number; read: number; failed: number; unresolvedCitations?: number };
  pageChecks: { attempted: number; read: number; failed: number; unattempted?: number };
  sourceLinks: SourceLink[];
  note?: string;
  /** 화면용으로 자른 목록의 원래 건수 — 자른 만큼을 없던 일로 만들지 않는다. */
  documentNameTotal?: number;
  sourceLinkTotal?: number;
}
export interface CensusSummary {
  totalPrograms: number;
  counts: Record<InvestigationState, number>;
  lawQueries: number;
  lawBodiesRead: number;
  lawFailures: number;
  lawUnresolvedCitations?: number;
  pageUrls: number;
  pagesRead: number;
  pageFailures: number;
  officialAttachments: number;
}
export interface CensusDocument {
  schema: 1;
  checkedAt: string;
  summary: CensusSummary;
  programs: Record<string, Investigation>;
}
export interface NormalizedCensus {
  checkedAt: string;
  summary: CensusSummary;
  programs: Map<string, Investigation>;
}
/** 화면에 싣는 글자·목록 길이 상한. 자른 사실은 *Total 로 남긴다. */
export const CENSUS_LIMITS = { title: 180, note: 800, documentName: 160, documentNames: 20, sourceLinks: 30, url: 2048 } as const;
/** 인증 키·신청인 정보가 붙은 주소는 공개 화면에 내보내지 않는다. */
const CREDENTIAL_PARAM = /^oc$|key|token|secret|password|auth|login|email|phone|resident|jumin/i;

/** 공개해도 되는 출처 주소인지 — 프로토콜·계정정보·인증 질의를 검사한다. 파일 내려받기로 승격하지 않는다. */
export function publicSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > CENSUS_LIMITS.url) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (sourceExclusions.hosts.some(row=>row.host===host)) return null;
  if (!host.includes(".") || /^\d+(?:\.\d+){3}$/.test(host) || host.startsWith("[") || /\.(local|localhost|internal|lan|test|invalid)$/.test(host)) return null;
  for (const [name, value] of url.searchParams) if (CREDENTIAL_PARAM.test(name) && !(/^(?:menu)?key$/i.test(name) && /^\d+$/.test(value))) return null;
  return url.href;
}

function fail(message: string): never { throw new Error("source-audit.json: " + message); }
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function whole(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail(`${field} must be a non-negative integer`);
  return value;
}
function clamped(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string`);
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}
function day(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${field} must be a YYYY-MM-DD date`);
  return value;
}

function readInvestigation(id: string, raw: unknown): { entry: Investigation; attachments: number } {
  if (!isRecord(raw)) fail(`program ${id} must be an object`);
  const state = raw.state;
  if (typeof state !== "string" || !(INVESTIGATION_STATES as string[]).includes(state)) fail(`program ${id} has an unknown state`);
  if (typeof raw.applicationMentioned !== "boolean") fail(`program ${id} applicationMentioned must be a boolean`);
  if (!Array.isArray(raw.documentNames)) fail(`program ${id} documentNames must be an array`);
  if (!Array.isArray(raw.sourceLinks)) fail(`program ${id} sourceLinks must be an array`);
  if (!isRecord(raw.lawChecks) || !isRecord(raw.pageChecks)) fail(`program ${id} needs lawChecks and pageChecks`);
  const lawChecks = { searched: whole(raw.lawChecks.searched, `${id} lawChecks.searched`), read: whole(raw.lawChecks.read, `${id} lawChecks.read`), failed: whole(raw.lawChecks.failed, `${id} lawChecks.failed`), ...(raw.lawChecks.unresolvedCitations === undefined ? {} : { unresolvedCitations: whole(raw.lawChecks.unresolvedCitations, `${id} lawChecks.unresolvedCitations`) }) };
  const pageChecks = { attempted: whole(raw.pageChecks.attempted, `${id} pageChecks.attempted`), read: whole(raw.pageChecks.read, `${id} pageChecks.read`), failed: whole(raw.pageChecks.failed, `${id} pageChecks.failed`), unattempted: whole(raw.pageChecks.unattempted ?? 0, `${id} pageChecks.unattempted`) };
  if (lawChecks.read > lawChecks.searched || lawChecks.failed > lawChecks.searched) fail(`program ${id} lawChecks read/failed exceed the queries actually made`);
  if (pageChecks.read > pageChecks.attempted || pageChecks.failed > pageChecks.attempted + pageChecks.unattempted) fail(`program ${id} pageChecks exceed the source addresses accounted for`);
  const documentNames = raw.documentNames.map((name, index) => clamped(name, `${id} documentNames[${index}]`, CENSUS_LIMITS.documentName));
  // 첨부자료를 먼저 두어, 목록을 잘라도 그 사업의 근거 첨부가 사라지지 않게 한다.
  const links: SourceLink[] = raw.sourceLinks.map((link, index) => {
    if (!isRecord(link)) fail(`${id} sourceLinks[${index}] must be an object`);
    const kind = link.kind;
    if (kind !== "official_page" && kind !== "attachment") fail(`${id} sourceLinks[${index}] has an unknown kind`);
    const url = publicSourceUrl(link.url);
    if (!url) fail(`${id} sourceLinks[${index}] is not a public credential-free http(s) source`);
    return { title: clamped(link.title, `${id} sourceLinks[${index}].title`, CENSUS_LIMITS.title), url, kind,
      ...(link.note === undefined ? {} : {note:clamped(link.note, `${id} sourceLinks[${index}].note`, CENSUS_LIMITS.note)}) };
  });
  const attachments = links.filter(link => link.kind === "attachment");
  if (state === "attachment_found" && !attachments.length) fail(`program ${id} is attachment_found without an attachment source link`);
  if (state === "document_mentioned" && !raw.applicationMentioned && !documentNames.length) fail(`program ${id} is document_mentioned without any mentioned document`);
  const sourceLinks = [...attachments, ...links.filter(link => link.kind === "official_page")];
  const entry: Investigation = {
    state: state as InvestigationState,
    checkedAt: day(raw.checkedAt, `${id} checkedAt`),
    applicationMentioned: raw.applicationMentioned,
    documentNames: documentNames.slice(0, CENSUS_LIMITS.documentNames),
    lawChecks, pageChecks,
    sourceLinks: sourceLinks.slice(0, CENSUS_LIMITS.sourceLinks),
    ...(raw.note === undefined ? {} : { note: clamped(raw.note, `${id} note`, CENSUS_LIMITS.note) }),
    ...(documentNames.length > CENSUS_LIMITS.documentNames ? { documentNameTotal: documentNames.length } : {}),
    ...(sourceLinks.length > CENSUS_LIMITS.sourceLinks ? { sourceLinkTotal: sourceLinks.length } : {}),
  };
  return { entry, attachments: attachments.length };
}

/**
 * 공개 데이터로 올리기 전의 전수 조사 입력 검사.
 * 사업을 빠뜨리거나 더 넣은 입력은 조용히 버리지 않고 실패시킨다.
 * (JSON 안에서 같은 사업 ID가 겹치면 하나로 합쳐지므로 건수 부족으로 걸린다.)
 */
export function normalizeCensus(input: unknown, programIds: Iterable<string>): NormalizedCensus {
  const expected = new Set(programIds);
  if (!isRecord(input) || input.schema !== 1) fail("schema must be 1");
  const checkedAt = day(input.checkedAt, "checkedAt");
  if (!isRecord(input.summary) || !isRecord(input.programs)) fail("needs summary and programs");
  const raw = input.summary;
  const rawCounts = raw.counts;
  if (!isRecord(rawCounts)) fail("summary.counts must be an object");
  const extraState = Object.keys(rawCounts).find(key => !(INVESTIGATION_STATES as string[]).includes(key));
  if (extraState) fail(`summary.counts has an unknown state: ${extraState}`);
  const summary: CensusSummary = {
    totalPrograms: whole(raw.totalPrograms, "summary.totalPrograms"),
    counts: Object.fromEntries(INVESTIGATION_STATES.map(state => [state, whole(rawCounts[state], `summary.counts.${state}`)])) as Record<InvestigationState, number>,
    lawQueries: whole(raw.lawQueries, "summary.lawQueries"),
    lawBodiesRead: whole(raw.lawBodiesRead, "summary.lawBodiesRead"),
    lawFailures: whole(raw.lawFailures, "summary.lawFailures"),
    ...(raw.lawUnresolvedCitations === undefined ? {} : { lawUnresolvedCitations: whole(raw.lawUnresolvedCitations, "summary.lawUnresolvedCitations") }),
    pageUrls: whole(raw.pageUrls, "summary.pageUrls"),
    pagesRead: whole(raw.pagesRead, "summary.pagesRead"),
    pageFailures: whole(raw.pageFailures, "summary.pageFailures"),
    officialAttachments: whole(raw.officialAttachments, "summary.officialAttachments"),
  };
  if (summary.lawBodiesRead > summary.lawQueries || summary.lawFailures > summary.lawQueries) fail("summary law reads/failures exceed the queries actually made");
  if (summary.pagesRead > summary.pageUrls || summary.pageFailures > summary.pageUrls) fail("summary page reads/failures exceed the pages actually attempted");
  if (summary.totalPrograms !== expected.size) fail(`summary.totalPrograms ${summary.totalPrograms} does not match the ${expected.size} published program records`);
  const keys = Object.keys(input.programs);
  const unknown = keys.find(id => !expected.has(id));
  if (unknown) fail(`programs contains an id that is not published: ${unknown}`);
  if (keys.length !== expected.size) fail(`programs covers ${keys.length} of ${expected.size} program records; every record must be present exactly once`);
  const programs = new Map<string, Investigation>();
  const tally = Object.fromEntries(INVESTIGATION_STATES.map(state => [state, 0])) as Record<InvestigationState, number>;
  const attachmentUrls = new Set<string>();
  for (const id of keys) {
    const read = readInvestigation(id, (input.programs as Record<string, unknown>)[id]);
    programs.set(id, read.entry);
    tally[read.entry.state]++;
    for (const link of ((input.programs as Record<string, Investigation>)[id]).sourceLinks) if (link.kind === "attachment") attachmentUrls.add(publicSourceUrl(link.url)!);
  }
  for (const state of INVESTIGATION_STATES) {
    if (summary.counts[state] !== tally[state]) fail(`summary.counts.${state} is ${summary.counts[state]} but ${tally[state]} programs are in that state`);
  }
  const unresolved = [...programs.values()].reduce((total, row) => total + (row.lawChecks.unresolvedCitations ?? 0), 0);
  if (summary.lawUnresolvedCitations !== undefined && summary.lawUnresolvedCitations !== unresolved) fail("summary.lawUnresolvedCitations does not match program citation issues");
  if (summary.officialAttachments !== attachmentUrls.size) fail(`summary.officialAttachments is ${summary.officialAttachments} but ${attachmentUrls.size} distinct attachment source URLs are listed`);
  return { checkedAt, summary, programs };
}

/** 승인 연결과 조사 단계가 어긋나면 화면이 거짓말을 한다 — 빌드에서 막는다. */
export function censusLinkConflict(id: string, investigation: Investigation, hasApprovedLinks: boolean): string | null {
  if (hasApprovedLinks && investigation.state !== "confirmed") return `program ${id} has approved application links but census state is ${investigation.state}`;
  if (!hasApprovedLinks && investigation.state === "confirmed") return `program ${id} is census-confirmed but has no approved application link`;
  return null;
}

/** 지역 목록의 확인 단계별 건수 — 조사 결과가 실린 사업만 센다(옛 자료는 세지 않는다). */
export function countInvestigationStates(programs: { investigation?: Investigation }[]): { tally: Record<InvestigationState, number>; investigated: number } {
  const tally = Object.fromEntries(INVESTIGATION_STATES.map(state => [state, 0])) as Record<InvestigationState, number>;
  let investigated = 0;
  for (const program of programs) if (program.investigation) { tally[program.investigation.state]++; investigated++; }
  return { tally, investigated };
}

const number = (value: number) => value.toLocaleString("ko-KR");
/** 목록 대조와 '실제로 열어 읽은 것'을 구분해 적는 짧은 문장들. 실패 건수는 지우지 않는다. */
export function investigationProgressLines(summary: CensusSummary & { checkedAt: string }): string[] {
  const unread = (failed: number) => failed ? `${number(failed)}건은 열지 못했어요.` : "열지 못한 자료는 없어요.";
  return [
    `사업 자료 ${number(summary.totalPrograms)}건의 조사 상태를 집계했어요. 목록만 맞춰 본 것과, 본문을 실제로 열어 읽은 것을 나누어 적어요.`,
    `법령·자치법규 본문: ${number(summary.lawQueries)}건을 찾아보고 ${number(summary.lawBodiesRead)}건을 실제로 열어 읽었어요. ${unread(summary.lawFailures)}`,
    ...(summary.lawUnresolvedCitations ? [`사업 자료의 인용 ${number(summary.lawUnresolvedCitations)}건은 법규명을 특정하지 못했어요. 사업계획이나 일반 지침명도 포함될 수 있어요.`] : []),
    `기관 안내 주소 ${number(summary.pageUrls)}곳을 조사 대상으로 정하고 ${number(summary.pagesRead)}곳의 본문을 읽었어요. ${unread(summary.pageFailures)}`,
    `공식 안내 페이지에서 찾은 첨부자료 ${number(summary.officialAttachments)}건이에요. 이 자료가 신청서 전부라는 뜻은 아니에요. (조사일 ${summary.checkedAt})`,
  ];
}
