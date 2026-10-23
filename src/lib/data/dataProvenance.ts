import type { SourceId } from "./types";

/** 상세 조각의 출처 집계. 화면과 생성 스크립트가 같은 규칙을 쓴다. */
export const SOURCE_ORDER = ["gov24", "bokjiro", "icare", "welfare100", "manual"] as const satisfies readonly SourceId[];

export type ProvenanceLinkRole = "original" | "provider-api" | "evidence";

export interface ProvenanceLink {
  href: string;
  label: string;
  role: ProvenanceLinkRole;
}

export interface ProvenanceDateSpan {
  min: string;
  max: string;
  datedRefs: number;
  missingRefs: number;
  precision: "year" | "day" | "month" | "mixed";
  granularity?: { year: number; month: number; day: number };
}

export interface ProvenanceSource {
  id: SourceId;
  title: string;
  programLinks: number;
  sourceRefs: number;
  refsWithoutUrl: number;
  /** 자료에 적힌 수집일. 하나도 없으면 빠진다. */
  fetchedAt?: ProvenanceDateSpan;
  /** 원문 기준일·확인일. 수집일과 별도이며, 하나도 없으면 빠진다. */
  documentDate?: ProvenanceDateSpan & { label: string; meaning: string };
  urlHosts: { host: string; refs: number }[];
  /** 출처 표기에 남은 서로 다른 http(s) 주소 수. 주소 목록 자체는 넣지 않는다. */
  distinctUrls: number;
  /** 주소의 mid 값이 서로 다른 수. 통합돌봄 시·도 게시판을 셀 때 쓴다. */
  distinctBoards: number;
  links: ProvenanceLink[];
  limitation?: string;
}

export interface DataProvenance {
  schema: 1;
  basis: {
    detailDir: "public/bundles/v1/details";
    shardFiles: number;
    programRecords: number;
    duplicateIds: number;
    programsWithoutSources: number;
  };
  /** 복지 자료 묶음을 만들고 정규화한 시각. 원천 수집일이 아니다. */
  bundleGeneratedAt: string;
  /** meta.counts.uniquePrograms. 상세 자료 건수와 다른 집계다. */
  metaUniquePrograms: number;
  /** meta.counts.placements. */
  metaPlacements: number;
  districtCopies: {
    extraRecords: number;
    groups: number;
    regions: string[];
    sourceKinds: SourceId[];
  };
  overlap: {
    /** 출처 종류별 연결을 더한 수. 자료 건수가 아니다. */
    sourceKindLinkSum: number;
    programsWithMultipleSourceKinds: number;
    /** 종류 개수 → 자료 수. 2 이상만. */
    byKindCount: Record<string, number>;
  };
  /** 사업 자료에 원문 주소가 하나라도 있는지. 출처 표기 중 주소가 없는 개수와 다른 지표다. */
  urlCoverage: {
    programsWithRecordedUrl: number;
    programsWithoutAnyUrl: number;
    /** 핵심 복지 100선만 있고 원문 주소가 없는 자료. */
    welfare100OnlyWithoutUrl: number;
  };
  sources: ProvenanceSource[];
  forms: {
    downloadOriginals: number;
    linkedPrograms: number;
    censusPrograms: number;
    formBundleGeneratedAt: string;
    /** 법령·안내 페이지 검토일. 없으면 생략. */
    lawReviewCheckedAt?: string;
    /** 법령포털 목록 대조 시각. 없으면 생략. */
    portalListCheckedAt?: string;
  };
  /** 묶음 생성 로그의 원천 입력. 제외·병합 전이며 상세 자료 건수가 아니다. */
  pipelineInputs: { id: SourceId; records: number }[];
  /** 상세 자료 건수 밖에 있는 수. 더해서 전체 복지 수로 쓰지 않는다. */
  outsideDetail: {
    rawInputRecords: number;
    /** 전국 사업에 붙은 지역 운영 정보. meta에 없으면 생략. */
    regionalOperations?: number;
  };
}

const DATE_RE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
const CREDENTIAL_PARAM = /^(oc|servicekey|service_key|apikey|api_key|access_token|token|secret|password|auth|authorization|key)$/i;
const SECRET_TEXT = /service[_-]?key|DATA_GO_KR_SERVICE_KEY|Infuser\s+\S|api[_-]?key|access[_-]?token|BEGIN [A-Z ]*PRIVATE KEY/i;

