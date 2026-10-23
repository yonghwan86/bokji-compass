import type { Program } from "./types";
import type { AgencyAuthorityBasis, AgencyOriginalReview, AgencyPdfReview, AgencyVisualReview, ApplicationForm, FormLink, FormStatus, InvestigationState } from "./forms";
import sourceExclusions from "./sourceExclusions.json";
import verifiedLawHistories from "./verifiedLawHistories.json";
import verifiedAgencyForms from "./verifiedAgencyForms.json";
import verifiedStatutoryApplications from "./verifiedStatutoryApplications.json";

export type VerifiedAgencyForm = Omit<(typeof verifiedAgencyForms.forms)[keyof typeof verifiedAgencyForms.forms], "publishedAt" | "attachmentIdentifier"> & {
  publishedAt?: string; attachmentIdentifier: { queryParam?: string; value?: string; path?: string };
  /** 공식 신청 안내를 근거로 등록한 경우에만 있다. 없으면 기존 조례 근거 그대로다. */
  authorityBasis?: AgencyAuthorityBasis;
  /** 스캔 원본에만 있다. 사람이 이미지 전체(jpg) 또는 모든 페이지(pdf)를 본 기록이며 다른 형식은 가질 수 없다. */
  visualReview?: AgencyOriginalReview;
  nationalMunicipalIntakeReference?: NonNullable<FormLink["nationalMunicipalIntakeReference"]>;
};
const AGENCY_ID = /^agency-\d{5}-[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const AGENCY_SECRET = /^oc$|api[-_]?key|service[-_]?key|token|secret|password|auth|session|login|email|phone|resident|jumin/i;
function safeAgencyPath(value: string): boolean {
  try {
    for (let i=0;i<8;i++) {
      const decoded=decodeURIComponent(value);
      if (decoded===value) return !/[\\\x00-\x1f]|(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded);
      value=decoded;
    }
  } catch { return false; }
  return false;
}
function safeAgencyParameter(name: string, value: string): boolean {
  try {
    for (let i=0;i<8;i++) {
      const decoded=decodeURIComponent(name);
      if (decoded===name) return !AGENCY_SECRET.test(name) && (!/^(menu)?key$/i.test(name) || /^\d+$/.test(value));
      name=decoded;
    }
  } catch { return false; }
  return false;
}
/** Used only behind the exact registry. Public fileKey/atchFileId are not credentials. */
export function safeAgencyUrl(value: unknown): string | null {
  if (typeof value !== "string" || /[^\x21-\x7e]|[\\#]/.test(value)) return null;
  try {
    const u = new URL(value);
    if (u.href !== value || u.protocol !== "https:" || u.username || u.password || u.port || !u.hostname.includes(".")
        || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(":") || /\.(local|localhost|internal|lan|test|invalid)$/.test(u.hostname)
        || !safeAgencyPath(u.pathname) || excludedSourceReason(value) || [...u.searchParams].some(([k,v]) => !safeAgencyParameter(k,v))) return null;
    return value;
  } catch { return null; }
}
const exactDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const BASIS_FIELDS = ["kind","title","evidenceUrl","checkedAt","evidenceNote","pageSHA256"] as const;
const VISUAL_FIELDS = ["kind","checkedAt","sha256","width","height","frames","blankApplicantForm","noFilledPersonalData","evidenceNote"] as const;
const PDF_REVIEW_FIELDS = ["kind","checkedAt","sha256","pageCount","pagesRead","blankApplicantForm","noFilledPersonalData","evidenceNote"] as const;
/** 그 확인이 실제로 어느 kind인지에 따라 싣는 정확한 키 목록. */
const reviewFields = (review: AgencyOriginalReview): readonly string[] => review.kind==="whole-original-pdf" ? PDF_REVIEW_FIELDS : VISUAL_FIELDS;
const AGENCY_LAW_FIELDS = ["lawId","lawTitle","lawEvidenceUrl","lawEffectiveDate","lawCurrentCheckedAt"] as const;
const positiveInteger = (value: unknown): value is number => typeof value==="number" && Number.isSafeInteger(value) && value>0;

/**
 * 그 사업의 공식 신청 안내를 근거로 등록한 첨부. 안내 원문이 사용처를 밝힌 경우에만 쓰고,
 * 조례의 존재 여부를 주장하지 않는다. 법령 칸은 모두 빈 문자열이어야 인정한다 —
 * 안내가 법령 근거로 보이는 일을 막는다. null은 등록 거부, 빈 결과는 기존 조례 방식이다.
 */
function agencyAuthorityBasis(e: VerifiedAgencyForm): { basis?: AgencyAuthorityBasis } | null {
  const value: unknown = e.authorityBasis;
  if (value===undefined) return {};
  if (!value || typeof value!=="object" || Array.isArray(value)) return null;
  const row=value as Record<string,unknown>, entry=e as unknown as Record<string,unknown>;
  if (Object.keys(row).length!==BASIS_FIELDS.length || BASIS_FIELDS.some(key=>!(key in row))
      || row.kind!=="official-program" || typeof row.title!=="string" || !row.title.trim()
      || row.evidenceUrl!==e.sourcePageUrl || row.checkedAt!==e.checkedAt
      || typeof row.evidenceNote!=="string" || row.evidenceNote.trim().length<30
      || typeof row.pageSHA256!=="string" || !/^[a-f0-9]{64}$/.test(row.pageSHA256)
      || AGENCY_LAW_FIELDS.some(key=>entry[key]!=="")
      || ["annexId","annexNumber"].some(key=>entry[key]!==undefined && entry[key]!=="")) return null;
  return { basis: row as unknown as AgencyAuthorityBasis };
}

/**
 * 글자층이 없는 스캔 PDF 원본(pdf)의 유일한 근거 — 사람이 그 PDF의 모든 페이지를 직접 본 기록이다.
 * 등록된 바이트(SHA)·확인일·페이지 수에 묶고, pagesRead가 page-1부터 모든 페이지를 순서대로
 * 담고 sectionsRead와 같아야 한다. 일부만 본 기록이나 다른 PDF는 이 확인을 물려받지 못한다.
 * pdf만 가질 수 있으며, 글자층이 있는 PDF는 본문 글자로 스스로를 증명해야 한다.
 */
function agencyWholePdfReview(e: VerifiedAgencyForm, row: Record<string,unknown>): { review?: AgencyPdfReview } | null {
  const entry=e as unknown as Record<string,unknown>, pages=row.pageCount;
  if (entry.format!=="pdf" || Object.keys(row).length!==PDF_REVIEW_FIELDS.length || PDF_REVIEW_FIELDS.some(key=>!(key in row))
      || row.kind!=="whole-original-pdf" || row.checkedAt!==e.checkedAt || row.sha256!==e.sha256
      || !positiveInteger(pages) || !Array.isArray(row.pagesRead) || row.pagesRead.length!==pages
      || row.pagesRead.some((page,index)=>page!==`page-${index+1}`)
      || row.blankApplicantForm!==true || row.noFilledPersonalData!==true
      || typeof row.evidenceNote!=="string" || row.evidenceNote.trim().length<30
      || entry.textScope!=="all_body_sections_or_pages"
      || !Array.isArray(entry.sectionsRead) || entry.sectionsRead.length!==pages
      || entry.sectionsRead.some((section,index)=>section!==`page-${index+1}`)) return null;
  return { review: row as unknown as AgencyPdfReview };
}

/**
 * 본문 글자가 없는 이미지 원본(jpg 또는 png)의 유일한 근거 — 사람이 그 이미지 전체를 직접 본 기록이다.
 * 등록된 바이트(SHA)·확인일·프레임·픽셀 크기에 묶으므로, 바이트가 바뀌거나 다른 이미지가
 * 이 확인을 물려받지 못한다. jpg와 png만 가질 수 있고, 본문을 읽을 수 있는 형식은 주장할 수 없다.
 * null은 등록 거부, 빈 결과는 이미지가 아닌 기존 형식이다. kind가 스캔 PDF면 위의
 * 페이지 단위 확인으로 넘기므로, 두 형식이 서로의 kind를 주장할 수 없다.
 */
function agencyWholeImageReview(e: VerifiedAgencyForm): { review?: AgencyOriginalReview } | null {
  const format = (e as unknown as Record<string,unknown>).format;
  const value: unknown = e.visualReview, image = format==="jpg" || format==="png";
  if (value===undefined) return image ? null : {};
  if (!value || typeof value!=="object" || Array.isArray(value)) return null;
  if ((value as Record<string,unknown>).kind==="whole-original-pdf") return agencyWholePdfReview(e, value as Record<string,unknown>);
  if (!image) return null;
  const row=value as Record<string,unknown>, entry=e as unknown as Record<string,unknown>;
  if (Object.keys(row).length!==VISUAL_FIELDS.length || VISUAL_FIELDS.some(key=>!(key in row))
      || row.kind!=="whole-original-image" || row.checkedAt!==e.checkedAt || row.sha256!==e.sha256
      || !positiveInteger(row.width) || !positiveInteger(row.height) || row.frames!==1
      || row.width*row.height>50_000_000
      || row.blankApplicantForm!==true || row.noFilledPersonalData!==true
      || typeof row.evidenceNote!=="string" || row.evidenceNote.trim().length<30
      || entry.textScope!=="all_original_image_frames"
      || !Array.isArray(entry.sectionsRead) || entry.sectionsRead.length!==1 || entry.sectionsRead[0]!=="frame-1") return null;
  return { review: row as unknown as AgencyVisualReview };
}

/** 공개 메타데이터의 전체 확인이 등록된 확인과 글자 그대로 같은지(프레임·페이지 목록까지). */
function sameVisualReview(value: unknown, review: AgencyOriginalReview | undefined): boolean {
  if (review===undefined) return value===undefined;
  if (!value || typeof value!=="object" || Array.isArray(value)) return false;
  const row=value as Record<string,unknown>, fields=reviewFields(review), source=review as unknown as Record<string,unknown>;
  const same=(a: unknown, b: unknown) => Array.isArray(b) ? Array.isArray(a) && a.length===b.length && b.every((item,index)=>a[index]===item) : a===b;
  return Object.keys(row).length===fields.length && fields.every(key=>same(row[key],source[key]));
}

/** The existing basis: this municipality's own ordinance page on Law.go.kr. */
function registeredOrdinanceAuthority(e: VerifiedAgencyForm): boolean {
  const law = new URL(e.lawEvidenceUrl);
  return ["www.law.go.kr","law.go.kr"].includes(law.hostname) && ["/ordinInfoP.do","/LSW/ordinInfoP.do"].includes(law.pathname)
    && law.searchParams.getAll("ordinSeq").length===1 && law.searchParams.get("ordinSeq")===e.lawId && /^\d+$/.test(e.lawId)
    && [e.lawEffectiveDate,e.lawCurrentCheckedAt].every(exactDay)
    && e.lawCurrentCheckedAt===e.checkedAt && e.lawEffectiveDate<=e.checkedAt;
}

/** 공개 메타데이터의 근거가 등록된 근거와 글자 그대로 같은지. */
function sameAuthorityBasis(value: unknown, basis: AgencyAuthorityBasis | undefined): boolean {
  if (basis===undefined) return value===undefined;
  if (!value || typeof value!=="object" || Array.isArray(value)) return false;
  const row=value as Record<string,unknown>;
  return Object.keys(row).length===BASIS_FIELDS.length && BASIS_FIELDS.every(key=>row[key]===basis[key]);
}

const NATIONAL_INTAKE_FIELDS = ["kind","programmeId","sigungu","municipality","municipalPageUrl","downloadUrl",
  "sourceSHA256","municipalPageSHA256","httpStatus","checkedAt","stage","sameServiceEvidence","populationEvidence","scopeRestriction"] as const;
function sameNationalIntakeReference(value: FormLink["nationalMunicipalIntakeReference"], expected: FormLink["nationalMunicipalIntakeReference"]): boolean {
  if (value === undefined || expected === undefined) return value === expected;
  return !!value && Object.keys(value).length === NATIONAL_INTAKE_FIELDS.length
    && NATIONAL_INTAKE_FIELDS.every(key => value[key] === expected[key]);
}
function registeredNationalIntake(e: VerifiedAgencyForm): boolean {
  const ref=e.nationalMunicipalIntakeReference;
  if (ref === undefined) return true;
  if (!ref || Object.keys(ref).length!==NATIONAL_INTAKE_FIELDS.length
      || !NATIONAL_INTAKE_FIELDS.every(key=>Object.hasOwn(ref,key))
      || ref.kind!=="municipal-intake" || ref.stage!=="initial-application"
      || typeof ref.sigungu!=="string" || !/^\d{5}$/.test(ref.sigungu) || ref.sigungu.endsWith("000") || ref.sigungu!==e.regionCode
      || typeof ref.municipality!=="string" || ref.municipality.trim().length<2 || !e.regionLabel.includes(ref.municipality)
      || e.use!=="conditional" || !(e.condition??"").includes(ref.municipality)
      || ref.sourceSHA256!==e.sha256 || ref.checkedAt!==e.checkedAt || ref.httpStatus!==200
      || e.authorityBasis?.kind!=="official-program" || ref.municipalPageUrl!==e.authorityBasis.evidenceUrl
      || ref.municipalPageSHA256!==e.authorityBasis.pageSHA256
      || ref.municipalPageUrl!==e.sourcePageUrl || ref.downloadUrl!==e.sourceUrl
      || ![ref.municipalPageUrl,ref.downloadUrl].every(url=>!!safeAgencyUrl(url) && /^(gov\.kr|.+\.(go|gov)\.kr)$/.test(new URL(url).hostname))
      || e.programs.length!==1 || e.programs[0].id!==ref.programmeId) return false;
  for (const text of [ref.sameServiceEvidence,ref.populationEvidence,ref.scopeRestriction])
    if (typeof text!=="string" || text.trim().length<30 || !text.includes(ref.municipality)) return false;
  return /전용|한정|선택/.test(ref.scopeRestriction);
}

export function registeredAgencyForm(id: string): VerifiedAgencyForm | null {
  const e = (verifiedAgencyForms.forms as Record<string, VerifiedAgencyForm>)[id];
  if (!AGENCY_ID.test(id) || !e || e.id !== id || e.sourceKind !== "agency" || id.split("-")[1] !== e.regionCode) return null;
  const checked = agencyAuthorityBasis(e), image = agencyWholeImageReview(e);
  if (!checked || !image) return null;
  const basis = checked.basis, review = image.review;
  if (![e.sourcePageUrl,e.sourceUrl,e.finalUrl,e.authorityEvidenceUrl,...e.programs.map(p=>p.url),...(basis?[]:[e.lawEvidenceUrl])].every(safeAgencyUrl)) return null;
  const identity = e.attachmentIdentifier;
  const queryIdentity=Object.keys(identity).length===2 && !!identity.queryParam && !AGENCY_SECRET.test(identity.queryParam)
    && identity.value===e.attachmentId && new URL(e.sourceUrl).searchParams.getAll(identity.queryParam).length===1
    && new URL(e.sourceUrl).searchParams.get(identity.queryParam)===e.attachmentId;
  const pathIdentity=Object.keys(identity).length===1 && !!identity.path && identity.path.startsWith("/")
    && identity.path===new URL(e.sourceUrl).pathname && safeAgencyPath(identity.path);
  if (!exactDay(e.checkedAt) || (!basis && !registeredOrdinanceAuthority(e))
      || !["government","public_institution","delegated"].includes(e.authorityKind)
      || !["government","public_institution"].includes(e.authorityEvidenceKind)
      || (e.authorityEvidenceKind==="government" && !/^(gov\.kr|.+\.(go|gov)\.kr)$/.test(new URL(e.authorityEvidenceUrl).hostname))
      || (e.authorityKind==="delegated" && new URL(e.authorityEvidenceUrl).hostname===new URL(e.sourceUrl).hostname)
      || e.authorityEvidenceNote.length<30
      || (e.publishedAt!==undefined && (!exactDay(e.publishedAt) || e.publishedAt>e.checkedAt))
      || !/^[a-f0-9]{64}$/.test(e.sha256) || !Number.isSafeInteger(e.bytes) || e.bytes<=0 || !["hwp","hwpx","pdf","jpg","png"].includes(e.format)
      || !e.attachmentId || (!queryIdentity && !pathIdentity)
      || !e.programs.length || new Set(e.programs.map(p=>p.id)).size!==e.programs.length
      || !["application","consent","delegation","supporting"].includes(e.role) || !["main","additional","conditional"].includes(e.use)
      || (e.role==="delegation" && e.use!=="conditional") || (e.use==="conditional" && !e.condition)
      || e.textScope!==(review?.kind==="whole-original-image"?"all_original_image_frames":"all_body_sections_or_pages")
      || !e.sectionsRead.length || new Set(e.sectionsRead).size!==e.sectionsRead.length
      || !e.applicant || !e.selectedParts.length || e.selectedParts.some(p=>!p.number || !p.title || !p.author || !["main","additional","conditional"].includes(p.use))) return null;
  return registeredNationalIntake(e) ? e : null;
}

/**
 * 공식 신청 안내를 근거로 등록한 기관 서식의 안내 주소.
 * 등록된 근거와 글자 그대로 같을 때만 돌려준다 — 법령 근거 자리에는 쓰지 않는다.
 */
export function agencyProgramGuideUrl(form: ApplicationForm): string | null {
  if (form.sourceKind!=="agency" || form.lawUrl!=="") return null;
  let e: VerifiedAgencyForm;
  try { e=validateAgencyForm(form); } catch { return null; }
  return e.authorityBasis ? safeAgencyUrl(e.authorityBasis.evidenceUrl) : null;
}

/** Exact source/final endpoints only; registering a form never allows its whole host. */
export function agencyFormUrl(id: string, value: unknown): string | null {
  const e = registeredAgencyForm(id), safe = safeAgencyUrl(value);
  return e && safe && [e.sourceUrl,e.finalUrl].includes(safe) ? safe : null;
}

export function validateAgencyForm(form: ApplicationForm): VerifiedAgencyForm {
  const e=registeredAgencyForm(form.id), a=form.agency;
  if (!e || !a || form.sourceKind!=="agency" || form.title!==e.title || form.role!==e.role
      || form.sourceUrl!==e.sourceUrl || form.lawUrl!==e.lawEvidenceUrl || form.lawId!==e.lawId || form.lawTitle!==e.lawTitle
      || form.regionCode!==e.regionCode || form.regionLabel!==e.regionLabel || form.annexId!=="" || form.annexNumber!==""
      || form.fetchedAt!==e.checkedAt || form.dateKind!==(e.publishedAt?"published":"checked") || form.effectiveDate!==(e.publishedAt??e.checkedAt)
      || (["agencyName","sourcePageUrl","finalUrl","attachmentId","sha256","bytes","format","checkedAt","authorityEvidenceUrl"] as const).some(k=>a[k]!==e[k])
      || !sameAuthorityBasis(a.authorityBasis,e.authorityBasis) || !sameVisualReview(a.visualReview,e.visualReview)
      || form.officialPdfUrl || (form.displayTitle!==undefined && form.displayTitle!==e.title)
      || (form.file && (form.file.sha256!==e.sha256 || form.file.bytes!==e.bytes || form.file.format!==e.format
          || form.file.hwp!==`/forms/files/${e.id}-${e.sha256.slice(0,12)}.${e.format}`
          || (form.file.pdf!==undefined && (e.format!=="pdf" || form.file.pdf!==form.file.hwp))))) throw new Error("Agency source identity mismatch");
  return e;
}

export function agencyProgramLinkMatches(id: string, form: ApplicationForm, link: FormLink): boolean {
  let e: VerifiedAgencyForm;
  try { e=validateAgencyForm(form); } catch { return false; }
  const p=e.programs.find(p=>p.id===id);
  return !!p && link.formId===e.id && link.programEvidenceUrl===p.url && link.evidenceUrl===e.sourcePageUrl
    && link.checkedAt===e.checkedAt && link.use===e.use && (link.condition??"")===(e.condition??"")
    && (e.nationalMunicipalIntakeReference ? link.scopeBasis==="national-municipal-intake-reference"
      && sameNationalIntakeReference(link.nationalMunicipalIntakeReference,e.nationalMunicipalIntakeReference)
      : !link.scopeBasis && !link.nationalMunicipalIntakeReference)
    && !link.renamedLawReference && !link.municipalApplicationReference
    && (link.displayTitle===undefined || link.displayTitle===e.title);
}

export function excludedSourceReason(value: unknown): string | undefined {
  if (typeof value!=="string") return undefined;
  try { return sourceExclusions.hosts.find(row=>row.host===new URL(value).hostname.toLowerCase())?.reason; }
  catch { return undefined; }
}

export function externalFormUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !excludedSourceReason(value) ? url.href : null;
  } catch { return null; }
}

export function formAssetUrl(value: unknown): string | null {
  if (typeof value!=="string") return null;
  if (/^\/forms\/files\/(ordin|law|rule)-\d+-[a-f0-9]{12}\.(hwp|hwpx|pdf|txt|gif)$/.test(value)) return value;
  // jpg exists only as a registered agency original; the portal keeps its own formats.
  const match=/^\/forms\/files\/(agency-\d{5}-[a-zA-Z0-9][a-zA-Z0-9_-]{0,79})-([a-f0-9]{12})\.(hwp|hwpx|pdf|jpg|png)$/.exec(value);
  const e=match && registeredAgencyForm(match[1]);
  return e && match[2]===e.sha256.slice(0,12) && match[3]===e.format ? value : null;
}

/** Official external annex links must never carry an API credential. */
export function officialFormUrl(value: unknown): string | null {
  const safe = externalFormUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.protocol !== "https:" || !["www.law.go.kr", "law.go.kr"].includes(url.hostname)) return null;
  if ([...url.searchParams.keys()].some(key => /^oc$|key|token|secret|password|auth|login|email|phone|resident/i.test(key))) return null;
  return safe;
}

