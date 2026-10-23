import type { PaperGlyphStyles, PaperLineMetrics } from "../client/paperTextMetrics";

/**
 * 원본 양식을 그대로 보며 빈칸만 직접 채우는 범용 작성기의 자료 모양.
 *
 * 등록부를 손으로 적는 기존 두 서식과 달리, 여기 담기는 것은 모두
 * `scripts/build-paper-writing.ts`가 **실제 변환 HWPX의 Contents/sectionN.xml**에서
 * 뽑아낸 값이다. 라벨·안내·선택지 문구는 원본 서식에 인쇄된 문장을 그대로 옮긴 것이고,
 * 없는 법적 요건이나 수급 자격 판단을 새로 만들지 않는다.
 *
 * 쓰이는 파일
 * - `/forms/writing/v1/index.json`            작성 가능 서식 요약 (샤드 목록)
 * - `/forms/writing/v1/index/<bucket>.json`   작성 버튼 게이트용 원본·변환본 신원
 * - `/forms/writing/v1/manifest/<formId>.json` 화면 구성과 빈칸 자리
 */

/** 변환 HWPX 안의 한 문단 자리. 표 밖 본문 문단이면 `table`이 null이다. */
export interface PaperAt {
  /** `Contents/sectionN.xml`의 N */
  section: number;
  /** 그 섹션에서 표가 나오는 차례 (0부터). 표 밖 본문이면 null */
  table: number | null;
  /** 표 칸 주소 (`hp:cellAddr`). 표 밖 본문이면 0 */
  row: number;
  col: number;
  /** 그 칸(또는 섹션 본문)에서 문단 차례 (0부터) */
  p: number;
}

export type PaperSlotKind =
  /** 원본이 비워 둔 칸 — 그 칸 전체가 비어 있다 */
  | "text"
  /** 인쇄된 문장 가운데 비워 둔 자리(밑줄·명확한 공백) — 자리 너비를 그대로 지킨다 */
  | "inline"
  /**
   * 인쇄된 글자 바로 앞에 끼워 쓰는 자리.
   * 원본이 공백을 비워 두지 않은 날짜 줄(`년     월     일`의 `년`)처럼,
   * 인쇄된 글자를 **지우지 않고** 그 앞에만 값을 넣어야 하는 경우에만 쓴다.
   */
  | "prefix"
  /** 원본에 인쇄된 표시칸(`[  ]`·`□`) */
  | "check";

/** 화면에서 채우지 않는 자리와 그 이유. 원문은 그대로 보여 주고 인쇄 뒤 직접 쓰게 한다. */
export type PaperLockKind = "signature" | "consent" | "agency";
export interface PaperLock {
  kind: PaperLockKind;
  /** 사람에게 그대로 보여 주는 이유 */
  reason: string;
}

export interface PaperSlot {
  /** 기술용 자리표 — 화면의 주라벨로 쓰지 않는다 */
  id: string;
  kind: PaperSlotKind;
  at: PaperAt;
  /** 그 문단에 지금 적혀 있는 원문 전체. 한 글자라도 다르면 작성을 멈춘다 */
  expect: string;
  /** `inline`은 원본이 비워 둔 자리 [from, to), `prefix`는 끼워 넣을 자리(from === to) */
  from?: number;
  to?: number;
  /** `prefix` — 바로 뒤에 인쇄돼 있어야 하는 글자. 다르면 작성을 멈춘다 */
  after?: string;
  /** 원본에 인쇄된 날짜 토막(`년`·`월`·`일`) — 라벨과 자릿수를 이 글자에서 가져왔다 */
  token?: "년" | "월" | "일";
  /** `inline` — 그 자리를 메우고 있는 글자 */
  pad?: " " | "_";
  /** `inline` — 숫자처럼 오른쪽에 붙여 쓰는 자리 */
  align?: "right";
  /** `check` — 그 문단에서 몇 번째 표시칸인지 */
  box?: number;
  /** `check` — `[  ]` 묶음인지 `□` 한 글자인지 */
  boxShape?: "bracket" | "square";
  /** 입력 화면 크기를 정하는 대략 반각 예산. 실제 저장 한도는 `width`의 글꼴 수치를 쓴다. `check`는 0 */
  budget: number;
  /** 실제 원본 런의 글꼴 수치와 이 입력에 남겨 둔 폭(HWPUNIT). */
  width?: { available: number; styles: PaperGlyphStyles; charPrIDRef: number };
  /** 원본에 인쇄된 항목 이름 — 원문에서 그대로 가져온다 */
  label: string;
  /** 그 자리의 바로 앞뒤 원문. 어디를 채우는지 읽어서 알 수 있게 보여 준다 */
  context?: string;
  input?: "text" | "tel" | "email" | "numeric";
  /**
   * 동의·확인 표시칸이면, 그 동의문의 원문 전체.
   * 자동으로 고르지 않고 사람이 원문을 읽고 직접 고르도록 화면에 그대로 보여 준다.
   */
  declaration?: string;
  /** 있으면 값을 받지 않는다 */
  locked?: PaperLock;
}

