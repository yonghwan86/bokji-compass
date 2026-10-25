/** (2026-10-22) 매일 변경 감지: 어제·오늘 원천을 비교해 추가·변경·삭제를 세고, 이상하면 경고 (배포 전 점검) */
import { describe, expect, it } from "vitest";
import { compareSnapshots, fieldCounts, fingerprint, gateCheck, menuDrift, missingFields, moneyChanges, summarize, type SourceReport } from "../src/refresh/diff";
import { GOV24_NOISE, stripNoise } from "../src/gov24/ingest";
import { LIST_NOISE, stripListNoise } from "../src/bokjiro/ingest";

describe("fingerprint: 같은 내용이면 같은 지문, 조회수 같은 잡음은 무시", () => {
  it("키 순서와 무관", () => {
    expect(fingerprint({ a: 1, b: "x" })).toBe(fingerprint({ b: "x", a: 1 }));
  });
  it("무시할 필드는 빼고 계산", () => {
    const a = { servId: "W1", servNm: "기초연금", inqNum: "120" };
    const b = { servId: "W1", servNm: "기초연금", inqNum: "999" };
    expect(fingerprint(a, ["inqNum"])).toBe(fingerprint(b, ["inqNum"]));
    expect(fingerprint({ ...a, servNm: "기초연금 지원" }, ["inqNum"])).not.toBe(fingerprint(a, ["inqNum"]));
  });
});

describe("정부24 잡음: 조회수만 바뀐 사업은 '변경'이 아님 (2026-10-22 첫 실행에서 10,958건 중 10,955건이 조회수만으로 '변경')", () => {
  const row = { 서비스ID: "305000000287", 서비스명: "공공 유휴공간 개방", 조회수: 1139, 수정일시: "20260810092846" };
  it("조회수만 다르면 같은 지문", () => {
    expect(fingerprint({ ...row, 조회수: 1200 }, GOV24_NOISE)).toBe(fingerprint(row, GOV24_NOISE));
  });
  it("수정일시·내용이 바뀌면 다른 지문", () => {
    expect(fingerprint({ ...row, 수정일시: "20261020100000" }, GOV24_NOISE)).not.toBe(fingerprint(row, GOV24_NOISE));
    expect(fingerprint({ ...row, 서비스명: "공공 유휴공간 개방 확대" }, GOV24_NOISE)).not.toBe(fingerprint(row, GOV24_NOISE));
  });
});

describe("compareSnapshots", () => {
  it("추가·삭제·변경을 id로 센다", () => {
    const before = new Map([["1", "f1"], ["2", "f2"], ["3", "f3"]]);
    const after = new Map([["1", "f1"], ["2", "f2b"], ["4", "f4"]]);
    const d = compareSnapshots(before, after);
    expect(d).toEqual({ total: 3, previous: 3, added: ["4"], removed: ["3"], changed: ["2"] });
  });
  it("처음 수집이면 모두 추가", () => {
    const d = compareSnapshots(new Map(), new Map([["1", "a"]]));
    expect(d.added).toEqual(["1"]);
    expect(d.previous).toBe(0);
  });
});

describe("gateCheck: 배포 전 점검", () => {
  const ok: SourceReport = { source: "gov24", status: "ok", total: 10_000, previous: 10_050, added: [], removed: [], changed: [] };
  it("정상이면 경고 없음", () => {
    expect(gateCheck([ok])).toEqual({ ok: true, warnings: [] });
  });
  it("건수가 10% 넘게 줄면 경고", () => {
    const g = gateCheck([{ ...ok, total: 8_900 }]);
    expect(g.ok).toBe(false);
    expect(g.warnings[0]).toContain("gov24");
    expect(g.warnings[0]).toContain("11%");
  });
  it("수집 오류면 경고", () => {
    const g = gateCheck([{ ...ok, status: "error", detail: "HTTP 500" }]);
    expect(g.ok).toBe(false);
    expect(g.warnings[0]).toContain("HTTP 500");
  });
  it("처음 수집(이전 0건)은 감소로 보지 않음", () => {
    expect(gateCheck([{ ...ok, previous: 0 }]).ok).toBe(true);
  });
});