export function publicHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return null;
  if (SECRET_TEXT.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local")) return null;
  for (const name of url.searchParams.keys()) {
    if (CREDENTIAL_PARAM.test(name)) return null;
  }
  return url.href;
}

export function koCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function kstStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")} KST`;
}

function spanText(span: ProvenanceDateSpan | undefined): string {
  if (!span || span.datedRefs === 0) return "자료에 없음";
  const range = span.min === span.max ? span.min : `${span.min} ~ ${span.max}`;
  if (span.precision === "year") return `${range} (연도 기준)`;
  if (span.precision === "month") return `${range} (월)`;
  if (span.precision === "mixed") return `${range} (연도·월·일의 정밀도가 다름)`;
  return range;
}

function recordedHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

const ROLE_LABEL: Record<ProvenanceLinkRole, string> = {
  original: "원문 기관",
  "provider-api": "제공 API",
  evidence: "보강 근거",
};

export interface ProvenanceViewLink extends ProvenanceLink {
  roleLabel: string;
}

export interface ProvenanceView {
  heading: string;
  paragraphs: string[];
  tableCaption: string;
  rows: { id: SourceId; title: string; programs: string; fetched: string }[];
  fetchedNote: string;
  refNote: string;
  dates: string[];
  forms: string;
  linkNote: string;
  links: ProvenanceViewLink[];
  limits: string[];
}