const normalizedLaw = (text: string) => text.normalize("NFKC").replace(/[「」『』\s·ㆍᆞ・･‧․]/g, "").replace(/\(제[^)]*\)/g, "").replace(/제\d+조.*$/, "");
function referencedFormLaw(program: Program, form: Pick<ApplicationForm, "lawTitle"> & Partial<Pick<ApplicationForm,"regionCode"|"regionLabel">>): boolean {
  // Official benefit records also cite "조례, 시행규칙" or "조례 및 시행규칙".
  // These are the same named law family, not a different jurisdiction's form.
  const normalize = (text: string) => {
    let title=normalizedLaw(text).replace(/(?:[,、]|및)?(?:시행규칙|시행령)$/, "");
    const aliases:Record<string,[string,string]>={"51000":["강원도","강원특별자치도"],"52000":["전라북도","전북특별자치도"],"50000":["제주도","제주특별자치도"]};
    const pair=form.regionCode===program.region?.sido ? aliases[form.regionCode??""] : undefined;
    if(pair && title.startsWith(pair[0])) title=pair[1]+title.slice(pair[0].length);
    return title;
  };
  // Split a second explicitly qualified local law before removing article tails.
  // The word "및" inside a single title (e.g. 노인 및 장애인) stays intact.
  return (program.laws || []).some(law => law.split(/\|\||\/|\s+및\s+(?=[가-힣]+(?:특별자치도|특별자치시|특별시|광역시|도|시|군|구)\s)/).some(part => normalize(part) === normalize(form.lawTitle)
    || (!!form.regionLabel && form.regionCode===program.region?.sido && normalize(form.regionLabel+part)===normalize(form.lawTitle))));
}

