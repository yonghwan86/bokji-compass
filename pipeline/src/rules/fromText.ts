import type { Cond } from "../../../src/lib/engine/types";
import {
  age, all, any, benefit, care, children, disability, kid, lowIncomeSoft, resident, trait, unasked,
  RECIPIENT, RECIPIENT_NEAR,
} from "./helpers";

/**
 * 대상 문구 → 조건 초안 (자동 변환, 판정 상한 '가능성 있음').
 * 보수적으로: 대상 집단이 여러 개면 OR, 숫자 연령은 명시된 경우만, 모호한 판단 문구는 비정형 핵심 조건으로 둔다.
 */
export interface TextRule {
  logic: Cond | null;
  unstructured: string[];
  core: boolean;
  matched: string[];
}

const OPEN = /(누구나|전국민|전 국민|모든 (?:주민|시민|구민|군민|도민)|전시민|전구민|전군민|(?:시|구|군|도)민 전체|지역주민|주민 전체)/;
const VAGUE_CORE = /(필요하다고 (?:판단|인정)|판단되는|인정되는|우려|위기|사각지대|어려움이 있는|곤란|취약|고립|위험군|고위험|의뢰된|추천받은|선정된)/;

export function extractFromText(rawText: string | undefined): TextRule {
  const text = (rawText ?? "").replace(/\s+/g, " ").trim();
  const matched: string[] = [];
  const unstructured: string[] = [];
  if (!text) return { logic: null, unstructured, core: false, matched };

  const groups: Cond[] = [];
  const extra: Cond[] = [];

  // 숫자 연령: 'N세 이상', 'N세 이하/미만', 'N~M세'
  let numericAge = false;
  const range = text.match(/만?\s?(\d{1,2})\s?(?:세)?\s?[~∼\-]\s?(\d{1,3})\s?세/);
  const over = text.match(/만?\s?(\d{1,3})\s?세\s?이상/);
  const under = text.match(/만?\s?(\d{1,3})\s?세\s?(이하|미만)/);
  const childCtx = /(아동|자녀|영유아|아이|청소년|학생|영아|유아)/.test(text);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    if (a <= b && b <= 120) {
      numericAge = true;
      matched.push(range[0]);
      groups.push(childCtx && b <= 18 ? any(undefined, kid(a, b, `만 ${a}~${b}세 (본인 또는 자녀)`), age(a, b, `만 ${a}~${b}세`)) : age(a, b, `만 ${a}~${b}세`));
    }
  } else if (over && Number(over[1]) >= 19 && Number(over[1]) <= 100) {
    numericAge = true;
    matched.push(over[0]);
    groups.push(age(Number(over[1]), undefined, `만 ${over[1]}세 이상`));
  } else if (under && childCtx) {
    const n = Number(under[1]) - (under[2] === "미만" ? 1 : 0);
    numericAge = true;
    matched.push(under[0]);
    // 성인 나이 상한(19세 이상)은 본인 나이만 — '고등학교 재학생 제외'처럼 학생 낱말이 있어도 자녀 갈래를 붙이지 않는다
    // (국민내일배움카드 '75세 미만 모든 국민' → '만 74세 이하 아동 (자녀)', 2026-10-26 재생성)
    groups.push(n <= 18 ? any(undefined, kid(0, n, `만 ${n}세 이하 아동 (자녀)`), age(0, n, `만 ${n}세 이하`)) : age(0, n, `만 ${n}세 이하`));
  }

  if (!numericAge) {
    if (/독거\s?노인|홀몸\s?(노인|어르신)|홀로 사는 (노인|어르신)|1인\s?가구 (노인|어르신)|노인 1인/.test(text)) {
      matched.push("독거노인");
      groups.push(all(age(65, undefined, "만 65세 이상 어르신"), trait(["single"], "혼자 사는 1인 가구")));
    } else if (/(노인|어르신|고령|경로|노년)/.test(text)) {
      matched.push("노인");
      groups.push(age(65, undefined, "노인(만 65세 이상)"));
    }
    if (/(영유아|영아|유아|신생아)/.test(text)) {
      matched.push("영유아");
      groups.push(kid(0, 5, "영유아 자녀"));
    } else if (/(아동|어린이|초등학생)/.test(text)) {
      matched.push("아동");
      groups.push(any(undefined, kid(0, 12, "아동 (자녀)"), age(0, 18, "아동·청소년 본인")));
    }
    if (/청소년|중학생|고등학생/.test(text)) {
      matched.push("청소년");
      groups.push(any(undefined, kid(13, 18, "청소년 자녀"), age(0, 24, "청소년 본인", { capU: true })));
    }
    if (/청년/.test(text)) {
      matched.push("청년");
      groups.push(age(19, 39, "청년(만 19~39세, 지역마다 다름)", { capU: true }));
    }
  }
  if (/(임산부|임신부|산모|임신|출산)/.test(text)) {
    matched.push("임신·출산");
    groups.push(children(["pregnant", "0-1"], "임신 중이거나 최근 출산"));
  }
  if (/장애/.test(text)) {
    matched.push("장애인");
    const severe = /중증\s?장애|심한 장애/.test(text);
    groups.push(disability(["self", "member"], severe ? "심한 장애가 있는 본인 또는 가구원" : "장애가 있는 본인 또는 가구원", severe ? "severe" : undefined));
  }
  if (/한부모|조손/.test(text)) {
    matched.push("한부모");
    groups.push(trait(["single_parent"], "한부모·조손 가구"));
  }
  if (/다문화|결혼이민|이주민|외국인 주민|북한이탈|탈북|북향민/.test(text)) {
    matched.push("다문화");
    groups.push(trait(["multicultural"], "다문화·북한이탈주민 가구"));
  }
  if (/보훈|유공자|참전/.test(text)) {
    matched.push("보훈");
    groups.push(trait(["veteran"], "보훈대상 가구"));
  }

  // 소득 조건: 집단 조건과 AND
  const recipient = /기초(생활)?\s?(보장\s?)?수급|생계급여|의료급여|(?<!요양\s?)수급자/.test(text);
  if (recipient && /차상위/.test(text)) {
    matched.push("수급·차상위");
    extra.push(benefit(RECIPIENT_NEAR, "기초생활수급자 또는 차상위계층"));
  } else if (recipient) {
    matched.push("수급");
    extra.push(benefit(RECIPIENT, "기초생활수급자"));
  } else if (/차상위/.test(text)) {
    matched.push("차상위");
    extra.push(benefit(RECIPIENT_NEAR, "차상위계층 이하"));
  } else if (/저소득|기초연금 수급/.test(text)) {
    matched.push("저소득");
    extra.push(lowIncomeSoft());
  }
  const median = text.match(/중위\s?소득\s?(\d{2,3})\s?%\s?이하/);
  if (median) {
    matched.push(median[0]);
    extra.push({ field: "income", lte: Number(median[1]), label: `기준 중위소득 ${median[1]}% 이하` });
  }

  // 돌봄 필요 (기기에만 저장되는 민감 입력과 연결, soft)
  let careMatched = false;
  if (/퇴원/.test(text)) {
    careMatched = true;
    matched.push("퇴원");
    extra.push(care(["discharged", "daily"], "퇴원 후 돌봄이 필요", { soft: true }));
  } else if (/(거동\s?(이\s?)?불편|돌봄\s?(이\s?)?필요|일상생활[^,.]{0,10}(어려|불편|곤란)|와상|혼자 생활하기 어려)/.test(text)) {
    careMatched = true;
    matched.push("돌봄 필요");
    extra.push(care(["daily"], "일상생활에 도움이 필요", { soft: true }));
  }

  // 익명 단계에서 묻지 않는 자격
  if (/장기\s?요양\s?(등급|수급|인정)|등급\s?(판정|인정)?자|등급 외/.test(text)) {
    matched.push("장기요양 등급");
    extra.push(unasked("장기요양 등급(또는 등급 외) 판정", "장기요양 등급은 국민건강보험공단 판정이 필요해요."));
  }
  if (/치매/.test(text)) {
    matched.push("치매");
    extra.push(unasked("치매 진단 또는 의심", "치매 여부는 치매안심센터 상담으로 확인해요."));
  }
  if (/(정신질환|우울|정신건강)/.test(text)) {
    matched.push("정신건강");
    extra.push(unasked("정신건강 관련 상태", "정신건강복지센터 상담으로 확인해요."));
  } else if (/(환자|질환자|만성질환|암 |희귀)/.test(text)) {
    matched.push("질환");
    extra.push(unasked("해당 질환·건강 상태", "건강 상태 관련 조건은 신청처에서 확인해요."));
  }

  const open = OPEN.test(text);
  let core = false;
  if (VAGUE_CORE.test(text) && !careMatched) {
    core = true;
    unstructured.push(text.length > 120 ? text.slice(0, 119) + "…" : text);
  }

  const parts: Cond[] = [];
  if (groups.length === 1) parts.push(groups[0]);
  else if (groups.length > 1) parts.push(any(groupLabel(matched), ...groups));
  else if (open) parts.push(resident());
  parts.push(...extra);

  if (parts.length === 0) {
    return { logic: null, unstructured: unstructured.length ? unstructured : [], core, matched };
  }
  return { logic: parts.length === 1 ? parts[0] : all(...parts), unstructured, core, matched };
}

function groupLabel(matched: string[]): string {
  const names = matched.filter((m) => ["노인", "독거노인", "영유아", "아동", "청소년", "청년", "임신·출산", "장애인", "한부모", "다문화", "보훈"].includes(m));
  return names.join("·") || "대상 집단";
}