export function provenanceView(doc: DataProvenance): ProvenanceView {
  const programs = doc.basis.programRecords;
  const overlap = doc.overlap;
  const kindParts = Object.entries(overlap.byKindCount)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([kinds, count]) => `${kinds}종류 ${koCount(count)}건`);
  const copyGap = programs - doc.metaUniquePrograms;
  const copies = doc.districtCopies;
  const copySentence = copies.extraRecords > 0 && copies.extraRecords === copyGap
    ? `${copies.sourceKinds.map((id) => titleOf(id)).join(" · ")} ${koCount(copies.groups)}개 사업이 ${copies.regions.join(" · ")}에 각각 배치되어 상세 자료가 ${koCount(copies.extraRecords)}건 더 많습니다. 이 차이는 오류나 예전 값이 아닙니다.`
    : programs === doc.metaUniquePrograms
      ? "상세 자료 건수와 중복 통합 후 사업자료 수가 같습니다."
      : `상세 자료 ${koCount(programs)}건과 중복 통합 후 사업자료 ${koCount(doc.metaUniquePrograms)}건은 다른 수입니다. 어느 쪽이 틀린 값인지는 이 차이만으로 정하지 않습니다.`;
  const placementSentence = doc.metaPlacements === programs
    ? `묶음 생성 로그의 배치 수 ${koCount(doc.metaPlacements)}건은 이 상세 자료 건수와 같습니다.`
    : `묶음 생성 로그의 배치 수는 ${koCount(doc.metaPlacements)}건입니다.`;
  const missingRefs = doc.sources.reduce((sum, source) => sum + source.refsWithoutUrl, 0);
  const url = doc.urlCoverage;

  const paragraphs = [
    "복지나침반이 공개 원천을 읽어 만든 안내 자료입니다. 정부나 복지로의 공식 통계가 아니고, 전국의 모든 복지를 다 모은 목록도 아닙니다.",
    `기준은 공개 세부 자료 ${koCount(doc.basis.shardFiles)}조각의 상세 자료 ${koCount(programs)}건입니다. 같은 자료 번호가 겹친 경우는 ${koCount(doc.basis.duplicateIds)}건이고, 출처가 비어 있는 자료는 ${koCount(doc.basis.programsWithoutSources)}건입니다.`,
    `${koCount(programs)}건은 지역에 배치한 상세 자료이고, ${koCount(doc.metaUniquePrograms)}건은 중복 통합 후 사업자료 수입니다. 둘은 집계 단위가 다릅니다. ${copySentence} ${placementSentence}`,
    `한 자료에 출처 종류가 여러 개면 종류마다 한 번씩 연결됩니다. 아래 표를 더하면 ${koCount(overlap.sourceKindLinkSum)}이지만 자료는 ${koCount(programs)}건입니다. 출처 종류가 둘 이상인 자료는 ${koCount(overlap.programsWithMultipleSourceKinds)}건${kindParts.length ? `(${kindParts.join(", ")})` : ""}입니다. ${koCount(overlap.sourceKindLinkSum)}은 총 복지 수가 아닙니다.`,
    `원문 주소가 기록된 자료는 ${koCount(url.programsWithRecordedUrl)}건이고, 주소가 하나도 없는 자료는 ${koCount(url.programsWithoutAnyUrl)}건입니다. 출처 표기 중 주소가 없는 ${koCount(missingRefs)}개와는 다른 수입니다.`,
  ];

  const rows = doc.sources.map((source) => ({
    id: source.id,
    title: source.title,
    programs: `${koCount(source.programLinks)}건`,
    fetched: spanText(source.fetchedAt),
  }));

  const refNote = `표는 자료 하나당 출처 종류를 한 번만 센 수입니다. 출처 표기 횟수는 ${doc.sources.map((source) => `${source.title} ${koCount(source.sourceRefs)}`).join(", ")}입니다.`;
  const buildDay = kstStamp(doc.bundleGeneratedAt).slice(0, 10);
  const fetchedNote = "표의 날짜는 자료에 기록된 수집일입니다. 그 시각에 네트워크로 모두 조회했다고 증명된 것은 아니고, 오늘 기준으로 다시 확인한 날도 아닙니다.";

  const dates = [
    `복지 자료 묶음을 만들어 정규화한 시각은 ${kstStamp(doc.bundleGeneratedAt)}입니다. 원천을 받은 날이 아닙니다.`,
    ...doc.sources.map((source) => {
      const fetched = source.fetchedAt;
      if (!fetched) return `${source.title}에는 자료에 기록된 수집일이 없습니다.`;
      const when = spanText(fetched);
      const missing = fetched.missingRefs > 0 ? ` 수집일이 없는 출처 표기 ${koCount(fetched.missingRefs)}건은 범위에 넣지 않았습니다.` : "";
      return `${source.title}에 기록된 수집일은 ${when}입니다.${missing}${fetchedCaveat(source, buildDay)}`;
    }),
  ];
  for (const source of doc.sources) {
    const documentDate = source.documentDate;
    if (!documentDate) {
      dates.push(`${source.title}에는 원문 기준일이 없습니다.`);
      continue;
    }
    const range = spanText(documentDate);
    const missing = documentDate.missingRefs > 0
      ? ` ${documentDate.label}이 없는 출처 표기 ${koCount(documentDate.missingRefs)}건은 범위에 넣지 않았습니다.`
      : "";
    dates.push(`${source.title} ${documentDate.label}은 ${range}입니다. ${documentDate.meaning}${missing}`);
  }
  if (doc.forms.lawReviewCheckedAt) {
    dates.push(`서식 조사 요약에 기록된 확인일은 ${doc.forms.lawReviewCheckedAt}입니다. 원천 수집일이나 모든 법령의 동시 확인일을 뜻하지 않으며, 개별 서식의 확인일은 혜택 상세에서 따로 안내합니다.`);
  }
  if (doc.forms.portalListCheckedAt) {
    dates.push(`법령포털 서식 목록을 대조한 시각은 ${kstStamp(doc.forms.portalListCheckedAt)}입니다. 원천 수집일이 아닙니다.`);
  }
  dates.push(`신청 서식 자료를 만든 시각은 ${kstStamp(doc.forms.formBundleGeneratedAt)}입니다. 복지 자료 묶음의 생성 시각과 다릅니다.`);

  const forms = `내려받을 수 있는 서식 원본은 ${koCount(doc.forms.downloadOriginals)}개이고, 그 서식이 연결된 사업 자료는 ${koCount(doc.forms.linkedPrograms)}건입니다. 사업 자료 ${koCount(programs)}건과 같은 수가 아닙니다.`;

  const links = doc.sources.flatMap((source) => source.links.map((link) => ({
    ...link,
    roleLabel: `${source.title} · ${ROLE_LABEL[link.role]}`,
  })));

  const limits = [
    "이 목록은 전국의 모든 복지 사업을 빠짐없이 담았다는 뜻이 아닙니다. 읍·면·동만의 사업처럼 묶음을 만들 때 뺀 자료가 있고, 원천에 없는 제도는 여기에도 없습니다.",
  ];
  const welfare = doc.sources.find((source) => source.id === "welfare100");
  if (welfare && welfare.refsWithoutUrl === welfare.sourceRefs && welfare.sourceRefs > 0 && url.welfare100OnlyWithoutUrl === url.programsWithoutAnyUrl) {
    const merged = welfare.programLinks - url.programsWithoutAnyUrl;
    limits.push(`출처 표기 중 주소가 없는 것은 ${welfare.title} ${koCount(welfare.refsWithoutUrl)}개입니다. 그 가운데 ${koCount(merged)}개는 다른 출처와 합쳐져 그 출처의 주소가 있습니다. 사업 자료 전체에서 원문 주소가 하나도 없는 것은 ${koCount(url.programsWithoutAnyUrl)}건이고, 주소가 기록된 자료는 ${koCount(url.programsWithRecordedUrl)}건입니다. 100개 표기와 ${koCount(url.programsWithoutAnyUrl)}건은 서로 다른 지표입니다.`);
  }
  for (const source of doc.sources) {
    if (source.limitation) limits.push(source.limitation);
    if (source.refsWithoutUrl > 0 && source.id !== "welfare100") {
      limits.push(`${source.title} 출처 표기 ${koCount(source.sourceRefs)}개 중 주소가 없는 표기는 ${koCount(source.refsWithoutUrl)}개입니다.`);
    }
    if (source.urlHosts.length === 1 && source.urlHosts[0].refs > 0) {
      limits.push(`${source.title} 원문 주소 ${koCount(source.urlHosts[0].refs)}개는 모두 ${source.urlHosts[0].host} 입니다.`);
    }
  }
  if (doc.pipelineInputs.length) {
    const rawSum = doc.outsideDetail.rawInputRecords;
    const regional = doc.outsideDetail.regionalOperations;
    const regionalText = regional != null
      ? ` 전국 사업에 붙은 지역 운영 정보는 ${koCount(regional)}건입니다.`
      : "";
    limits.push(`묶음을 만들기 전에 읽은 원천 입력은 ${doc.pipelineInputs.map((row) => `${titleOf(row.id)} ${koCount(row.records)}`).join(", ")}이고, 합계는 ${koCount(rawSum)}건입니다.${regionalText} 이 수들은 상세 자료 ${koCount(programs)}건 밖이며, 더해서 전체 복지 수로 세지 않습니다.`);
  }

  return {
    heading: "어디서 모았나",
    paragraphs,
    tableCaption: "출처 종류별 연결 자료. 칸을 더해도 전체 자료 수가 되지 않습니다.",
    rows,
    fetchedNote,
    refNote,
    dates,
    forms,
    linkNote: "아래는 기관 목록과 제공 API 안내 페이지입니다. 자료 안의 개별 원문 주소를 지금 모두 열어 확인한 것은 아닙니다.",
    links,
    limits,
  };
}