export type PaperSegment =
  | { kind: "text"; text: string }
  | { kind: "slot"; id: string };

/** 원문 한 줄 — 인쇄된 글자와 그 사이의 빈칸이 원래 순서대로 들어 있다. */
export interface PaperParagraphView {
  at: PaperAt;
  segments: PaperSegment[];
}

export type PaperNode =
  | ({ kind: "paragraph" } & PaperParagraphView)
  | { kind: "table"; index: number; colCount: number; rows: PaperCellView[][] };

export interface PaperCellView {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** `printed`는 원문만 적힌 칸(머리글·안내문), `entry`는 채우는 칸 */
  role: "printed" | "entry";
  nodes: PaperNode[];
}

export interface PaperFileIdentity {
  path: string;
  bytes: number;
  sha256: string;
}

/** 변환하지 않은 공개 원본 (HWP). 이 값과 공개 목록이 다르면 작성을 열지 않는다. */
export interface PaperSourceIdentity extends PaperFileIdentity {
  format: "hwp";
}

export interface PaperSectionInfo {
  /** 꾸러미 안 이름 (`Contents/section0.xml`) */
  name: string;
  tableCount: number;
  paragraphCount: number;
}

export interface PaperPreviewPlan {
  /** 다시 만들어 넣을 미리보기 글 항목 */
  textEntry: string;
  /** 이 규칙으로 빈 원본의 미리보기 글을 그대로 재현했는지 */
  exact: boolean;
  /** 원본 미리보기 글이 잘려 있던 길이 — 없으면 자르지 않는다 */
  limit: number | null;
  /** 완성 파일에서 지울 항목 (빈 원본 그림 등) */
  dropEntries: string[];
}

export interface PaperUnsupported {
  /** 사람에게 그대로 보여 주는, 그 자리를 열지 않은 이유 */
  reason: string;
  /** 같은 이유로 열지 못한 자리 수 */
  count: number;
  /** 그중 첫 자리 */
  at?: PaperAt;
}

export interface PaperManifest {
  schema: 1;
  formId: string;
  /** 공개 목록에 적힌 서식 이름 그대로 */
  title: string;
  lawTitle: string;
  sourceKind: string;
  source: PaperSourceIdentity;
  /** 작성용으로 변환한 양식 — 공식 원본이 아니다 */
  asset: PaperFileIdentity;
  pageCount: number;
  checkedAt: string;
  sourceTextSha256: string;
  sections: PaperSectionInfo[];
  preview: PaperPreviewPlan;
  /** 원문 순서대로 — 그대로 그리면 원본 배치가 된다 */
  blocks: PaperNode[];
  slots: Record<string, PaperSlot>;
  /**
   * 문단 한 줄에 들어갈 수 있는 너비 (`paperSlotAtKey(at)` → 반각 칸 수).
   * 표시칸 때문에 줄이 한 칸 늘어나는 경우에도 원본 칸을 넘지 않는지 보는 데 쓴다.
   */
  capacities: Record<string, number>;
  /** 원본 런별 글꼴·장평·상대 크기·자간과 한 줄 폭. */
  lineMetrics?: Record<string, PaperLineMetrics>;
  unsupported: PaperUnsupported[];
  /** 파일을 받은 뒤 사람이 직접 해야 하는 것 */
  manual: string[];
  /** 사업별 검토표가 있는 서식만. 그 사업에서 쓸 수 있는 자리 id 목록이다. */
  programmeSlots?: Record<string, string[]>;
  /** programmeSlots 의 사업 목록. 여기 없는 사업에서는 작성을 열지 않는다. */
  programmeIds?: string[];
}