describe("gateCheck 보강 (2026-10-22 첫 실행 뒤 보완)", () => {
  const ok: SourceReport = { source: "gov24", status: "ok", total: 10_000, previous: 10_000, added: [], removed: [], changed: [] };
  const many = (n: number) => Array.from({ length: n }, (_, i) => String(i));
  it("하루에 30% 넘게 '변경'이면 경고 (조회수 같은 잡음을 잡는다)", () => {
    const g = gateCheck([{ ...ok, changed: many(3_100) }]);
    expect(g.ok).toBe(false);
    expect(g.warnings[0]).toContain("31%");
    expect(gateCheck([{ ...ok, changed: many(2_900) }]).ok).toBe(true);
  });
  it("처음 수집(이전 0건)은 변경 비율을 보지 않음", () => {
    expect(gateCheck([{ ...ok, previous: 0, changed: many(10_000) }]).ok).toBe(true);
  });
  it("원천이 알려 준 전체 건수와 받은 건수가 다르면 경고", () => {
    const g = gateCheck([{ ...ok, expected: 10_012 }]);
    expect(g.ok).toBe(false);
    expect(g.warnings[0]).toContain("10,012");
    expect(gateCheck([{ ...ok, expected: 10_000 }]).ok).toBe(true);
  });
  it("원천 칸이 사라지면 경고", () => {
    const g = gateCheck([{ ...ok, schemaMissing: ["지원내용"] }]);
    expect(g.ok).toBe(false);
    expect(g.warnings[0]).toContain("지원내용");
  });
  it("메뉴판: 바뀌지 않은 PDF의 표 결과가 달라지면 경고", () => {
    const g = gateCheck([{ ...ok, source: "mohw", drift: 3 }]);
    expect(g.ok).toBe(false);
    expect(g.warnings[0]).toContain("3개");
    expect(gateCheck([{ ...ok, source: "mohw", drift: 0 }]).ok).toBe(true);
  });
  it("호출 한도로 '보류'는 하루는 통과, 이틀 연속이면 경고", () => {
    const held: SourceReport = { ...ok, source: "bokjiro-local", status: "held", detail: "일일 호출 예산 소진" };
    expect(gateCheck([held]).ok).toBe(true);
    expect(gateCheck([held], [{ source: "bokjiro-local", status: "ok" }]).ok).toBe(true);
    const g = gateCheck([held], [{ source: "bokjiro-local", status: "held" }]);
    expect(g.ok).toBe(false);
    expect(g.warnings[0]).toContain("이틀 연속");
  });
});

describe("원천 칸 구성 비교", () => {
  it("칸별 건수", () => {
    expect(fieldCounts([{ a: 1, b: 2 }, { a: 3 }])).toEqual({ a: 2, b: 1 });
  });
  it("전에 1% 넘게 있던 칸이 통째로 없어지면 '사라짐', 드문 칸은 무시", () => {
    const prev = { servId: 1000, servNm: 1000, lifeArray: 600, rare: 5 };
    expect(missingFields(prev, { servId: 1000, lifeArray: 590 })).toEqual(["servNm"]);
    expect(missingFields(prev, { servId: 1000, servNm: 1000, lifeArray: 1 })).toEqual([]);
    expect(missingFields(undefined, { servId: 1 })).toEqual([]);
  });
});

describe("메뉴판 결과 흔들림: 다시 읽지 않은 글의 행이 어제와 다르면 센다", () => {
  const row = (id: string, name: string) => ({ serviceId: id, name });
  const before = [row("0075:1:1:1:1", "가"), row("0075:1:1:1:2", "나"), row("0075:2:1:1:1", "다"), row("0080:3:1:1:1", "라")];
  it("다시 읽은 글(바뀐 PDF)은 빼고, 나머지 글 중 달라진 글 수", () => {
    const after = [row("0075:1:1:1:1", "가"), row("0075:1:1:1:2", "나 "), row("0075:2:1:1:1", "다2"), row("0080:3:1:1:1", "라")];
    expect(menuDrift(before, after, new Set(["0075:2:1"]))).toBe(1);
    expect(menuDrift(before, after, new Set(["0075:1:1", "0075:2:1"]))).toBe(0);
  });
  it("목록에서 빠진 글·새 글은 흔들림이 아님", () => {
    expect(menuDrift(before, before.slice(0, 3), new Set())).toBe(0);
    expect(menuDrift(before.slice(0, 3), before, new Set())).toBe(0);
  });
});