function reviewedRenamedLaw(program: Program, form: ApplicationForm, link: FormLink): boolean {
  const ref=link.renamedLawReference;
  const history=verifiedLawHistories.histories[form.lawId as keyof typeof verifiedLawHistories.histories];
  if (!ref || !history || link.municipalApplicationReference
      || (["stableLawId","priorLawId","transitionLawId","priorRuleTitle","currentRuleTitle","provinceCode"] as const).some(key=>ref[key]!==history[key])
      || link.scopeBasis!=="provincial-law-reference" || program.scope!=="sigungu"
      || form.sourceKind!=="ordin" || ref.kind!=="exact-stable-ordinance-history"
      || ref.programId!==program.id || ref.formLawId!==form.lawId
      || ref.provinceCode!==program.region?.sido || ref.provinceCode!==form.regionCode
      || ref.municipalityCode!==program.region?.sigungu || !/^\d{5}$/.test(ref.municipalityCode)
      || ref.municipalityCode.slice(0,2)+"000"!==ref.provinceCode
      || !/^\d+$/.test(ref.stableLawId) || ref.checkedAt!==link.checkedAt
      || !/^\d{4}-\d{2}-\d{2}$/.test(ref.checkedAt)
      || normalizedLaw(ref.currentRuleTitle)!==normalizedLaw(form.lawTitle)
      || [ref.purposeArticleLink,ref.transitionBasis,ref.scopeRestriction].some(value=>typeof value!=="string" || value.trim().length<30)) return false;
  const ids=[ref.priorLawId,ref.transitionLawId,ref.formLawId];
  const validUrl=(value:unknown,id:string)=>{
    const safe=officialFormUrl(value);
    if(!safe) return false;
    const url=new URL(safe);
    return ["/ordinInfoP.do","/LSW/ordinInfoP.do"].includes(url.pathname)
      && url.searchParams.getAll("ordinSeq").length===1 && url.searchParams.get("ordinSeq")===id;
  };
  return ids.every(id=>/^\d+$/.test(id)) && new Set(ids).size===3
    && [ref.historyEvidenceUrl,ref.transitionEvidenceUrl,ref.currentEvidenceUrl].every((url,i)=>validUrl(url,ids[i]))
    && validUrl(link.evidenceUrl,form.lawId)
    && referencedFormLaw(program,{...form,lawTitle:ref.citedLawTitle})
    && referencedFormLaw({...program,laws:[ref.citedLawTitle]},{...form,lawTitle:ref.priorRuleTitle});
}