function fetchedCaveat(source: ProvenanceSource, buildDay: string): string {
  if (source.id === "bokjiro") {
    return ` 이 값은 목록 캐시 파일의 수정 시각에서 옮긴 것입니다. 묶음 안내문에 복지로 수집일로 적힌 ${buildDay}는 묶음을 만든 날이고, 이 기록일과 다릅니다.`;
  }
  if (source.id === "icare") {
    const measured = source.distinctUrls > 0
      ? ` 이 묶음에 남은 서로 다른 메뉴판 주소는 ${koCount(source.distinctUrls)}개${source.distinctBoards > 0 ? `, 시·도 게시판은 ${koCount(source.distinctBoards)}곳` : ""}입니다.`
      : "";
    return ` 이 값은 선행 대시보드 수집본을 읽을 때 붙인 날짜입니다. 공적 원출처는 보건복지부 통합돌봄 메뉴판입니다.${measured} 원문을 다시 받는 코드가 있어도 이 묶음을 그 재수집으로 다시 만든 것은 아닙니다.`;
  }
  if (source.id === "welfare100") {
    return " 이 값은 색인 파일 시각에서 온 것일 수 있습니다. 공식 API의 수집 시각이 아니고, 최신 검증일도 아닙니다.";
  }
  if (source.id === "gov24") {
    return " 목록 캐시에 적힌 시각을 날짜로 붙인 값이며, 서비스마다 따로 받은 시각은 아닙니다.";
  }
  if (source.id === "manual") {
    return " 공식 누리집을 확인한 날로 적은 값입니다.";
  }
  return "";
}

