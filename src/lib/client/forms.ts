import type { ApplicationForm, FormsCatalog, FormsCoverage, FormsRegionBundle, ProgramFormEntry } from "../data/forms";
import { detailBucket } from "../data/bucket";
import { formAssetUrl, externalFormUrl, validateAgencyForm, agencyProgramLinkMatches, statutoryApplicationMatches } from "../data/formPublication";

const pending = new Map<string, Promise<unknown | null>>();
const BASE = "/forms/v1";
async function get<T>(path: string): Promise<T | null> {
  if (!pending.has(path)) {
    const request = fetch(BASE + path, { signal: AbortSignal.timeout(15000) })
      .then(async response => response.ok ? response.json() : null)
      .then(data => data?.schema === 1 ? data : null)
      .catch(() => null)
      .then(data => { if (!data) pending.delete(path); return data; });
    pending.set(path, request);
  }
  return pending.get(path) as Promise<T | null>;
}

const CITIZEN_ROLES = ["application", "consent", "delegation", "supporting"];
/** 자동 검색 후보는 앞 몇 건만 보여 준다 — 샤드 요청도 그만큼만 생긴다. */
export const CANDIDATE_LIMIT = 8;
const LAW_PORTAL_HOSTS = ["www.law.go.kr", "law.go.kr"];
/** 인증 키(OC·serviceKey)나 신청인 정보가 붙은 주소는 공개 화면에 내보내지 않는다. */
const CREDENTIAL_PARAM = /^oc$|key|token|secret|password|auth|login|email|phone|resident/i;

export function formsAreaForId(id: string): string | null {
  if (/^n\.[a-zA-Z0-9._-]+$/.test(id)) return "national";
  return /^([sg]\d{5})\.[a-zA-Z0-9._-]+$/.exec(id)?.[1] || null;
}
export const loadFormsCoverage = () => get<FormsCoverage>("/coverage.json");
export function loadFormsRegion(key: string): Promise<FormsRegionBundle | null> {
  if (!/^(national|[sg]\d{5})$/.test(key)) return Promise.resolve(null);
  return get<FormsRegionBundle>(`/programs/${key}.json`);
}

/** 새로 공개하는 외부 내려받기·미리보기·법령 원문 주소는 법령포털 원문만 허용한다. */
export function lawPortalUrl(value: unknown): string | null {
  const href = externalFormUrl(value);
  if (!href) return null;
  const url = new URL(href);
  if (url.protocol !== "https:" || !LAW_PORTAL_HOSTS.includes(url.hostname)) return null;
  for (const name of url.searchParams.keys()) if (CREDENTIAL_PARAM.test(name)) return null;
  return url.href;
}

/** 연결 확인된 서식: 받아 둔 파일이 있거나, 법령포털 원문을 그대로 받을 수 있어야 공개한다. */
function publishedForm(form: ApplicationForm | undefined): form is ApplicationForm {
  if (!form || !CITIZEN_ROLES.includes(form.role) || !externalFormUrl(form.sourceUrl)) return false;
  if (form.sourceKind === "agency" || form.id.startsWith("agency-")) {
    try { validateAgencyForm(form); } catch { return false; }
    return !!form.file && !!formAssetUrl(form.file.hwp);
  }
  return form.file ? !!formAssetUrl(form.file.hwp) : !!lawPortalUrl(form.sourceUrl);
}

interface CatalogRead { forms: Record<string, ApplicationForm>; unread: (formId: string) => boolean; invalidate: () => void }
/** 전국 서식이 쌓이면 catalog.json 한 장은 너무 커진다. 샤드로 나뉘면 필요한 버킷만 받는다. */
async function readCatalog(formIds: string[], sharded: boolean): Promise<CatalogRead | null> {
  if (!sharded) {
    const catalog = await get<FormsCatalog>("/catalog.json");
    if (!catalog?.forms) { pending.delete("/catalog.json"); return null; }
    return { forms: catalog.forms, unread: () => false, invalidate: () => { pending.delete("/catalog.json"); } };
  }
  const buckets = [...new Set(formIds.map(detailBucket))];
  const shards = await Promise.all(buckets.map(bucket => get<FormsCatalog>(`/catalog/${bucket}.json`)));
  const forms: Record<string, ApplicationForm> = {};
  const unread = new Set<string>();
  buckets.forEach((bucket, index) => {
    const shard = shards[index];
    if (shard?.forms) Object.assign(forms, shard.forms);
    else { unread.add(bucket); pending.delete(`/catalog/${bucket}.json`); }
  });
  return { forms, unread: formId => unread.has(detailBucket(formId)),
    invalidate: () => { for (const bucket of buckets) pending.delete(`/catalog/${bucket}.json`); } };
}

export interface LoadedProgramForms {
  entry: ProgramFormEntry;
  forms: ApplicationForm[];
  /** 자동 검색으로 찾은 후보 서식(앞 CANDIDATE_LIMIT 건). 적용 여부는 확인 전이다. */
  candidateForms?: ApplicationForm[];
  /** 후보 서식 정보를 일부 읽지 못했다 — 후보가 없다는 뜻으로 보여서는 안 된다. */
  candidatesIncomplete?: boolean;
}
export async function loadProgramForms(id: string): Promise<LoadedProgramForms | null> {
  const key = formsAreaForId(id);
  if (!key) return null;
  const bundle = await loadFormsRegion(key);
  const entry = bundle?.programs.find(program => program.id === id);
  if (!entry) { pending.delete(`/programs/${key}.json`); return null; }
  const linkedIds = entry.links.map(link => link.formId);
  const candidateIds = (entry.candidateFormIds ?? []).slice(0, CANDIDATE_LIMIT);
  const catalog = await readCatalog([...linkedIds, ...candidateIds], bundle?.catalogSharded === true);
  if (!catalog) return null;
  const forms = linkedIds.map(formId => catalog.forms[formId]).filter(publishedForm);
  const invalid = () => {
    // A partially updated static bundle must be fetched again by the retry button.
    catalog.invalidate();
    pending.delete(`/programs/${key}.json`);
    return null;
  };
  // Missing/corrupt assets must not produce an apparently complete download panel.
  if (linkedIds.length !== forms.length) return invalid();
  if (forms.some(form => form.sourceKind === "agency" && !entry.links.some(link => agencyProgramLinkMatches(id,form,link)))) return invalid();
  // 법정 체인 경로는 내려받은 원본이 등록된 사업·서식·바이트와 그대로 같을 때만 보여 준다.
  if (entry.links.some(link => link.scopeReference?.kind === "statutory-chain"
      && !statutoryApplicationMatches(id, catalog.forms[link.formId], link))) return invalid();
  const linked = new Set(linkedIds);
  // 후보는 시민이 직접 작성하는 서식만 — 지급대장 같은 기관 서류는 후보로도 보여 주지 않는다.
  const candidateForms = candidateIds.filter(formId => !linked.has(formId)).map(formId => catalog.forms[formId])
    .filter((form): form is ApplicationForm => !!form && (CITIZEN_ROLES.includes(form.role) || form.role === "unclassified"));
  return { entry, forms, candidateForms, candidatesIncomplete: candidateIds.some(formId => catalog.unread(formId)) };
}