const STATUTORY_FIELDS = ["kind","referenceId","referencedLawTitle","annexNumber","sourceSHA256","basis"] as const;
const STATUTORY_CHAIN_STEPS = ["law","regulation","notice"] as const;

/**
 * 법이 그 급여의 신청서로 전국 공통 서식 하나를 지정한 경로. 사업마다 따로 검토해
 * verifiedStatutoryApplications 에 등록한 항목에만 열리며, 링크는 그 등록을 그대로 되비춘다.
 * 사업ID·지역·인용 법률·서식·별지번호·원본 SHA·현행 3단계 조문이 모두 맞아야 하고,
 * 법령 제목 별칭이나 승인 플래그로는 통과하지 않는다. 초기 신청 단계만 받는다.
 */
function reviewedStatutoryApplication(program: Program, form: ApplicationForm, link: FormLink): boolean {
  const ref=link.scopeReference as Record<string,unknown>|undefined;
  if (!ref || ref.kind!=="statutory-chain") return false;
  // 불투명한 승인 칸을 끼워 넣지 못하게 키 집합을 정확히 맞춘다.
  if (Object.keys(ref).length!==STATUTORY_FIELDS.length || STATUTORY_FIELDS.some(key=>!(key in ref))) return false;
  const entry=(verifiedStatutoryApplications.applications as Record<string,Record<string,unknown>>)[String(ref.referenceId??"")];
  if (!entry || entry.referenceId!==ref.referenceId) return false;
  const region=program.region, place=entry.serviceFieldLocation as Record<string,unknown>|undefined;
  if (typeof entry.citedLawTitle!=="string" || !(program.laws??[]).some(title=>normalizedLaw(title)===normalizedLaw(entry.citedLawTitle as string))) return false;
  if (link.condition!==entry.condition || typeof entry.condition!=="string" || entry.condition.trim().length<30) return false;
  if (String(form.effectiveDate??"").replace(/-/g,"")!==String(entry.sourceEffectiveDate??"").replace(/-/g,"")) return false;
  if (entry.programmeId!==program.id || program.scope!=="sigungu"
      || region?.sigungu!==entry.sigungu || region?.sido!==entry.sido
      || entry.formId!==form.id || form.regionCode!=="national"
      || entry.lawId!==form.lawId || entry.annexNumber!==form.annexNumber
      || normalizedLaw(String(entry.referencedLawTitle))!==normalizedLaw(form.lawTitle)
      || entry.sourceUrl!==form.sourceUrl
      || entry.stage!=="initial-application" || entry.use!==link.use
      || entry.checkedAt!==link.checkedAt
      || typeof entry.sourceSHA256!=="string" || !/^[a-f0-9]{64}$/.test(entry.sourceSHA256)
      || ref.sourceSHA256!==entry.sourceSHA256
      || form.file?.sha256!==entry.sourceSHA256 || form.file?.bytes!==entry.sourceBytes
      || (form.file?.format??"hwp")!==entry.sourceFormat
      || typeof place!=="object" || !place || !Number.isSafeInteger(place.rowAddr) || !Number.isSafeInteger(place.colAddr)
      || typeof entry.serviceField!=="string" || entry.serviceField.trim().length<2) return false;
  for (const key of ["scopeRestriction","sourceDateCaveat"] as const)
    if (typeof entry[key]!=="string" || (entry[key] as string).trim().length<30) return false;
  if (typeof entry.municipality!=="string" || entry.municipality.length<2
      || !link.condition?.includes(entry.municipality)
      || !String(entry.scopeRestriction).includes(entry.municipality)) return false;
  // 현행 3단계가 순서대로 모두 있고 각각 공식 법령 주소여야 한다.
  const chain=entry.chain;
  if (!Array.isArray(chain) || chain.length!==STATUTORY_CHAIN_STEPS.length) return false;
  for (const [index, step] of STATUTORY_CHAIN_STEPS.entries()) {
    const row=chain[index] as Record<string,unknown>|undefined;
    if (!row || row.step!==step || typeof row.lawId!=="string" || !/^\d+$/.test(row.lawId)
        || typeof row.title!=="string" || !row.title.trim()
        || !/^제\d+조(?:의\d+)?(?:제\d+항)?$/.test(String(row.article??""))
        || typeof row.claim!=="string" || row.claim.trim().length<20
        || row.currentState!=="source_current" || row.checkedAt!==entry.checkedAt
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.effectiveDate??""))
        || String(row.effectiveDate)>String(entry.checkedAt)
        || !/^[a-f0-9]{64}$/.test(String(row.evidenceSHA256??""))
        || !/^[a-f0-9]{64}$/.test(String(row.currentIdentityEvidenceSHA256??""))
        || !officialFormUrl(String(row.url??""))) return false;
    const url=new URL(String(row.url)), idKey=step==="notice" ? "admRulSeq" : "lsiSeq";
    if (url.searchParams.getAll(idKey).length!==1 || url.searchParams.get(idKey)!==row.lawId) return false;
    if (step!=="notice" && (url.searchParams.getAll("joNo").length!==1
        || url.searchParams.get("joNo")!==/^제(\d+)조/.exec(String(row.article))?.[1].padStart(4,"0"))) return false;
  }
  if (normalizedLaw(String((chain[0] as Record<string,unknown>).title))!==normalizedLaw(String(entry.citedLawTitle))) return false;
  if ((chain[2] as Record<string,unknown>).lawId!==entry.lawId) return false;
  const receiving=entry.receivingAgency as Record<string,unknown>|undefined;
  const governmentPage=(url: unknown)=>{ const safe=externalFormUrl(url); return !!safe && /^(?:gov\.kr|.+\.(?:go|gov)\.kr)$/.test(new URL(safe).hostname); };
  // 접수기관 페이지는 광역시 산하 누리집처럼 go.kr 이 아닌 공식 주소도 있다. 안전한 공개 주소만
  // 요구하고, 정부 도메인 확인은 공개에 쓰이는 사업 페이지 쪽에 둔다.
  if (!receiving || !externalFormUrl(receiving.url) || typeof receiving.claim!=="string" || receiving.claim.trim().length<30
      || receiving.checkedAt!==entry.checkedAt || receiving.httpStatus!==200
      || !/^[a-f0-9]{64}$/.test(String(receiving.evidenceSHA256??""))
      || !/^[a-f0-9]{64}$/.test(String(entry.programmeEvidenceSHA256??""))) return false;
  if (!governmentPage(entry.programmeUrl) || externalFormUrl(link.evidenceUrl)!==externalFormUrl(entry.programmeUrl)
      || externalFormUrl(link.programEvidenceUrl)!==externalFormUrl(entry.programmeUrl)) return false;
  return [program.url,...(program.sources??[]).map(source=>source.url)].some(url=>externalFormUrl(url)===externalFormUrl(entry.programmeUrl));
}