describe("summarize: 하루 기록 한 줄 (목록은 앞 50개만)", () => {
  it("개수와 표본", () => {
    const r: SourceReport = { source: "bokjiro", status: "ok", total: 5, previous: 4, added: Array.from({ length: 60 }, (_, i) => String(i)), removed: [], changed: ["x"] };
    const s = summarize(r);
    expect(s).toMatchObject({ source: "bokjiro", total: 5, added: 60, removed: 0, changed: 1 });
    expect(s.sample.added).toHaveLength(50);
  });
});

describe("금액이 바뀐 사업 (보완대책 8): 원문 지원내용에서 뽑은 금액이 어제와 다르면", () => {
  const t = (name: string, text: string) => ({ name, text });
  it("금액·주기가 바뀐 사업만, 원문 구절과 함께", () => {
    const before = new Map([["A", t("기초연금", "월 최대 342,510원 지급")], ["B", t("아동수당", "월 10만원")], ["C", t("교복", "1인당 30만원 지원")]]);
    const after = new Map([["A", t("기초연금", "월 최대 349,700원 지급")], ["B", t("아동수당", "월 10만원을 지급합니다")], ["C", t("교복", "1인당 30만원 지원")]]);
    const got = moneyChanges("gov24", before, after);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ source: "gov24", id: "A", name: "기초연금", before: { per: "month", won: 342510 }, after: { per: "month", won: 349700 } });
    expect(got[0].after?.quote).toContain("349,700원");
  });
  it("금액이 새로 생기거나 사라져도 알림, 새로 생긴·없어진 사업은 '변경'이 아님", () => {
    const before = new Map([["A", t("바우처", "서비스 제공")], ["B", t("수당", "월 20만원")], ["X", t("없어진 사업", "월 5만원")]]);
    const after = new Map([["A", t("바우처", "연 50만원 바우처")], ["B", t("수당", "서비스 연계")], ["Y", t("새 사업", "월 7만원")]]);
    const got = moneyChanges("bokjiro-local", before, after);
    expect(got.map((c) => [c.id, !!c.before, !!c.after])).toEqual([["A", false, true], ["B", true, false]]);
  });
});

describe("조회수는 저장하지 않음 (2026-10-22: 매일 모든 사업의 조회수가 바뀌어 data 브랜치가 하루 약 5MB씩 커짐)", () => {
  it("정부24 행에서 조회수만 뺀다", () => {
    expect(stripNoise([{ 서비스ID: "1", 서비스명: "가", 조회수: 120 }, { 서비스ID: "2", 서비스명: "나" }])).toEqual([{ 서비스ID: "1", 서비스명: "가" }, { 서비스ID: "2", 서비스명: "나" }]);
  });
  it("복지로 목록 XML에서 inqNum만 뺀다", () => {
    const xml = "<servList><inqNum>2498</inqNum><servId>WLF1</servId><servNm>교복</servNm></servList><servList><inqNum></inqNum><servId>WLF2</servId></servList>";
    expect(stripListNoise(xml)).toBe("<servList><servId>WLF1</servId><servNm>교복</servNm></servList><servList><servId>WLF2</servId></servList>");
  });
  it("칸 사라짐 점검은 일부러 뺀 칸(조회수)을 사라졌다고 하지 않음", () => {
    const prev = { "serviceList.서비스ID": 100, "serviceList.조회수": 100, inqNum: 100, servNm: 100 };
    expect(missingFields(prev, { "serviceList.서비스ID": 100, servNm: 100 }, [...GOV24_NOISE, ...LIST_NOISE])).toEqual([]);
    expect(missingFields(prev, { servNm: 100 }, [...GOV24_NOISE, ...LIST_NOISE])).toEqual(["serviceList.서비스ID"]);
  });
});

describe("(2026-10-25) 메뉴판 표 읽는 방식이 바뀌었는지", () => {
  it("parse_menus.py의 PARSER_VERSION과 어제 parse-report.json의 parserVersion(없으면 1)을 비교", async () => {
    const { menuParserOutdated } = await import("../src/refresh/diff");
    const py = "COLS = {}\nPARSER_VERSION = 2\n";
    expect(menuParserOutdated(py, { parserVersion: 2 })).toBe(false);
    expect(menuParserOutdated(py, {})).toBe(true);
    expect(menuParserOutdated(py, null)).toBe(true);
    expect(menuParserOutdated("x = 1\n", null)).toBe(false);
  });
});
