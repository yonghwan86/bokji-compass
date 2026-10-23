"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadFormsCoverage, loadFormsRegion } from "@/lib/client/forms";
import {
  FORM_STATUS_LABEL, INVESTIGATION_LABEL, INVESTIGATION_NOTE, INVESTIGATION_STATES, countInvestigationStates, investigationProgressLines,
  type FormsCoverage, type FormsRegionBundle, type FormStatus, type InvestigationState,
} from "@/lib/data/forms";
import styles from "./forms.module.css";

const statuses: FormStatus[] = ["available", "online", "review", "missing"];
const number = (value: number) => value.toLocaleString("ko-KR");
/** 법령포털 수집 구분(법령·자치법규·행정규칙 별표서식) 이름 */
const SCAN_SOURCE_LABEL: Record<string, string> = {
  law: "법령 서식", licbyl: "법령 서식",
  ordin: "자치법규 서식", ordinbyl: "자치법규 서식",
  rule: "행정규칙 서식", admbyl: "행정규칙 서식",
};
export function FormsOverview({ writingCounts, hwpxDownloads }: { writingCounts?: { writable: number }; hwpxDownloads?: number }) {
  const [coverage, setCoverage] = useState<FormsCoverage | null | undefined>();
  const [areaKey, setAreaKey] = useState("g41280");
  const [region, setRegion] = useState<{ key: string; bundle: FormsRegionBundle | null } | null>(null);
  const [status, setStatus] = useState<FormStatus | "all">("all");
  const [stage, setStage] = useState<InvestigationState | "all">("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadFormsCoverage().then(result => { if (alive) setCoverage(result); });
    return () => { alive = false; };
  }, [attempt]);
  useEffect(() => {
    let alive = true;
    loadFormsRegion(areaKey).then(bundle => { if (alive) setRegion({ key: areaKey, bundle }); });
    return () => { alive = false; };
  }, [areaKey, attempt]);
  const loading = !region || region.key !== areaKey;
  const bundle = loading ? null : region.bundle;
  const filtered = useMemo(() => (bundle?.programs ?? []).filter(program =>
    (status === "all" || program.status === status) &&
    (stage === "all" || program.investigation?.state === stage) &&
    (program.name + " " + program.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [bundle, status, stage, query]);
  // 조사 결과가 실린 지역에서만 '확인 단계' 고르기를 보여 준다 — 옛 자료를 조사한 것처럼 보이면 안 된다.
  const stageCounts = useMemo(() => countInvestigationStates(bundle?.programs ?? []), [bundle]);
  const retry = () => { setRegion(null); setAttempt(value => value + 1); };
  return <div className={`wrap page ${styles.page}`}>
    <Link href="/about" className={styles.back}>← 데이터·판정 기준</Link>
    <header className={styles.header}>
      <h1 className="h1">신청 서식</h1>
      <p className="lead">서식이 없는 사업은 담당 기관에서 확인하세요.</p>
    </header>
    {coverage === undefined ? <p role="status">전국 연결 현황을 불러오고 있어요.</p> : coverage === null ? <div role="status"><p>전국 현황을 불러오지 못했어요.</p><button className="btn btn-quiet" onClick={retry}>다시 확인하기</button></div> : <>
      <section className={styles.summary} aria-labelledby="forms-national-title">
        <h2 id="forms-national-title">수록된 사업 자료 {number(coverage.totalPrograms)}건의 연결 상태</h2>
        <dl className={styles.counts}>{statuses.map(key => <div key={key}><dt>{FORM_STATUS_LABEL[key]}</dt><dd>{number(coverage.counts[key])}<span>건</span></dd></div>)}</dl>
        <p className={styles.source}>{coverage.sourceNote}</p>
        {coverage.portalScan && <p className={styles.scan} data-testid="forms-portal-scan">
          {coverage.portalScan.status === "complete"
            ? `법령포털의 별표·서식 목록 ${number(coverage.portalScan.indexedForms)}건을 수집해 수록 사업 ${number(coverage.portalScan.checkedPrograms)}건과 대조했어요(목록 대조 완료, 확인일 ${coverage.portalScan.checkedAt.slice(0, 10)}).`
            : `법령포털 서식 ${number(coverage.portalScan.indexedForms)}개를 받아 수록 사업 ${number(coverage.portalScan.checkedPrograms)}건까지 맞춰 봤어요. 전수 확인은 아직 끝나지 않았어요(확인일 ${coverage.portalScan.checkedAt.slice(0, 10)}). 아직 찾지 못한 서식이 더 있을 수 있어요.`}
          {" "}서식을 찾아 확인한 사업만 연결하며, 수록 사업 모두에 내려받을 신청서가 있는 것은 아니에요.
        </p>}
        {!!coverage.portalScan?.sources.length && <p className="small muted">법령포털 수집 {coverage.portalScan.sources.map(source =>
          `${SCAN_SOURCE_LABEL[source.kind] ?? source.kind} ${number(source.collected)}/${number(source.total)}`).join(" · ")}</p>}
        {coverage.investigationSummary && <div className={styles.census} data-testid="forms-investigation-summary">
          <h3>사업별 조사 상태</h3>
          <dl className={styles.stages}>{INVESTIGATION_STATES.map(state => <div key={state}>
            <dt>{INVESTIGATION_LABEL[state]}</dt><dd>{number(coverage.investigationSummary!.counts[state])}<span>건</span></dd>
          </div>)}</dl>
          <ul className={styles.progress}>{investigationProgressLines(coverage.investigationSummary).map(line => <li key={line}>{line}</li>)}</ul>
          <p className="small muted">목록 대조는 서식 이름을 맞춰 본 것이고, 본문 확인은 자료를 실제로 열어 읽은 것이에요. 전국 법령 본문을 모두 읽었다는 뜻이 아니에요.</p>
        </div>}
        <p className="small muted">등록한 서식 정보 {number(coverage.totalForms)}개 · 원문 연결 확인 {number(coverage.publishedForms)}개 · 현황 생성일 {coverage.generatedAt.slice(0, 10)}</p>
        {hwpxDownloads !== undefined && <p data-testid="forms-hwpx-download-summary">HWP 원본 <strong>{number(hwpxDownloads)}개</strong>는 HWPX 파일로도 받을 수 있어요. 혜택 상세에서 <strong>HWPX로 받기</strong>를 누른 뒤 한글 프로그램에서 작성할 수 있어요.</p>}
        {writingCounts && <p data-testid="forms-writing-summary">HWP 원본 중 <strong>{number(writingCounts.writable)}개 서식</strong>은 이 화면에서도 빈칸을 채우고 HWPX로 받을 수 있어요. 혜택 상세에서 <strong>화면에서 작성하기</strong>를 눌러 주세요. 일부 칸과 서명·동의 표시는 인쇄한 뒤 직접 적어야 해요.</p>}
      </section>
      <section className={styles.browse} aria-labelledby="forms-area-title">
        <h2 id="forms-area-title">서식 찾기</h2>
        <div className={styles.filters}>
          <div><label htmlFor="forms-region">찾을 지역</label><select id="forms-region" value={areaKey} onChange={event => { setAreaKey(event.target.value); setStage("all"); setLimit(20); }}>
            {(["national", "sido", "sigungu"] as const).map(scope => <optgroup key={scope} label={scope === "national" ? "전국 공통" : scope === "sido" ? "시·도 사업" : "시·군·구 사업"}>
              {coverage.regions.filter(item => item.scope === scope).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
            </optgroup>)}
          </select></div>
          <div><label htmlFor="forms-status">연결 상태</label><select id="forms-status" value={status} onChange={event => { setStatus(event.target.value as FormStatus | "all"); setLimit(20); }}><option value="all">전체 상태</option>{statuses.map(key => <option key={key} value={key}>{FORM_STATUS_LABEL[key]}</option>)}</select></div>
          {!!stageCounts.investigated && <div data-testid="forms-stage-filter"><label htmlFor="forms-stage">확인 단계</label>
            <select id="forms-stage" value={stage} onChange={event => { setStage(event.target.value as InvestigationState | "all"); setLimit(20); }}>
              <option value="all">전체 단계</option>
              {INVESTIGATION_STATES.map(key => <option key={key} value={key}>{INVESTIGATION_LABEL[key]} {number(stageCounts.tally[key])}건</option>)}
            </select></div>}
          <div className={styles.search}><label htmlFor="forms-query">혜택 이름 검색</label><input id="forms-query" type="search" value={query} maxLength={100} placeholder="예: 장수축하금, 돌봄" onChange={event => { setQuery(event.target.value); setLimit(20); }} /></div>
        </div>
        {loading ? <p role="status">선택한 지역을 확인하고 있어요.</p> : !bundle ? <div role="status"><p>이 지역의 연결 현황을 불러오지 못했어요.</p><button className="btn btn-quiet" onClick={retry}>다시 확인하기</button></div> : <>
          <p role="status" className={styles.resultCount}>{bundle.region.label} 수록 {number(bundle.programs.length)}건 중 현재 조건 {number(filtered.length)}건</p>
          {!filtered.length ? <p className={styles.empty}>현재 검색 조건에 맞는 자료가 없어요. 검색어나 연결 상태를 바꿔 보세요.</p> : <ul className={styles.results} data-testid="forms-results">
            {filtered.slice(0, limit).map(program => <li key={program.id}>
              <div><p className={styles.state} data-status={program.status}>{FORM_STATUS_LABEL[program.status]}{program.links.length ? ` · 서식 ${program.links.length}개` : ""}</p><h3><Link href={`/p/${encodeURIComponent(program.id)}`}>{program.name}</Link></h3>
              {program.investigation ? <p className="small muted" data-testid="forms-row-stage">확인 단계 · {INVESTIGATION_LABEL[program.investigation.state]} — {INVESTIGATION_NOTE[program.investigation.state]}</p>
                : program.status === "review" ? <p className="small muted">자동으로 찾은 후보 서식의 적용 여부를 확인 중입니다.</p>
                  : program.portalSearch?.outcome === "not_found" ? <p className="small muted">법령포털 서식 목록 대조에서 연결 후보를 찾지 못했습니다. 신청서가 없거나 지원 대상이 아니라는 뜻은 아닙니다.</p>
                    : program.portalSearch?.outcome === "incomplete" ? <p className="small muted">법령포털 서식 전수 확인이 아직 끝나지 않았습니다.</p> : null}</div>
              <Link className={styles.detailLink} href={`/p/${encodeURIComponent(program.id)}`}>상세 보기 <span className="sr-only">{program.name}</span> →</Link>
            </li>)}
          </ul>}
          {filtered.length > limit && <button className="btn btn-quiet" onClick={() => setLimit(value => value + 20)}>20건 더 보기</button>}
        </>}
      </section>
    </>}
    <details className={styles.explain}>
      <summary>연결 상태는 어떻게 정하나요?</summary>
      <dl>
        <dt>신청 서류 연결 확인</dt><dd>사업·지역·서식 용도를 공식 원문과 대조해 연결한 자료입니다. 주신청서와 추가·조건부 서류를 구분하며, 필요한 서류를 전부 확보했다는 뜻은 아닙니다. 접수기관의 최신 안내와 구비서류도 확인해 주세요.</dd>
        <dt>온라인 신청 안내</dt><dd>사업 자료에 온라인 신청 주소가 수록되어 있습니다. 현재 접수 여부와 조건은 해당 창구에서 확인해 주세요.</dd>
        <dt>연결 검토 중</dt><dd>법령포털에서 관련 서식 후보를 찾았거나 공식 안내에서 첨부자료를 확보한 상태입니다. 해당 자료가 이 사업에 사용할 신청서인지는 확인 중이며, 검토 중인 자료를 연결이 확인된 신청서로 표시하지 않습니다.</dd>
        <dt>신청서 찾는 중</dt><dd>아직 맞는 신청서를 연결하지 못했고, 온라인 신청 주소도 수록되어 있지 않습니다. 지원 대상이 아니거나 신청서가 필요 없다는 뜻은 아니며, 담당기관이 해마다 내는 공고에 서식이 따로 있을 수 있습니다. 추가 출처 확인이 필요합니다.</dd>
      </dl>
      <p>지급대장·기관 운영 서류·삭제된 서식은 시민용 신청서에서 제외합니다. 같은 이름의 서식도 적용 지역이 다르면 자동으로 연결하지 않습니다.</p>
    </details>
    <details className={styles.explain}>
      <summary>확인 단계는 무엇을 뜻하나요?</summary>
      <dl>{INVESTIGATION_STATES.map(state => <div key={state}><dt>{INVESTIGATION_LABEL[state]}</dt><dd>{INVESTIGATION_NOTE[state]}</dd></div>)}</dl>
      <p>공식 안내 페이지에서 찾은 첨부자료는 담당기관이 올려 둔 자료 그대로 보여 드리는 것이고, 연결을 확인한 신청서와는 다릅니다. 그 자료가 신청에 필요한 서류 전부라는 뜻도 아닙니다.</p>
      <p>열지 못한 법령 본문과 안내 페이지는 건수로 남겨 둡니다. 확인하지 못한 것을 ‘신청서가 없다’로 적지 않습니다.</p>
    </details>
  </div>;
}