/** 내려받은 정적 자료가 등록된 법정 체인과 같은 서식·바이트를 가리키는지. 클라이언트도 같은 기준으로 막는다. */
export function statutoryApplicationMatches(programId: string, form: ApplicationForm | undefined, link: FormLink): boolean {
  const ref=link.scopeReference;
  if (!form || ref?.kind!=="statutory-chain") return false;
  const entry=(verifiedStatutoryApplications.applications as Record<string,Record<string,unknown>>)[String(ref.referenceId??"")];
  return !!entry && Object.keys(ref).length===STATUTORY_FIELDS.length && STATUTORY_FIELDS.every(key=>key in ref)
    && link.scopeBasis==="official-application-reference"
    && entry.programmeId===programId && entry.formId===form.id && entry.annexNumber===form.annexNumber
    && entry.sourceSHA256===ref.sourceSHA256 && entry.sourceSHA256===form.file?.sha256
    && entry.sourceBytes===form.file?.bytes && entry.sourceUrl===form.sourceUrl
    && entry.use===link.use && entry.condition===link.condition && entry.checkedAt===link.checkedAt
    && entry.stage==="initial-application" && entry.lawId===form.lawId
    && normalizedLaw(String(entry.referencedLawTitle))===normalizedLaw(ref.referencedLawTitle)
    && entry.annexNumber===ref.annexNumber && ref.basis.trim().length>=30
    && entry.programmeUrl===link.evidenceUrl && entry.programmeUrl===link.programEvidenceUrl
    && entry.sourceFormat===(form.file?.format??"hwp")
    && String(entry.sourceEffectiveDate??"").replace(/-/g,"")===String(form.effectiveDate??"").replace(/-/g,"");
}