/**
 * 사업별로 검토해 연 입력칸. 그 서식의 원본·변환본 해시와 사업ID에 함께 묶이며,
 * 승인 불리언이 아니라 실제 존재하는 slotID 목록이다.
 */
export interface PaperWritingScope {
  sourceSHA256: string;
  assetSHA256: string;
  programmes: Record<string, string[]>;
}

export interface PaperWritingScopes {
  schema: 1;
  forms: Record<string, PaperWritingScope>;
}

export interface PaperIndexEntry {
  source: PaperSourceIdentity;
  asset: PaperFileIdentity;
  manifest: string;
  manifestSha256: string;
  pageCount: number;
  checkedAt: string;
  slotCount: number;
  lockedCount: number;
  /** 사업별 검토표가 있는 서식만. 그 사업에서만 화면 작성을 연다. */
  programmeIds?: string[];
}

export interface PaperIndexShard {
  schema: 1;
  bucket: string;
  forms: Record<string, PaperIndexEntry>;
}

/**
 * 검증된 변환본을 그대로 내려받기 위한 항목. 화면 입력을 지원하지 않는 변환본도 들어간다.
 * 작성용 manifest 와 달리 원본·변환본의 신원과 그 검증 근거만 싣는다.
 */
export interface HwpxDownloadEntry {
  source: PaperSourceIdentity;
  asset: PaperFileIdentity;
  pageCount: number;
  checkedAt: string;
  verification: string;
  metadataSanitized: true;
}

export interface HwpxDownloadShard {
  schema: 1;
  bucket: string;
  forms: Record<string, HwpxDownloadEntry>;
}

export interface HwpxDownloadSummary {
  schema: 1;
  generatedAt: string;
  buckets: string[];
  counts: { conversions: number; downloads: number; rejected: number };
}

export interface PaperIndexSummary {
  schema: 1;
  generatedAt: string;
  sharded: true;
  buckets: string[];
  formIds: string[];
  counts: { conversions: number; writable: number; unsupported: number };
}

export type PaperValues = Record<string, string>;
export type PaperChecks = Record<string, boolean>;

/* ── 원문에서 값을 다룰 때 쓰는 작은 함수들 ───────────────────────── */

/** 화면 배치용 대략 한도. 실제 저장 허용 여부는 slot.width의 글꼴 수치로 판단한다. */
export function paperBudgetLabel(units: number): string {
  return `대략 한글 ${Math.floor(units / 2)}자 · 실제 글꼴 폭에 따라 달라져요`;
}

export const paperSlotAtKey = (at: PaperAt): string =>
  `${at.section}/${at.table ?? "b"}/${at.row}/${at.col}/${at.p}`;

/** 값을 받을 수 있는 자리만. 서명·동의·기관 접수 자리는 빠진다. */
export function openSlots(manifest: PaperManifest): PaperSlot[] {
  return Object.values(manifest.slots).filter(slot => !slot.locked);
}

/** 실제로 문서에 들어갈 값만 남긴다. 잠긴 자리와 빈 값은 버린다. */
export function normalizePaperInput(manifest: PaperManifest, values: PaperValues, checks: PaperChecks): {
  values: PaperValues; checks: PaperChecks;
} {
  const nextValues: PaperValues = {};
  const nextChecks: PaperChecks = {};
  for (const slot of openSlots(manifest)) {
    if (slot.kind === "check") {
      if (checks[slot.id]) nextChecks[slot.id] = true;
      continue;
    }
    const value = (values[slot.id] ?? "").trim();
    if (value) nextValues[slot.id] = value;
  }
  return { values: nextValues, checks: nextChecks };
}
