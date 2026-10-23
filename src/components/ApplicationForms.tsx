"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Program } from "@/lib/data/types";
import { lawPortalUrl, loadProgramForms, type LoadedProgramForms } from "@/lib/client/forms";
import { externalFormUrl, formAssetUrl, agencyFormUrl, agencyProgramGuideUrl } from "@/lib/data/formPublication";
import { FORM_STATUS_LABEL, INVESTIGATION_LABEL, INVESTIGATION_NOTE, publicSourceUrl, type ApplicationForm, type FormLink } from "@/lib/data/forms";
import { writingTemplate } from "@/lib/data/formWritingRegistry";
import { loadPaperEntries } from "@/lib/client/paperWriting";
import { loadHwpxDownloads, hwpxDownloadFor } from "@/lib/client/verifiedHwpxDownloads";
import type { HwpxDownloadEntry } from "@/lib/data/paperWritingTypes";
import type { PaperIndexEntry } from "@/lib/data/paperWritingTypes";
import styles from "./ApplicationForms.module.css";

const SOURCE_LABEL = { ordin: "조례", law: "법령", rule: "행정규칙", agency: "기관 공식 배포" } as const;
const DATE_LABEL = { effective: "시행일", promulgated: "공포일", issued: "발령일", published: "게시일", checked: "공식배포 확인일" } as const;
const FILE_TYPE = /\.(hwpx?|pdf|docx?|xlsx?|zip)(?:$|[?#])/i;
const number = (value: number) => value.toLocaleString("ko-KR");
const sourceKey = (value: string) => {
  try { const url = new URL(value); url.searchParams.sort(); return url.href; }
  catch { return value; }
};
const formTitle = (form: ApplicationForm) => {
  if (form.displayTitle) return form.displayTitle;
  const shortened = form.title.replace(/^\[.*?\]\s*/, "").trim();
  return shortened && shortened !== "외" ? shortened : form.title;
};
/** 근거와 날짜는 자료 그대로 — 공포일·발령일을 시행일로 적지 않는다. */
export function basisText(form: ApplicationForm) {
  const kind = SOURCE_LABEL[form.sourceKind ?? (form.regionCode === "national" ? "law" : "ordin")];
  if (form.sourceKind === "agency") return `${kind} · ${DATE_LABEL[form.dateKind ?? "checked"]} ${form.effectiveDate}`;
  return `근거 ${kind} ${DATE_LABEL[form.dateKind ?? "effective"]} ${form.effectiveDate}`;
}

export function ApplicationForms({ program, parentMode = false, preferredSigungu }: { program: Program; parentMode?: boolean; preferredSigungu?: string | null }) {
  const [result, setResult] = useState<{ id: string; value: LoadedProgramForms | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedMunicipality, setSelectedMunicipality] = useState<{ programId: string; code: string } | null>(null);
  const [paper, setPaper] = useState<{ id: string; rows: Record<string, PaperIndexEntry> } | null>(null);
  const [hwpx, setHwpx] = useState<{ id: string; rows: Record<string, HwpxDownloadEntry> } | null>(null);
  useEffect(() => {
    let alive = true;
    loadProgramForms(program.id).then(value => { if (alive) setResult({ id: program.id, value }); });
    return () => { alive = false; };
  }, [program.id, attempt]);
  const loading = !result || result.id !== program.id;
  const data = loading ? null : result.value;
  // 검증된 변환본이 있는 서식만 화면 작성을 열어 준다. 읽지 못하면 원본 받기만 남는다.
  const linkedFormIds = (data?.entry.links ?? []).map(link => link.formId).join(",");
  useEffect(() => {
    if (!linkedFormIds) return;
    let alive = true;
    loadPaperEntries(linkedFormIds.split(",")).then(rows => { if (alive) setPaper({ id: program.id, rows }); });
    loadHwpxDownloads(linkedFormIds.split(",")).then(rows => { if (alive) setHwpx({ id: program.id, rows }); });
    return () => { alive = false; };
  }, [program.id, linkedFormIds]);
  const paperRows = paper?.id === program.id ? paper.rows : {};
  const hwpxRows = hwpx?.id === program.id ? hwpx.rows : {};
  // 지역 전용 대안은 그 지역을 고른 사람에게만 보인다. 하나뿐이어도 기본으로 보여 주지 않는다.
  const regionalOf = (link: FormLink) => link.municipalApplicationReference ?? link.nationalMunicipalIntakeReference ?? null;
  const municipalities = [...new Map((data?.entry.links ?? []).flatMap(link => {
    const ref = regionalOf(link);
    return ref ? [[ref.sigungu, ref.municipality] as const] : [];
  })).entries()].sort((a, b) => a[1].localeCompare(b[1], "ko"));
  const chooseMunicipality = municipalities.length > 1 || !!data?.entry.links.some(link => link.nationalMunicipalIntakeReference);
  const hasCommonForm = (data?.entry.links ?? []).some(link => !regionalOf(link));
  const municipality = selectedMunicipality?.programId === program.id ? selectedMunicipality.code
    : municipalities.some(([code]) => code === preferredSigungu) ? preferredSigungu! : "";
  const visibleLinks = (data?.entry.links ?? []).filter(link => {
    const ref = regionalOf(link);
    return !ref || !chooseMunicipality || ref.sigungu === municipality;
  });
  const official = externalFormUrl(program.url);
  const online = externalFormUrl(data?.entry.applyUrl);
  const portal = data?.entry.portalSearch;
  const portalDay = portal?.checkedAt.slice(0, 10);
  const agencySourceDay = data?.forms.filter(form => form.sourceKind === "agency")
    .map(form => form.agency?.checkedAt ?? form.fetchedAt).sort().at(-1);
  const candidates = data?.candidateForms ?? [];
  // 받지 못한 후보가 있어도 '없음'으로 보이지 않게, 자료에 적힌 전체 건수를 함께 쓴다.
  const candidateCount = Math.max(portal?.candidateCount ?? 0, (data?.entry.candidateFormIds ?? []).length, candidates.length);
  const census = data?.entry.investigation;
  // 공식 안내 페이지의 첨부자료는 '찾은 자료'일 뿐 승인한 신청서가 아니다 — 목록을 따로 둔다.
  const approvedSources = new Set((data?.forms ?? []).flatMap(form => [form.sourceUrl, ...(form.agency ? [form.agency.finalUrl] : [])]).map(sourceKey));
  const attachments = (census?.sourceLinks ?? []).filter(link => link.kind === "attachment" && publicSourceUrl(link.url)
    && !approvedSources.has(sourceKey(link.url)));
  const pages = (census?.sourceLinks ?? []).filter(link => link.kind === "official_page" && publicSourceUrl(link.url));
  const hidden = (census?.sourceLinkTotal ?? 0) - (census?.sourceLinks.length ?? 0);
  const hiddenNames = (census?.documentNameTotal ?? 0) - (census?.documentNames.length ?? 0);
  return (
    <div className={styles.panel} data-testid="application-forms" aria-labelledby="application-forms-title">
      <div className={styles.heading}>
        <h3 id="application-forms-title">신청서와 준비서류</h3>
        {data && <span className={styles.status} data-status={data.entry.status}>{FORM_STATUS_LABEL[data.entry.status]}</span>}
      </div>
      {loading ? <p role="status">신청서 연결 정보를 확인하고 있어요.</p> : !data ? (
        <div role="status"><p>서식 연결 정보를 불러오지 못했어요. 신청서가 없다는 뜻은 아니에요.</p><button type="button" className="btn btn-quiet" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>다시 확인하기</button></div>
      ) : data.entry.status === "available" ? (
        <>
          <p>아래는 원문과의 연결을 확인한 작성용 서식이에요. 접수기관의 신청 안내도 함께 확인해 주세요.</p>
          {!data.entry.links.some(link => link.use === "main") && <p className={styles.note}>현재 연결한 것은 함께 준비하거나 해당되는 경우에 내는 서류예요. 주신청서와 전체 구비서류는 공식 신청 안내에서 확인해 주세요.</p>}
          {chooseMunicipality && <div className={styles.municipalityPicker}>
            <label htmlFor="application-forms-municipality">신청할 시·군·구</label>
            <select id="application-forms-municipality" value={municipality} onChange={event => setSelectedMunicipality({ programId: program.id, code: event.target.value })}>
              <option value="">{hasCommonForm ? "공통 서식 보기" : "시·군을 선택해 주세요"}</option>
              {municipalities.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
            <p className="small muted">{hasCommonForm ? "공통 서식은 지역 선택 없이 볼 수 있어요. 지역을 선택하면 해당 시·군·구 접수용 서식도 함께 보여드려요." : "지역을 선택하면 해당 시·군·구의 신청서를 보여드려요."}</p>
          </div>}
          <ul className={styles.files}>
            {visibleLinks.map(link => {
              const form = data.forms.find(item => item.id === link.formId)!;
              const title = link.displayTitle ?? formTitle(form);
               const agencySource = form.sourceKind === "agency" ? agencyFormUrl(form.id, form.sourceUrl) : null;
              const lawSource = lawPortalUrl(form.lawUrl);
              // 공식 신청 안내를 근거로 등록한 기관 서식 — 없는 법령 원문 대신 그 안내를 그대로 연다.
              const programGuide = lawSource ? null : agencyProgramGuideUrl(form);
              const hwp = formAssetUrl(form.file?.hwp), pdf = formAssetUrl(form.file?.pdf);
              const format = form.file?.format ?? (hwp?.endsWith(".hwpx") ? "hwpx" : "hwp");
              const downloadLabel = format === "hwp" || format === "hwpx" ? "한글 원본 받기" : format === "txt" ? "텍스트 원본 받기" : format === "gif" || format === "jpg" || format === "png" ? "이미지 원본 받기" : "PDF 원본 받기";
              // 받아 둔 파일이 없는 서식은 법령포털 원본을 그대로 연다 (후보가 아니라 연결을 확인한 서식만 여기 온다).
              const original = hwp ? null : lawPortalUrl(form.sourceUrl);
              const preview = pdf ?? (original ? lawPortalUrl(form.officialPdfUrl) : null);
              const originalType = original ? FILE_TYPE.exec(original)?.[1].toUpperCase() : undefined;
              // 화면 작성은 등록해 둔 원본(HWPX)과 공개 파일이 정확히 같을 때만 열어 준다.
              const writer = writingTemplate(form.id);
              const writable = writer && format === "hwpx" && hwp === writer.asset.path
                && form.file?.bytes === writer.asset.bytes && form.file?.sha256 === writer.asset.sha256;
              // HWP 원본은 검증된 변환본이 있고 그 변환이 이 원본 바이트·SHA에 묶여 있을 때만 작성을 연다.
              const converted = paperRows[form.id];
              // 사업별 검토표가 있는 서식은 그 사업에서만 작성 버튼을 연다.
              const scopedHere = !converted?.programmeIds?.length || converted.programmeIds.includes(program.id);
              const paperWritable = !writable && !!converted && scopedHere && format === "hwp" && hwp === converted.source.path
                && form.file?.bytes === converted.source.bytes && form.file?.sha256 === converted.source.sha256;
              const canWrite = writable || paperWritable;
              // 공식 원본(HWP)과 같은 내용임을 확인한 변환본. 화면 입력을 지원하지 않아도 받을 수 있다.
              const hwpxFile = hwpxDownloadFor(hwpxRows[form.id], form.file);
              return <li key={form.id}>
                <p className={styles.kind}>{link.nationalMunicipalIntakeReference ? `${link.nationalMunicipalIntakeReference.municipality} 접수용 (선택)` : link.municipalApplicationReference ? `${link.municipalApplicationReference.municipality} 방문 접수용` : link.use === "main" ? "신청서" : link.use === "conditional" ? "해당하는 경우" : "함께 확인할 서류"}</p>
                <h4>{title}</h4>
                {link.condition && <p>{link.condition}</p>}
                <div className={styles.actions}>
                  {preview && <a className={`btn ${canWrite ? "btn-ghost" : "btn-primary"}`} href={preview} target="_blank" rel="noopener noreferrer">서식 보기·인쇄 <span className="sr-only">(PDF, 새 창)</span></a>}
                  {canWrite && <Link className="btn btn-primary" href={`/forms/write/${form.id}?program=${encodeURIComponent(program.id)}`} data-testid={paperWritable ? "paper-writer-link" : "form-writer-link"}>화면에서 작성하기</Link>}
                  {hwp && <a className={`btn ${pdf || canWrite ? "btn-ghost" : "btn-primary"}`} href={hwp} download={title.replace(/\.(hwpx?|pdf|txt|gif|jpe?g|png)$/i, "") + "." + format}>{downloadLabel} <span>({format.toUpperCase()})</span></a>}
                  {hwpxFile && <a className="btn btn-ghost" href={hwpxFile.asset.path} download={title.replace(/\.(hwpx?|pdf|txt|gif|jpe?g|png)$/i, "") + ".hwpx"} data-testid="hwpx-download-link">HWPX로 받기 <span>(HWPX)</span></a>}
                  {original && <a className={`btn ${preview ? "btn-ghost" : "btn-primary"}`} href={original} target="_blank" rel="noopener noreferrer">법령포털 원본 받기{originalType ? ` (${originalType})` : ""}<span className="sr-only"> (새 창)</span></a>}
                </div>
                {hwpxFile && <p className="small muted">같은 서식을 <strong>한글 원본(HWP)</strong>과 <strong>HWPX</strong> 두 가지로 받을 수 있어요. 내용은 같고, 최신 한글에서 열기 편한 쪽을 고르면 돼요.</p>}
                {writable && <p className="small muted">화면에서 작성하면 원본 서식의 해당 칸에 적은 내용이 들어간 한글 파일을 받을 수 있어요. 서명·날인은 인쇄한 뒤 직접 해야 해요.</p>}
                {paperWritable && <p className="small muted">원본의 항목 순서에 맞춰 빈칸을 채울 수 있어요. 화면에서 쓰는 파일은 공식 원본(HWP)을 작성용으로 변환한 양식이고, 위 <strong>한글 원본 받기</strong>로 공식 원본을 그대로 받을 수 있어요. 서명·날인과 동의 표시는 인쇄한 뒤 직접 해야 해요.</p>}
                <p className={styles.dates}>{basisText(form)} · {`연결 확인일 ${link.checkedAt}`}</p>
                <p className={styles.source}><a href={agencySource ?? (original ? lawSource ?? original : externalFormUrl(form.sourceUrl)!)} target="_blank" rel="noopener noreferrer">{original ? "근거 법령 원문" : "공식 서식 원본"}<span className="sr-only"> (새 창)</span></a>{agencySource && lawSource && <> · <a href={lawSource} target="_blank" rel="noopener noreferrer">근거 조례 원문<span className="sr-only"> (새 창)</span></a></>}{agencySource && programGuide && <> · <a href={programGuide} target="_blank" rel="noopener noreferrer">공식 신청 안내<span className="sr-only"> (새 창)</span></a></>}{externalFormUrl(link.evidenceUrl) && <> · <a href={externalFormUrl(link.evidenceUrl)!} target="_blank" rel="noopener noreferrer">신청 근거 확인<span className="sr-only"> (새 창)</span></a></>}</p>
              </li>;
            })}
          </ul>
          <p className="small muted">작성한 서식은 신청처에 제출하세요. 추가 증빙은 공식 안내를 확인하세요.</p>
        </>
      ) : (
        <div className={styles.empty}>
          <p>{attachments.length ? "공식 안내 페이지의 첨부자료를 아래에서 확인할 수 있어요. 이 사업에 사용할 신청서인지 확인이 필요해요." : data.entry.status === "online" ? "자료에 안내된 온라인 신청 창구를 확인할 수 있어요." : data.entry.status === "review" ? "관련 서식의 적용 여부를 검토하고 있어요. 공식 신청 안내에서 필요한 서류를 확인해 주세요." : "아직 연결을 확인한 신청서가 없어요. 신청서가 필요 없다는 뜻은 아니에요."}</p>
          {online && <a className="btn btn-primary" href={online} target="_blank" rel="noopener noreferrer">공식 신청 안내 열기<span className="sr-only"> (새 창)</span></a>}
          {!online && official && <a className="btn btn-quiet" href={official} target="_blank" rel="noopener noreferrer">공식 사업 안내 확인<span className="sr-only"> (새 창)</span></a>}
        </div>
      )}
      {portal && <p className={styles.portal} data-testid="forms-portal-search">{
        agencySourceDay ? `공식 서식 원문과 대조해 연결했어요. (출처 확인일 ${agencySourceDay})`
          : portal.outcome === "not_found" ? `법령포털 서식 목록을 사업명·근거 법규와 대조했지만 연결 후보를 찾지 못했어요. 모든 본문과 파일을 확인했다는 뜻은 아니며, 담당기관 공고에 서식이 따로 있을 수 있어요. (법령포털 확인일 ${portalDay})`
          : portal.outcome === "incomplete" ? `법령포털 서식을 아직 모두 확인하지 못했어요. 서식이 없다는 뜻은 아니에요. (법령포털 확인일 ${portalDay})`
            : portal.outcome === "candidate" ? `법령포털 서식에서 관련 서식 ${number(candidateCount)}개를 찾았고, 이 사업에 적용되는지 확인 중이에요. (법령포털 확인일 ${portalDay})`
              : `법령포털 서식 원문과 대조해 연결했어요. (법령포털 확인일 ${portalDay})`
      }</p>}
      {census && <section className={styles.census} data-testid="forms-investigation" aria-labelledby="forms-investigation-title">
        <h4 id="forms-investigation-title" className={styles.censusTitle}>지금까지 확인한 내용 · {INVESTIGATION_LABEL[census.state]}</h4>
        <p>{INVESTIGATION_NOTE[census.state]}</p>
        {!!attachments.length && <div className={styles.block} data-testid="forms-source-attachments">
          <p className={styles.kind}>공식 안내 페이지에 올라온 자료</p>
          <p className="small">담당기관이 이 사업 안내 페이지에 올려 둔 자료예요. 제목은 원래 그대로 적었어요. 이 사업의 신청서가 맞는지, 다른 서류가 더 필요한지 아직 확인하지 못해서 &lsquo;확인한 신청서&rsquo;와 따로 두었어요.</p>
          <ul className={styles.links}>
            {attachments.map(link => <li key={link.url}><a href={publicSourceUrl(link.url)!} target="_blank" rel="noopener noreferrer">{link.title}<span className="sr-only"> (기관 안내 페이지의 자료, 새 창)</span></a>{link.note && <p className="small muted">확인 메모: {link.note}</p>}</li>)}
          </ul>
          {hidden > 0 && <p className="small muted">이 사업에서 찾은 자료는 모두 {number(census.sourceLinkTotal!)}건이고, 그중 {number(census.sourceLinks.length)}건을 보여 드려요.</p>}
        </div>}
        {!!census.documentNames.length && <div className={styles.block} data-testid="forms-document-names">
          <p className={styles.kind}>자료에 적힌 준비서류</p>
          <ul className={styles.names}>{census.documentNames.map(name => <li key={name}>{name}</li>)}</ul>
          <p className="small muted">공식 자료에 적힌 이름을 그대로 옮겼어요{hiddenNames > 0 ? ` (모두 ${number(census.documentNameTotal!)}건 중 ${number(census.documentNames.length)}건)` : ""}. 제출할 서류와 양식은 담당기관의 최신 안내도 확인해 주세요.</p>
        </div>}
        <details className={styles.detail} data-testid="forms-investigation-detail">
          <summary>어디까지 확인했는지 보기</summary>
          <ul className={styles.names}>
            <li>법령·자치법규 본문: {census.lawChecks.searched ? <>{number(census.lawChecks.searched)}건을 찾아보고 {number(census.lawChecks.read)}건을 실제로 열어 읽었어요. {census.lawChecks.failed ? `${number(census.lawChecks.failed)}건은 확인을 마치지 못했어요.` : "조회 대상으로 정한 본문은 모두 읽었어요."}</> : "자료에서 조회할 법규를 특정하지 못했어요."}</li>
            <li>기관 안내 페이지: {number(census.pageChecks.attempted)}곳에 조회를 시도해 {number(census.pageChecks.read)}곳을 읽었어요. {census.pageChecks.unattempted ? `${number(census.pageChecks.unattempted)}곳은 접근 제한이나 주소 확인 문제로 조회하지 못했어요. ` : ""}{census.pageChecks.failed ? `총 ${number(census.pageChecks.failed)}곳은 추가 확인이 필요해요.` : "열지 못한 페이지는 없어요."}</li>
            <li>신청서·준비서류 언급: {census.applicationMentioned ? "공식 자료에서 찾았어요." : "아직 찾지 못했어요(없다는 뜻은 아니에요)."}</li>
            <li>확인한 날: {census.checkedAt}</li>
          </ul>
          {census.note && <p className="small">{census.note}</p>}
          {!!pages.length && <ul className={styles.links}>
            {pages.map(link => <li key={link.url}><a href={publicSourceUrl(link.url)!} target="_blank" rel="noopener noreferrer">{link.title}<span className="sr-only"> (출처 페이지, 새 창)</span></a></li>)}
          </ul>}
        </details>
      </section>}
      {data && (!!candidates.length || data.candidatesIncomplete) && <details className={styles.candidates} data-testid="forms-candidates">
        <summary>법령포털에서 찾은 관련 서식 {number(candidateCount)}개 · 적용 여부 확인 중</summary>
        <p className="small">적용 여부가 확인되지 않아 신청서로 제공하지 않습니다.</p>
        {data.candidatesIncomplete ? <p className="small muted">후보 서식 정보를 일부 불러오지 못했어요. 아래 목록이 전부가 아닐 수 있어요.</p>
          : candidates.length < candidateCount ? <p className="small muted">{number(candidateCount)}개 가운데 관련 서식 앞 {number(candidates.length)}개를 보여요.</p> : null}
        {!!candidates.length && <ul className={styles.files}>
          {candidates.map(form => <li key={form.id}>
            <p className={styles.kind}>적용 여부 확인 중</p>
            <h4>{formTitle(form)}</h4>
            <p className={styles.dates}>{form.lawTitle} · {basisText(form)}</p>
            {lawPortalUrl(form.lawUrl) && <p className={styles.source}><a href={lawPortalUrl(form.lawUrl)!} target="_blank" rel="noopener noreferrer">법령 원문 보기<span className="sr-only"> (새 창)</span></a></p>}
          </li>)}
        </ul>}
      </details>}
      {(program.applyType === "auto" || program.applyType === "institution") && census?.state !== "automatic" && census?.state !== "institution"
        && <p className={styles.note}>자료상 {program.applyType === "auto" ? "자동 제공" : "기관 추천·선정"} 방식인 사업이에요. 별도 신청이나 확인이 필요한지는 담당기관에 문의해 주세요.</p>}
      {parentMode && <p className={styles.note}>부모님 대신 신청할 때는 해당 사업의 대리신청 가능 여부와 준비서류를 확인해 주세요. 부모님의 신청서와 대리인의 서류는 다를 수 있어요.</p>}
      {data?.entry.note && <p className="small muted">{data.entry.note}</p>}
      <Link className={styles.coverage} href="/forms">전체 신청 서식 →</Link>
    </div>
  );
}