function reviewedApplicationReference(program: Program, form: ApplicationForm, link: FormLink): boolean {
  const ref=link.scopeReference;
  if (link.scopeBasis!=="official-application-reference" || form.regionCode!=="national" || !ref
      || normalizedLaw(ref.referencedLawTitle)!==normalizedLaw(form.lawTitle)
      || ref.annexNumber!==form.annexNumber || ref.basis.trim().length<30) return false;
  if (ref.kind==="statutory-chain") return reviewedStatutoryApplication(program,form,link);
  if (ref.kind==="cited-local-law") {
    const safe=officialFormUrl(link.evidenceUrl);
    return !!safe && !!ref.sourceLawId && new URL(safe).searchParams.get("ordinSeq")===ref.sourceLawId
      && /^제\d+조(?:의\d+)?(?:제\d+항)?$/.test(ref.article??"") && !!ref.sourceLawTitle
      && referencedFormLaw(program,{lawTitle:ref.sourceLawTitle});
  }
  if (ref.kind!=="program-documents") return false;
  const safe=externalFormUrl(link.evidenceUrl);
  if (!safe || !/^(?:gov\.kr|.+\.(?:go|gov)\.kr)$/.test(new URL(safe).hostname)) return false;
  return [program.url,...(program.sources??[]).map(source=>source.url)].some(url=>externalFormUrl(url)===safe);
}

