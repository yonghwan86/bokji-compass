/**
 * 주민센터 공통 신청서 작성 도우미 (2026-10-16 회의: 신청서 자동 채우기).
 * 주민센터 복지 신청 대부분은 공통 서식 하나 — 「사회보장급여 관련 공통서식에 관한 고시」(보건복지부 고시 제2026-90호,
 * 2026. 5. 1. 시행) 제2조·별지 제1호서식 「사회보장급여 신청(변경)서」. 서식 2쪽 '보장구분/사회보장급여 내용'에서
 * 체크할 칸을 사업 이름으로 찾아 준비물 한 장에 적는다. 칸 이름·보장구분·구비서식은 서식 원문 그대로만 쓴다.
 * 주민등록번호·계좌 같은 개인정보는 받지도 적지도 않는다 (창구에서 직접).
 * 보육료(유아학비)는 이 서식이 아니라 별지 제1호의4서식(사회서비스이용권)이라 넣지 않는다 (고시 제5조).
 */

export const COMMON_FORM = {
  title: "사회보장급여 신청(변경)서",
  basis: "사회보장급여 관련 공통서식에 관한 고시 별지 제1호서식 (2026. 5. 1. 개정)",
} as const;

type Section = "기초생활보장" | "영유아" | "아동수당" | "아동·청소년" | "노인" | "장애인" | "한부모 가족" | "기타";

/** 서식 2쪽 칸 (보장구분 순서 그대로) — match: 우리 데이터의 사업 이름 */
const ITEMS: { section: Section; label: string; match: RegExp }[] = [
  { section: "기초생활보장", label: "생계급여", match: /^(국민기초생활보장\s*)?생계급여(\s*\(맞춤형 급여\))?$/ },
  { section: "기초생활보장", label: "의료급여", match: /^의료급여(\s*\(의료급여\))?$/ },
  { section: "기초생활보장", label: "주거급여", match: /^주거급여(\s*\(맞춤형 급여\))?$/ },
  { section: "기초생활보장", label: "교육급여", match: /^교육급여(\s*\(맞춤형 급여\))?$/ },
  { section: "영유아", label: "부모급여(현금)", match: /^부모급여(\s*지원)?$/ },
  { section: "영유아", label: "양육수당 — 가정양육수당", match: /^가정\s*양육수당(\s*지원)?$/ },
  { section: "영유아", label: "양육수당 — 농어촌양육수당", match: /^농어촌\s*양육수당/ },
  { section: "영유아", label: "아이돌봄서비스(종일제·시간제)", match: /^아이돌봄\s*서비스$/ },
  { section: "아동수당", label: "아동수당", match: /^아동수당(\s*지급)?$/ },
  { section: "아동·청소년", label: "초·중·고 학생 교육비 지원", match: /^초[·ㆍ]?\s*중[·ㆍ]?\s*고\s*교육비\s*지원/ },
  { section: "아동·청소년", label: "소년·소녀가정 보호비", match: /^소년\s*소녀\s*가정\s*지원$/ },
  { section: "아동·청소년", label: "청소년특별지원", match: /^청소년\s*특별\s*지원$/ },
  { section: "노인", label: "기초연금", match: /^기초\s*연금$/ },
  { section: "장애인", label: "장애인연금", match: /^장애인\s*연금$/ },
  { section: "장애인", label: "장애수당", match: /^장애수당$/ },
  { section: "장애인", label: "장애아가족양육지원", match: /^장애아\s*가족\s*양육\s*지원$/ },
  { section: "장애인", label: "장애아동수당", match: /^장애아동수당$/ },
  { section: "장애인", label: "장애인자립자금 대여", match: /^장애인\s*자립\s*자금\s*대여$/ },
  { section: "한부모 가족", label: "한부모 가족지원", match: /^한부모\s*가족\s*아동\s*양육비\s*지원$/ },
  { section: "한부모 가족", label: "청소년 한부모 자립지원", match: /^청소년\s*한부모\s*아동\s*양육\s*및\s*자립\s*지원$/ },
  { section: "기타", label: "차상위계층 확인", match: /^차상위\s*계층\s*확인$/ },
  { section: "기타", label: "차상위 본인부담경감", match: /^차상위\s*본인부담\s*경감/ },
  { section: "기타", label: "자산형성", match: /^(희망저축계좌\s*\(Ⅰ·Ⅱ\)|자산형성지원사업\s*\((희망저축Ⅱ|희망저축계좌Ⅰ, Ⅱ|청년내일저축계좌)\)|청년내일저축계좌)$/ },
  { section: "기타", label: "개발제한구역 거주민 생활비용보조", match: /^개발제한구역\s*(거주민\s*)?생활비용\s*보조/ },
  { section: "기타", label: "다문화가족 방문교육서비스", match: /^다문화가족\s*방문교육서비스$/ },
];

export interface FormCheck {
  section: Section;
  label: string;
  /** 이 칸에 체크하는 이유가 된 사업 이름 */
  for: string[];
}

export function formChecks(programs: readonly { name: string }[]): FormCheck[] {
  const out: FormCheck[] = [];
  for (const it of ITEMS) {
    const names = programs.map((p) => p.name.trim()).filter((n) => it.match.test(n));
    if (names.length) out.push({ section: it.section, label: it.label, for: [...new Set(names)] });
  }
  return out;
}

/**
 * 함께 낼 서식 — 서식 4쪽 '신청시 구비서식' 표 그대로:
 * 기초생활보장·기초연금·초중고 학생 교육비·장애인·장애인연금·한부모가족·기타(타법의료급여·개발제한구역 생활비용보조·차상위계층 확인)
 *  → 소득·재산신고서 + 금융정보 등 제공 동의서
 * 노인·아동·청소년·기타(차상위본인부담경감·자산형성) → 소득·재산신고서
 */
const INCOME = "소득·재산 신고서(별지 제1호의2서식)";
const FINANCE = "금융정보 등 제공 동의서(별지 제1호의3서식)";
const BOTH = new Set(["생계급여", "의료급여", "주거급여", "교육급여", "기초연금", "초·중·고 학생 교육비 지원", "장애인연금", "장애수당", "장애아가족양육지원", "장애아동수당", "장애인자립자금 대여", "한부모 가족지원", "청소년 한부모 자립지원", "개발제한구역 거주민 생활비용보조", "차상위계층 확인"]);
const INCOME_ONLY = new Set(["소년·소녀가정 보호비", "청소년특별지원", "차상위 본인부담경감", "자산형성"]);

export function formAttachments(checks: readonly FormCheck[]): string[] {
  const both = checks.some((c) => BOTH.has(c.label));
  const income = both || checks.some((c) => INCOME_ONLY.has(c.label));
  return [...(income ? [INCOME] : []), ...(both ? [FINANCE] : [])];
}