const TITLES: Record<SourceId, string> = {
  gov24: "정부24 공공서비스(혜택)",
  bokjiro: "복지로 복지서비스",
  icare: "통합돌봄 메뉴판",
  welfare100: "핵심 복지 100선",
  manual: "수동 보강",
};

export function titleOf(id: SourceId): string {
  return TITLES[id];
}

export interface CountedSource {
  id: SourceId;
  programLinks: number;
  sourceRefs: number;
  refsWithoutUrl: number;
  fetchedAt?: ProvenanceDateSpan;
  documentDate?: ProvenanceDateSpan;
  urlHosts: { host: string; refs: number }[];
  distinctUrls: number;
  distinctBoards: number;
  evidence: { href: string; label: string }[];
}

export interface SourceCensus {
  shardFiles: number;
  programRecords: number;
  duplicateIds: number;
  programsWithoutSources: number;
  sources: CountedSource[];
  districtCopies: DataProvenance["districtCopies"];
  overlap: DataProvenance["overlap"];
  urlCoverage: DataProvenance["urlCoverage"];
}

interface DateBucket {
  min?: string;
  max?: string;
  dated: number;
  missing: number;
  year: number;
  month: number;
  day: number;
}

interface KindBucket {
  refs: number;
  refsWithoutUrl: number;
  programs: Set<string>;
  hosts: Map<string, number>;
  urls: Set<string>;
  boards: Set<string>;
  evidence: Map<string, string>;
  fetched: DateBucket;
  updated: DateBucket;
}

export interface CensusProgram {
  id: string;
  name?: string;
  regionLabel?: string;
  url?: unknown;
  sources?: { source?: string; id?: string; url?: unknown; fetchedAt?: unknown; updatedAt?: unknown }[];
}

function emptyDates(): DateBucket {
  return { dated: 0, missing: 0, year: 0, month: 0, day: 0 };
}

function noteDate(bucket: DateBucket, value: unknown): void {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    bucket.missing += 1;
    return;
  }
  bucket.dated += 1;
  if (value.length === 4) bucket.year += 1;
  else if (value.length === 7) bucket.month += 1;
  else bucket.day += 1;
  if (!bucket.min || value < bucket.min) bucket.min = value;
  if (!bucket.max || value > bucket.max) bucket.max = value;
}

function spanOf(bucket: DateBucket): ProvenanceDateSpan | undefined {
  if (!bucket.min || !bucket.max || bucket.dated === 0) return undefined;
  const kinds = [bucket.year, bucket.month, bucket.day].filter(count => count > 0).length;
  const precision = kinds > 1 ? "mixed" : bucket.year > 0 ? "year" : bucket.month > 0 ? "month" : "day";
  return { min: bucket.min, max: bucket.max, datedRefs: bucket.dated, missingRefs: bucket.missing, precision,
    granularity: { year: bucket.year, month: bucket.month, day: bucket.day } };
}

function isSourceId(value: string | undefined): value is SourceId {
  return SOURCE_ORDER.some((id) => id === value);
}