function reviewedMunicipalRoute(program: Program, form: ApplicationForm, link: FormLink): boolean {
  const ref=link.municipalApplicationReference;
  if (link.scopeBasis!=="municipal-application-reference" || !ref || program.scope!=="sido"
      || form.sourceKind!=="ordin" || ref.sido!==program.region?.sido || ref.sigungu!==form.regionCode
      || !/^\d{5}$/.test(ref.sigungu) || ref.sigungu.slice(0,2)+"000"!==ref.sido || ref.sigungu===ref.sido
      || ref.municipality.trim().length<2 || !form.regionLabel.includes(ref.municipality)
      || link.use!=="conditional" || !link.condition?.includes(ref.municipality)
      || ref.httpStatus!==200 || ref.programSpecific!==true || ref.checkedAt!==link.checkedAt
      || ref.reference.length<30 || !ref.reference.includes(ref.municipality)
      || ref.formEvidence.length<30 || !ref.formEvidence.includes(ref.municipality)
      || !ref.scopeRestriction.includes(ref.municipality) || !/전용|한정/.test(ref.scopeRestriction)
      || normalizedLaw(ref.municipalArticle)!==normalizedLaw(form.lawTitle)
      || !/제\d+조/.test(ref.municipalArticle)) return false;
  const exact=externalFormUrl(link.programEvidenceUrl), supporting=externalFormUrl(ref.programEvidenceUrl);
  const government=(url:string|null)=>!!url && /^(?:gov\.kr|.+\.(?:go|gov)\.kr)$/.test(new URL(url).hostname);
  return government(exact) && government(supporting)
    && [program.url,...(program.sources??[]).map(source=>source.url)].some(url=>externalFormUrl(url)===exact);
}

