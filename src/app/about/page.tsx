import Link from "next/link";
import type { Metadata } from "next";
import { DataSources } from "@/components/DataSources";
import meta from "../../../public/bundles/v1/meta.json";
import { TIER_PLAIN } from "@/lib/client/howto";
import { LOW_INCOME_PCT } from "@/lib/client/v2";
import { BASIC_PENSION_THRESHOLD_2026, MEDIAN_INCOME_BY_YEAR } from "@/lib/engine/profile";

export const metadata: Metadata = { title: "데이터·판정 기준" };

const n = (v: number) => v.toLocaleString("ko-KR");
const man = (won: number) => `${Math.floor(won / 10000).toLocaleString("ko-KR")}만원`;

export default function About() {
  const c = meta.counts;
  // (전국 확대 ①) 번들을 다시 만들기 전이라 meta 집계는 시범 기준 — 정부24 지원조건 규칙은 이제 모두 'API 지원조건' (refine.ts)
  const byOrigin = (c as unknown as { rulesByOrigin?: Record<string, number> }).rulesByOrigin ?? {};
  const structuredN = Math.max((c.rulesByReview as Record<string, number>).structured ?? 0, byOrigin.gov24_conditions ?? 0);
  const autoN = c.rulesByReview.auto - (structuredN - ((c.rulesByReview as Record<string, number>).structured ?? 0));
  return (
    <div className="narrow page">
      <ol className="crumbs" aria-label="현재 위치">
        <li>
          <Link href="/">홈</Link>
        </li>
        <li>
          <span aria-current="page">데이터·판정 기준</span>
        </li>
      </ol>
      <h1 className="h1">데이터 출처와 판정 기준</h1>
      <p className="lead">
        데이터 생성: {new Date(meta.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST)
      </p>

      <DataSources />

      <section>
        <h2 className="h2">중복 통합 후 사업자료 {n(c.uniquePrograms)}건</h2>
        <p className="small muted" style={{ marginTop: "0.5rem" }}>
          지역마다 따로 올린 상세 자료는 {n(c.placements)}건입니다. 출처별 건수는 <a href="#sources">어디서 모았나</a>에서 그 상세 자료를 다시 세어 적습니다.
        </p>
        <table className="median-table" style={{ marginTop: "0.75rem" }}>
          <caption className="sr-only">기관 유형별 서비스 수</caption>
          <thead>
            <tr>
              <th scope="col">기관 유형</th>
              <th scope="col">서비스 수</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>중앙부처·청 (전국 공통)</td><td>{n(c.byOrg.central)}</td></tr>
            <tr><td>시·도</td><td>{n(c.byOrg.metro)}</td></tr>
            <tr><td>시군구</td><td>{n(c.byOrg.local)}</td></tr>
            <tr><td>공공기관 (공단·재단·지방 공기업 등)</td><td>{n(c.byOrg.public_inst)}</td></tr>
            <tr><td>교육청 (기본 결과에서는 숨김, 필터로 보기)</td><td>{n((c.byOrg as Record<string, number>).edu_office ?? 0)}</td></tr>
            <tr><td>└ 복지 외 분야: 농림축산어업 종사자 대상 (기본 숨김)</td><td>{n((c as { bySector?: Record<string, number> }).bySector?.agri ?? 0)}</td></tr>
            <tr><td>└ 복지 외 분야: 사업자·창업·소상공인 대상 (기본 숨김)</td><td>{n((c as { bySector?: Record<string, number> }).bySector?.business ?? 0)}</td></tr>
            <tr><td>└ 기관·시설 운영 지원: 경로당·어린이집·법인·운영기관 대상 (기본 숨김)</td><td>{n((c as { bySector?: Record<string, number> }).bySector?.operator ?? 0)}</td></tr>
          </tbody>
        </table>
        <h3 className="h3" style={{ marginTop: "2rem" }}>신청 유형</h3>
        <p className="body" style={{ marginTop: "0.5rem" }}>
          이 서비스는 <strong>내가 직접 신청해야 받는데 놓치기 쉬운 혜택</strong>을 찾는 데 집중합니다. 신청방법·접수방법 원문에
          &lsquo;별도 신청 없이&rsquo;·&lsquo;자동 지급&rsquo;·&lsquo;직권 신청&rsquo;·&lsquo;학교장 추천&rsquo;·&lsquo;시설 입소자&rsquo; 같은 표현이 있으면
          자동 제공·기관 선정으로 분류해 추천과 목록에서 빼고, 결과 맨 아래 <strong>&lsquo;자동으로 받는 혜택&rsquo;</strong>에 접어 둡니다. 애매하면
          &lsquo;직접 신청&rsquo;이나 &lsquo;신청 방법 확인&rsquo;으로 두어 목록에 그대로 보입니다.
        </p>
        <table className="median-table" style={{ marginTop: "0.75rem" }}>
          <caption className="sr-only">신청 유형별 서비스 수</caption>
          <thead>
            <tr>
              <th scope="col">신청 유형</th>
              <th scope="col">서비스 수</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>직접 신청 (본인·가족이 주민센터·복지로·기관에 신청)</td><td>{n(c.byApplyType.self)}</td></tr>
            <tr><td>신청 방법 확인 (원문에 신청방법이 없거나 애매 — 목록에 그대로 표시)</td><td>{n(c.byApplyType.unknown)}</td></tr>
            <tr><td>자동 제공 (자동 지급·연계, 직권 신청, 학교·어린이집이 처리)</td><td>{n(c.byApplyType.auto)}</td></tr>
            <tr><td>기관 추천·선정 (기관·학교장 추천, 시설·기관 대상)</td><td>{n(c.byApplyType.institution)}</td></tr>
          </tbody>
        </table>
        <h3 className="h3" style={{ marginTop: "2rem" }}>출처</h3>
        <p className="body">
          정부24·복지로·통합돌봄 메뉴판·핵심 복지 100선·수동 보강의 건수, 수집일, 공식 페이지는 위 <a href="#sources">어디서 모았나</a>에 있습니다.
          여기의 {n(c.uniquePrograms)}건과 출처를 더한 수를 전체 복지 수로 읽지 않습니다.
        </p>
        <ul className="bullets">
          <li>
            시·군·구 경계(&lsquo;현재 위치로 내 지역 예시 보기&rsquo;에만 사용) — 통계청 SGIS 행정동 경계를 정리한{" "}
            <a href="https://github.com/vuski/admdongkor" target="_blank" rel="noopener noreferrer">
              vuski/admdongkor
            </a>{" "}
            2026-07-01판 (CC BY 4.0, 공공누리 제1유형). 시·군·구로 합치고 단순화해 씀
          </li>
        </ul>
        <p className="small muted" style={{ marginTop: "0.5rem" }}>
          신청 방법이 있는 서비스 {n(c.coverage.applyMethod)}개({Math.round((100 * c.coverage.applyMethod) / c.coverage.total)}%), 연락처가 있는 서비스 {n(c.coverage.contact)}개({Math.round((100 * c.coverage.contact) / c.coverage.total)}%).
          정보가 없으면 주소지 행정복지센터·시군구청과 ☎129·110으로 안내합니다.
        </p>
        <p className="small muted" style={{ marginTop: "0.5rem" }}>
          같은 사업이 여러 출처에 있으면 이름·기관 단계·지역을 대조해 하나로 합칩니다(교차 병합 {n(c.dedup.crossMerged.reduce((a, x) => a + x.count, 0))}건, 전국 사업의 지역 운영분 {n(c.dedup.absorbedAsLocalOps)}건).
          이 병합 건수는 묶음을 만들 때 남긴 로그이고, ‘어디서 모았나’의 출처 연결과 같은 계산이 아닙니다.
          읍면동 단독 사업은 목록에서 제외하고, 읍면동은 신청처로만 안내합니다.
        </p>
      </section>

      <section>
        <h2 className="h2" id="v2">판단 기준 (상황 먼저 묻는 방식)</h2>
        <p className="body">
          사는 곳과 상황을 먼저 묻고, 답하신 상황과 맞지 않는 혜택은 본문에서 뺍니다. &lsquo;모름&rsquo;으로 남은 조건은 결과 맨 위에서 꼭 필요한 질문(최대 3개)으로만 다시
          묻습니다. 모든 계산은 이 기기 안에서 합니다.
        </p>
        <dl className="summary" style={{ marginTop: "0.75rem" }}>
          <dt>받으실 수 있어요</dt>
          <dd>검수했거나 공식 구조화된 조건이 답하신 상황과 모두 맞을 때. 장기요양등급처럼 신청하면서 정해지는 조건은 &lsquo;신청 절차&rsquo;로 안내합니다.</dd>
          <dt>신청할 때 확인</dt>
          <dd>답과 어긋나는 조건은 없지만 원문의 세부 조건(재산, 특정 장애 유형, 대상 기관 등)을 신청처에서 확인해야 할 때. 원문에서 자동으로 정리한 조건은 다 맞아도 여기까지만 둡니다.</dd>
          <dt>답하면 정해져요</dt>
          <dd>&lsquo;모름&rsquo;으로 둔 질문 하나에 답하면 &lsquo;받으실 수 있어요&rsquo; 또는 &lsquo;맞지 않아요&rsquo;로 바로 갈리는 혜택.</dd>
          <dt>맞지 않아 뺐어요</dt>
          <dd>나이·가구·소득·수급 등 답하신 내용과 조건이 다를 때. 이유와 함께 접어 둡니다.</dd>
        </dl>
        <h3 className="h3" style={{ marginTop: "1.5rem" }} id="income">
          소득 기준
        </h3>
        <ul className="bullets">
          <li>
            한 달 소득을 적으면 함께 사는 가족 수 기준으로 <strong>그해 기준 중위소득</strong>(보건복지부 고시 — 2026년 값, 2027년 1월 1일부터는 2027년 값) 대비 몇 %인지 계산해, 원문의 소득 기준(예: 중위소득 80%
            이하)과 그대로 비교합니다.
          </li>
          <li>
            원문에 숫자 없이 <strong>&lsquo;저소득&rsquo;</strong>이라고만 적힌 혜택은 <strong>{`기준 중위소득 ${LOW_INCOME_PCT}%`} 이하</strong>로 보고 판단합니다(청년·노인
            사업에서 흔히 쓰는 기준). 실제 기준은 사업마다 다를 수 있어 카드에 &lsquo;기준이 숫자로 없어 {LOW_INCOME_PCT}%로 봤어요&rsquo;라고 함께 적습니다.
          </li>
          <li>소득이 {`기준 중위소득 ${LOW_INCOME_PCT}%`}를 넘으면 기초생활수급(생계·의료·주거·교육급여, 50% 이하)·차상위(50% 이하)는 아닌 것으로 봅니다(직접 답하면 답을 따릅니다).</li>
          <li>
            기초연금 선정기준액(2026): 혼자 사는 어르신 월 {man(BASIC_PENSION_THRESHOLD_2026.single)}, 부부 월 395만 2천원(소득인정액). 기초연금을 받고 있다고 답하면 &lsquo;소득 하위 70%&rsquo; 조건은
            맞는 것으로 봅니다.
          </li>
          <li>건강보험료로 소득을 미루어 짐작하지 않습니다. 실제 선정은 재산을 포함한 소득인정액으로 신청처에서 정합니다.</li>
        </ul>
        {/* 빌드 때 미리 만드는 화면이라 '올해'를 고르지 않고 두 해를 적용 날짜와 함께 보여 준다 (Y1) */}
        {([
          [2026, "2026년 (2026년 12월 31일까지)"],
          [2027, "2027년 (2027년 1월 1일부터)"],
        ] as const).map(([year, title]) => (
          <table className="median-table" style={{ marginTop: "0.75rem" }} key={year}>
            <caption>{title} 가구원 수별 기준 중위소득 (월)</caption>
            <thead>
              <tr>
                <th scope="col">가구원 수</th>
                <th scope="col">기준 중위소득 100%</th>
                <th scope="col">{LOW_INCOME_PCT}% (숫자 없는 &lsquo;저소득&rsquo;)</th>
                <th scope="col">50% (차상위)</th>
              </tr>
            </thead>
            <tbody>
              {([1, 2, 3, 4, 5, 6] as const).map((k) => (
                <tr key={k}>
                  <td>{k}인</td>
                  <td>{man(MEDIAN_INCOME_BY_YEAR[year][k])}</td>
                  <td>{man((MEDIAN_INCOME_BY_YEAR[year][k] * LOW_INCOME_PCT) / 100)}</td>
                  <td>{man(MEDIAN_INCOME_BY_YEAR[year][k] / 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </section>

      <section>
        <h2 className="h2">예전 결과 화면의 판정 단계 (비교용)</h2>
        <dl className="summary">
          <dt>조건 충족</dt>
          <dd>{TIER_PLAIN.eligible} 검수된 규칙의 조건을 입력값이 모두 충족할 때만 표시합니다.</dd>
          <dt>가능성 있음</dt>
          <dd>{TIER_PLAIN.likely} 입력하지 않았거나 묻지 않는 조건(재산, 질병 등)이 남은 경우이며, 자동 변환 규칙은 여기까지만 판정합니다.</dd>
          <dt>확인 필요</dt>
          <dd>{TIER_PLAIN.check} &lsquo;필요하다고 인정되는 사람&rsquo;처럼 상담으로 판단하거나 구조화된 조건이 없는 경우입니다.</dd>
        </dl>
        <ul className="bullets" style={{ marginTop: "1rem" }}>
          <li>검수 규칙(1차): {n(c.rulesByReview.curated)}개 — 원문 근거 구절과 대조해 작성한 규칙(AI 보조)이며 최종 사람 검수 진행 중.</li>
          <li>정부24 지원조건 기준: {n(structuredN)}개 — 공공서비스(혜택) API의 구조화된 지원조건 코드(나이·소득 구간·대상 특성·가구 유형)에서 변환. 모든 지역에서 &lsquo;조건 충족&rsquo;을 허용하되(2026-10-10부터 전국), 원문에 수급·장애 등 추가 요건이나 사건·이미 한 일·묻지 않은 자격이 보이면 &lsquo;신청할 때 확인&rsquo;으로 낮춥니다. 전국 표본 142건을 원문과 대조(다른 AI 모델 검토 포함)해 이 점검 규칙을 다듬었습니다.</li>
          <li>자동 변환 규칙: {n(autoN)}개 — 복지로 분류 태그·대상 문구에서 변환. 최대 &lsquo;가능성 있음&rsquo;. 경기도 {n(c.pilot.autoRules)}개는 검수 대기열에 있습니다.</li>
          <li>조건이 맞지 않는 서비스는 기본으로 숨기고, 원하면 이유와 함께 볼 수 있습니다.</li>
        </ul>
      </section>

      <section>
        <h2 className="h2" id="privacy">개인정보 원칙</h2>
        <ul className="bullets">
          <li>로그인·회원가입 없이 이용합니다. 맞춤 조회에서는 주민등록번호를 묻지 않습니다. 신청서 화면에서는 원본이 요구하는 항목을 입력할 수 있으며, 작성 내용은 이 기기에서만 처리하고 외부로 보내지 않습니다.</li>
          <li>직접 입력한 복지 답변은 앱 서버로 보내지 않습니다. 지역별 서비스 묶음을 내려받아 이 기기 안에서 판정합니다.</li>
          <li>음성 입력을 시작하면 음성을 OpenAI로 전송합니다. 기본 화면에서는 실시간으로 받아쓰며, 완료하면 해당 내용으로 검색합니다. 녹음 방식은 완료 후 받아쓰고, 상세 입력에서는 내용을 확인·수정한 뒤 반영합니다. 이 앱은 음성과 전사문을 별도 파일이나 로그로 보관하지 않습니다. 외부 처리는 <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noopener noreferrer">OpenAI 데이터 정책</a>을 따릅니다. 음성 대신 직접 입력할 수도 있습니다.</li>
          <li>맞춤 조회 입력값은 이 브라우저에만 저장되며 &lsquo;이 기기에서 지우기&rsquo;로 언제든 삭제할 수 있습니다. 공용 기기 모드에서는 브라우저를 닫으면 사라집니다. 신청서 작성 내용은 자동 저장하지 않으며 작성 화면을 떠나거나 새로고침하면 사라집니다. 내려받은 신청서 파일은 이용자가 직접 보관·관리합니다.</li>
          <li>장애·돌봄 같은 민감 정보는 선택 입력입니다.</li>
          <li>홈·질문 화면에서 현재 위치를 미리 조회해 지역을 제안합니다. 위치 권한은 브라우저에서 허용하거나 거부할 수 있습니다. 좌표는 이 기기에서 시·군·구로 바꾸며 서버로 보내거나 저장하지 않습니다. 거주지는 확인 후 답변에 반영합니다.</li>
        </ul>
      </section>

      <section>
        <h2 className="h2" id="credits">글꼴·로고 저작권 표기</h2>
        <ul className="bullets">
          <li>
            로고·앱 아이콘·공유 이미지의 글자는 Pretendard 글꼴의 글자 모양을 윤곽선으로 바꿔 쓴 것이고, 본문 글꼴도 Pretendard(v1.3.9)를 이 사이트 안에 두어 씁니다. Pretendard는 SIL Open Font License 1.1로 배포됩니다. Copyright (c) 2021, Kil Hyung-jin, with Reserved Font Name Pretendard.
          </li>
          <li>로고의 하트·나침반 바늘 그림은 이 서비스를 위해 직접 그린 도형입니다.</li>
        </ul>
      </section>
    </div>
  );
}