export function createSourceCensus(shardFiles: number) {
  const seen = new Set<string>();
  const kinds = new Map<SourceId, KindBucket>();
  const groups = new Map<string, { count: number; regions: Set<string>; kinds: Set<SourceId> }>();
  const byKindCount: Record<string, number> = {};
  let duplicateIds = 0;
  let programsWithoutSources = 0;
  let programsWithRecordedUrl = 0;
  let programsWithoutAnyUrl = 0;
  let welfare100OnlyWithoutUrl = 0;

  const bucketFor = (id: SourceId): KindBucket => {
    const found = kinds.get(id);
    if (found) return found;
    const created: KindBucket = {
      refs: 0,
      refsWithoutUrl: 0,
      programs: new Set(),
      hosts: new Map(),
      urls: new Set(),
      boards: new Set(),
      evidence: new Map(),
      fetched: emptyDates(),
      updated: emptyDates(),
    };
    kinds.set(id, created);
    return created;
  };

  return {
    add(program: CensusProgram): void {
      if (!program.id) throw new Error("Detail record is missing an id");
      if (seen.has(program.id)) {
        duplicateIds += 1;
        return;
      }
      const sources = program.sources;
      if (sources != null && !Array.isArray(sources)) throw new Error(`Sources for ${program.id} are not a list`);
      const prepared: { id: SourceId; sourceId: string; safeUrl: string | null; fetchedAt: unknown; updatedAt: unknown }[] = [];
      for (const source of sources ?? []) {
        if (!isSourceId(source.source)) throw new Error(`Unknown source kind on ${program.id}`);
        const safeUrl = source.url == null || source.url === "" ? null : publicHttpsUrl(source.url);
        if (source.url != null && source.url !== "" && !safeUrl) {
          throw new Error(`Rejected unsafe source URL for ${source.source} on ${program.id}`);
        }
        prepared.push({ id: source.source, sourceId: source.id ?? "", safeUrl, fetchedAt: source.fetchedAt, updatedAt: source.updatedAt });
      }
      seen.add(program.id);
      const programUrl = recordedHttpUrl(program.url);
      const hasUrl = prepared.some((source) => source.safeUrl) || Boolean(programUrl);
      if (hasUrl) programsWithRecordedUrl += 1;
      else programsWithoutAnyUrl += 1;
      if (prepared.length === 0) {
        programsWithoutSources += 1;
        return;
      }
      const programKinds = new Set<SourceId>();
      const signature: string[] = [];
      for (const source of prepared) {
        const bucket = bucketFor(source.id);
        bucket.refs += 1;
        programKinds.add(source.id);
        signature.push(`${source.id}:${source.sourceId}`);
        if (!source.safeUrl) bucket.refsWithoutUrl += 1;
        else {
          const host = new URL(source.safeUrl).hostname;
          bucket.hosts.set(host, (bucket.hosts.get(host) ?? 0) + 1);
          bucket.urls.add(source.safeUrl);
          const board = new URL(source.safeUrl).searchParams.get("mid");
          if (board) bucket.boards.add(board);
          if (source.id === "manual" && !bucket.evidence.has(source.safeUrl)) {
            bucket.evidence.set(source.safeUrl, program.name?.trim() || program.id);
          }
        }
        noteDate(bucket.fetched, source.fetchedAt);
        noteDate(bucket.updated, source.updatedAt);
      }
      for (const kind of programKinds) bucketFor(kind).programs.add(program.id);
      if (!hasUrl && programKinds.size === 1 && programKinds.has("welfare100")) welfare100OnlyWithoutUrl += 1;
      const key = signature.sort().join("|");
      const group = groups.get(key) ?? { count: 0, regions: new Set<string>(), kinds: new Set(programKinds) };
      group.count += 1;
      if (program.regionLabel) group.regions.add(program.regionLabel);
      groups.set(key, group);
      if (programKinds.size >= 2) {
        const label = String(programKinds.size);
        byKindCount[label] = (byKindCount[label] ?? 0) + 1;
      }
    },
    finish(): SourceCensus {
      const sources: CountedSource[] = SOURCE_ORDER.filter((id) => kinds.has(id)).map((id) => {
        const bucket = kinds.get(id)!;
        return {
          id,
          programLinks: bucket.programs.size,
          sourceRefs: bucket.refs,
          refsWithoutUrl: bucket.refsWithoutUrl,
          fetchedAt: spanOf(bucket.fetched),
          documentDate: spanOf(bucket.updated),
          urlHosts: [...bucket.hosts.entries()]
            .map(([host, refs]) => ({ host, refs }))
            .sort((a, b) => b.refs - a.refs || a.host.localeCompare(b.host)),
          distinctUrls: bucket.urls.size,
          distinctBoards: bucket.boards.size,
          evidence: [...bucket.evidence.entries()]
            .map(([href, label]) => ({ href, label }))
            .sort((a, b) => a.href.localeCompare(b.href)),
        };
      });
      let extraRecords = 0;
      let copyGroups = 0;
      const regions = new Set<string>();
      const sourceKinds = new Set<SourceId>();
      for (const group of groups.values()) {
        if (group.count < 2) continue;
        copyGroups += 1;
        extraRecords += group.count - 1;
        for (const region of group.regions) regions.add(region);
        for (const kind of group.kinds) sourceKinds.add(kind);
      }
      const sourceKindLinkSum = sources.reduce((sum, source) => sum + source.programLinks, 0);
      const orderedKindCount: Record<string, number> = {};
      for (const key of Object.keys(byKindCount).sort((a, b) => Number(a) - Number(b))) orderedKindCount[key] = byKindCount[key];
      return {
        shardFiles,
        programRecords: seen.size,
        duplicateIds,
        programsWithoutSources,
        sources,
        districtCopies: {
          extraRecords,
          groups: copyGroups,
          regions: [...regions].sort((a, b) => a.localeCompare(b, "ko")),
          sourceKinds: SOURCE_ORDER.filter((id) => sourceKinds.has(id)),
        },
        overlap: {
          sourceKindLinkSum,
          programsWithMultipleSourceKinds: Object.values(byKindCount).reduce((sum, count) => sum + count, 0),
          byKindCount: orderedKindCount,
        },
        urlCoverage: { programsWithRecordedUrl, programsWithoutAnyUrl, welfare100OnlyWithoutUrl },
      };
    },
  };
}