function reviewedNationalMunicipalIntake(program: Program, form: ApplicationForm, link: FormLink): boolean {
  if (link.scopeBasis!=="national-municipal-intake-reference" || !link.nationalMunicipalIntakeReference
      || form.sourceKind!=="agency" || program.scope!=="national" || program.region!=null) return false;
  const entry=registeredAgencyForm(form.id), ref=entry?.nationalMunicipalIntakeReference;
  return !!entry && !!ref && ref.programmeId===program.id
    && sameNationalIntakeReference(link.nationalMunicipalIntakeReference,ref)
    && form.agency?.sha256===ref.sourceSHA256 && agencyProgramLinkMatches(program.id,form,link);
}

export function sameFormJurisdiction(program: Pick<Program, "scope" | "region">, form: ApplicationForm): boolean {
  if (form.regionCode === "national") return program.scope === "national";
  if (program.scope === "sigungu") return form.regionCode === program.region?.sigungu;
  if (program.scope === "sido") return form.regionCode === program.region?.sido;
  return false;
}

/** Fail a publication build instead of silently accepting an invalid reviewed link. */
export function validateFormLink(program: Program, form: ApplicationForm | undefined, link: FormLink): void {
  if (!form || form.id !== link.formId) throw new Error("Unknown form in reviewed association");
  const nationalIntake=reviewedNationalMunicipalIntake(program,form,link);
  if ((link.nationalMunicipalIntakeReference || link.scopeBasis==="national-municipal-intake-reference") && !nationalIntake)
    throw new Error("National municipal intake route lacks exact municipal source evidence");
  if (form.sourceKind==="agency" || form.id.startsWith("agency-")) {
    const e=validateAgencyForm(form), p=e.programs.find(p=>p.id===program.id);
    // 이 선택 접수 경로만 전국 사업과 시·군·구 기관 원본의 관할 차이를 허용한다.
    if (!p || !agencyProgramLinkMatches(program.id,form,link) || (!sameFormJurisdiction(program,form) && !nationalIntake)
        || ![program.url,...(program.sources??[]).map(s=>s.url)].includes(p.url)) throw new Error("Agency program binding mismatch");
  }
  if (link.scopeReference?.kind==="statutory-chain" && !reviewedStatutoryApplication(program,form,link))
    throw new Error("Statutory application reference lacks exact registered chain evidence");
  const municipalRoute=reviewedMunicipalRoute(program,form,link);
  const renamedLaw=reviewedRenamedLaw(program,form,link);
  if (link.renamedLawReference && !renamedLaw) throw new Error("Renamed law reference lacks exact program and official history evidence");
  if ((link.municipalApplicationReference || link.scopeBasis==="municipal-application-reference") && !municipalRoute) throw new Error("Municipal application route lacks exact conditional source evidence");
  if (!sameFormJurisdiction(program, form)) {
    const sameProvince = link.scopeBasis === "provincial-law-reference" && program.scope === "sigungu" && program.region?.sido === form.regionCode;
    const nationalReference = link.scopeBasis === "national-law-reference" && form.regionCode === "national";
    if (!municipalRoute && !renamedLaw && !nationalIntake && !reviewedApplicationReference(program,form,link) && ((!sameProvince && !nationalReference) || !referencedFormLaw(program, form))) throw new Error(`Form jurisdiction does not match program: ${program.id} / ${form.id}`);
  }
  if (!["application", "consent", "delegation", "supporting"].includes(form.role)) throw new Error("Non-applicant form cannot be published as an application");
  if (!externalFormUrl(link.evidenceUrl) || link.evidenceNote.trim().length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(link.checkedAt)) throw new Error("Reviewed association needs dated source evidence");
  if (!["main", "additional", "conditional"].includes(link.use)) throw new Error("Unknown document use");
  if (link.displayTitle!==undefined && (typeof link.displayTitle!=="string" || link.displayTitle.trim().length<2 || link.displayTitle.length>200)) throw new Error("Invalid reviewed document title");
  if ((form.role === "delegation" || link.use === "conditional") && (!link.condition?.trim() || link.use !== "conditional")) throw new Error("Conditional form needs an explicit condition");
}

export function applicationRoute(program: Pick<Program, "applyUrl" | "applyType">): string | undefined {
  if (program.applyType === "auto" || program.applyType === "institution") return undefined;
  return externalFormUrl(program.applyUrl) || undefined;
}

/** 그 사업 전용 공식 첨부자료를 이미 찾은 상태. 승인 연결이 아니므로 'available'까지 올라가지 못한다. */
export type FoundAttachmentSignal = "program-official-attachment-found";

/** 조사 단계 중 attachment_found만 신호가 된다. 준비서류 언급과 미발견 단계는 올리지 않는다. */
export function foundAttachmentSignal(state: InvestigationState | undefined): FoundAttachmentSignal | undefined {
  return state === "attachment_found" ? "program-official-attachment-found" : undefined;
}

export function formStatus(links: FormLink[], candidates: string[], onlineUrl?: string, foundAttachment?: FoundAttachmentSignal): FormStatus {
  if (links.length) return "available";
  if (onlineUrl) return "online";
  return candidates.length || foundAttachment === "program-official-attachment-found" ? "review" : "missing";
}