interface GuideLink {
  href: string;
  label: string;
  role: ProvenanceLinkRole;
}

const SOURCE_LINKS: Record<SourceId, GuideLink[]> = {
  gov24: [
    { href: "https://www.gov.kr/portal/rcvfvrSvc/main", label: "정부24 혜택 원문", role: "original" },
    { href: "https://www.data.go.kr/data/15113968/openapi.do", label: "공공데이터포털에서 정부24 API 보기", role: "provider-api" },
  ],
  bokjiro: [
    { href: "https://www.bokjiro.go.kr/", label: "복지로 누리집", role: "original" },
    { href: "https://www.data.go.kr/data/15090532/openapi.do", label: "공공데이터포털에서 복지로 중앙부처 API 보기", role: "provider-api" },
    { href: "https://www.data.go.kr/data/15108347/openapi.do", label: "공공데이터포털에서 복지로 지자체 API 보기", role: "provider-api" },
  ],
  icare: [
    { href: "https://www.mohw.go.kr/menu.es?mid=a60600000000", label: "보건복지부 통합돌봄 메뉴판 목록", role: "original" },
  ],
  welfare100: [],
  manual: [],
};

const DOCUMENT_DATE: Record<SourceId, { label: string; meaning: string }> = {
  gov24: { label: "서비스 수정일", meaning: "원문이 수정된 날이며 수집일이 아닙니다." },
  bokjiro: { label: "최종수정일", meaning: "원문 최종수정일이 있는 표기만 범위에 넣었고, 수집일이 아닙니다." },
  icare: { label: "메뉴판 기준월", meaning: "메뉴판 문서의 기준월이며 수집일이 아닙니다." },
  welfare100: { label: "색인 기준일", meaning: "개별 원문 주소가 없는 요약의 기준일이며 수집일과 다릅니다." },
  manual: { label: "누리집 확인일", meaning: "공식 누리집을 확인한 날입니다. 별도의 문서 날짜는 없습니다." },
};

function checkedLink(link: GuideLink, where: string): ProvenanceLink {
  const href = publicHttpsUrl(link.href);
  if (!href) throw new Error(`Rejected unsafe catalog URL for ${where}`);
  return { href, label: link.label, role: link.role };
}

export interface ProvenanceContext {
  bundleGeneratedAt: string;
  metaUniquePrograms: number;
  metaPlacements: number;
  forms: DataProvenance["forms"];
  pipelineInputs: DataProvenance["pipelineInputs"];
  regionalOperations?: number;
}

export function assembleProvenance(census: SourceCensus, context: ProvenanceContext): DataProvenance {
  const sources: ProvenanceSource[] = census.sources.map((source) => {
    const links = SOURCE_LINKS[source.id].map((link) => checkedLink(link, source.id));
    for (const evidence of source.evidence) {
      const href = publicHttpsUrl(evidence.href);
      if (!href) throw new Error(`Rejected unsafe evidence URL for ${source.id}`);
      links.push({ href, label: evidence.label, role: "evidence" });
    }
    const documentMeta = DOCUMENT_DATE[source.id];
    const manualSameDay = source.id === "manual" && source.fetchedAt && source.documentDate
      && source.fetchedAt.min === source.documentDate.min && source.fetchedAt.max === source.documentDate.max;
    const mixedMenuDate = source.id === "icare" && source.documentDate?.precision === "mixed";
    const yearReferences = source.documentDate?.granularity?.year ?? 0;
    const documentDate = source.documentDate
      ? {
          ...source.documentDate,
          label: yearReferences > 0 ? "기준 시점·최종수정일" : mixedMenuDate ? "기준 시점" : documentMeta.label,
          meaning: manualSameDay
            ? "자료에 적힌 날짜는 확인일이며, 별도의 문서 날짜는 없습니다."
            : yearReferences > 0
              ? `연도만 기록된 기준값 ${koCount(yearReferences)}개를 포함합니다. 연도 기준 표기는 정확한 수정 날짜나 수집일이 아니며, 날짜까지 있는 기록과 구분해서 보아야 합니다.`
            : mixedMenuDate
              ? "메뉴판 문서에 적힌 기준 시점입니다. 월만 있는 값과 날짜까지 있는 값이 함께 있으며, 수집일이 아닙니다."
              : documentMeta.meaning,
        }
      : undefined;
    const limitation = source.id === "welfare100" && source.refsWithoutUrl === source.sourceRefs && source.sourceRefs > 0
      ? "핵심 복지 100선은 운영자가 정리한 요약이고 공식 API가 아닙니다. 개별 원문 주소가 비어 있어 복지로 페이지로 이어 주지 않습니다."
      : source.id === "icare"
        ? "이 묶음의 통합돌봄 자료는 OpenAPI로 직접 수집한 것이 아니라 선행 대시보드 수집본을 읽은 것이고, 공적 원출처는 보건복지부 통합돌봄 메뉴판입니다. 나중에 원문을 다시 받는 코드가 이 묶음에 반영된 것은 아닙니다."
        : undefined;
    return {
      id: source.id,
      title: titleOf(source.id),
      programLinks: source.programLinks,
      sourceRefs: source.sourceRefs,
      refsWithoutUrl: source.refsWithoutUrl,
      ...(source.fetchedAt ? { fetchedAt: source.fetchedAt } : {}),
      ...(documentDate ? { documentDate } : {}),
      urlHosts: source.urlHosts,
      distinctUrls: source.distinctUrls,
      distinctBoards: source.distinctBoards,
      links,
      ...(limitation ? { limitation } : {}),
    };
  });
  return {
    schema: 1,
    basis: {
      detailDir: "public/bundles/v1/details",
      shardFiles: census.shardFiles,
      programRecords: census.programRecords,
      duplicateIds: census.duplicateIds,
      programsWithoutSources: census.programsWithoutSources,
    },
    bundleGeneratedAt: context.bundleGeneratedAt,
    metaUniquePrograms: context.metaUniquePrograms,
    metaPlacements: context.metaPlacements,
    districtCopies: census.districtCopies,
    overlap: census.overlap,
    urlCoverage: census.urlCoverage,
    sources,
    forms: context.forms,
    pipelineInputs: context.pipelineInputs,
    outsideDetail: {
      rawInputRecords: context.pipelineInputs.reduce((sum, row) => sum + row.records, 0),
      ...(context.regionalOperations != null ? { regionalOperations: context.regionalOperations } : {}),
    },
  };
}

export function assertPublicProvenance(doc: DataProvenance): void {
  const text = JSON.stringify(doc);
  if (SECRET_TEXT.test(text) || /javascript:|data:text|localhost|127\.0\.0\.1/i.test(text)) {
    throw new Error("Provenance document contains a secret or unsafe URL marker");
  }
  if (/[A-Za-z]:\\Users\\|\/root\/|\\\\Users\\/i.test(text)) {
    throw new Error("Provenance document contains a private path");
  }
  if (doc.urlCoverage.programsWithRecordedUrl + doc.urlCoverage.programsWithoutAnyUrl !== doc.basis.programRecords) {
    throw new Error("URL coverage does not add up to the detail record count");
  }
  if (doc.outsideDetail.rawInputRecords !== doc.pipelineInputs.reduce((sum, row) => sum + row.records, 0)) {
    throw new Error("Raw input total does not match the pipeline inputs");
  }
  for (const source of doc.sources) {
    for (const link of source.links) {
      if (publicHttpsUrl(link.href) !== link.href) throw new Error(`Provenance link is not public https: ${source.id}`);
    }
  }
  if (doc.overlap.sourceKindLinkSum === doc.basis.programRecords && doc.overlap.programsWithMultipleSourceKinds > 0) {
    throw new Error("Source-link sum was stored as the program count");
  }
}
