/**
 * (2026-10-22 첫 매일 확인 뒤 보완) 메뉴판 표 읽기를 어디서 돌려도 같은 결과로.
 * 첫 실행에서 PDF는 1개만 바뀌었는데 표 약 2,400줄이 달라졌다 — 띄어쓰기 기준 문장을 모으는 번들 파일 순서가
 * 운영체제마다 달라서(glob 순서). 파일 순서를 고정하고, 바뀌지 않은 PDF의 행은 어제 결과를 그대로 쓴다.
 * 파이썬 함수는 pdfplumber 없이도 불러올 수 있다 (표 읽기 때만 필요).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MOD = path.resolve(__dirname, "../mohw");
const py = (code: string) =>
  JSON.parse(execFileSync("python3", ["-I", "-c", `import sys, json; sys.path.insert(0, ${JSON.stringify(MOD)}); import parse_menus as m\n${code}`], { encoding: "utf8" }));

describe("메뉴판 표 읽기: 순서와 무관하게 같은 결과", () => {
  it("번들 파일 목록은 이름순 (전국 → 시·도 → 시·군·구)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundles-"));
    for (const d of ["sido", "sigungu"]) fs.mkdirSync(path.join(dir, d));
    for (const f of ["sigungu/41110.json", "sido/41000.json", "sigungu/11110.json", "sido/11000.json"]) fs.writeFileSync(path.join(dir, f), "{}");
    const files: string[] = py(`print(json.dumps(m.bundle_files(${JSON.stringify(dir)})))`)
      .map((file: string) => path.relative(dir, file).split(path.sep).join("/"));
    expect(files).toEqual(["national.json", "sido/11000.json", "sido/41000.json", "sigungu/11110.json", "sigungu/41110.json"]);
  });
  it("행 ID에서 글 열쇠(게시판:글번호:첨부)", () => {
    expect(py(`print(json.dumps([m.post_key("0075:1489537:1:3:5"), m.post_key("0075:1489537:1:3:5:202604+")]))`)).toEqual(["0075:1489537:1", "0075:1489537:1"]);
  });
});

describe("바뀐 PDF만 다시 읽기", () => {
  const posts = `[{"bid":"0075","listNo":"1","seq":"1"},{"bid":"0075","listNo":"2","seq":"1"},{"bid":"0080","listNo":"3","seq":"1"}]`;
  it("다시 읽을 글: 바뀐 글 + 어제 결과에 없는 글", () => {
    const got = py(`print(json.dumps(sorted(m.posts_to_parse(json.loads('${posts}'), {"0075:1:1": [{}], "0075:2:1": [{}]}, {"0075:2:1"}))))`);
    expect(got).toEqual(["0075:2:1", "0080:3:1"]);
  });
  it("합치기: 글 순서대로, 안 바뀐 글은 어제 행 그대로, 목록에서 빠진 글의 행은 버림", () => {
    const got = py(`print(json.dumps(m.assemble(json.loads('${posts}'), {"0075:1:1": [{"n": "어제1"}], "0075:2:1": [{"n": "어제2"}], "0099:9:1": [{"n": "빠진 글"}]}, {"0075:2:1": [{"n": "오늘2a"}, {"n": "오늘2b"}], "0080:3:1": [{"n": "새 글"}]})))`);
    expect(got.map((r: { n: string }) => r.n)).toEqual(["어제1", "오늘2a", "오늘2b", "새 글"]);
  });
});

describe("사업명 칸이 번호 칸과 합쳐진 표 (군산·세종·부안·무주, 2026-10-22 재생성 때 사업명이 '1', '2'로 나온 148건)", () => {
  const head = `["대분류", "중분류", "사업명", "", "사업내용", "지원대상", "세부대상자(우선순위)", "서비스제공기관", "사업구분"]`;
  it("머리글 '사업명' 바로 뒤 빈 머리글 칸을 이름 후보로 기억", () => {
    expect(py(`print(json.dumps(m.header_map(json.loads('${head}'))))`)).toMatchObject({ name: 2, name_next: 3, description: 4 });
  });
  it("이름 칸이 번호뿐이면 옆 칸의 이름을 쓴다, 아니면 그대로", () => {
    const got = py(`h = m.header_map(json.loads('${head}'))
print(json.dumps([m.row_name(["", "", "1", "일차의료 방문진료", "x"], h), m.row_name(["", "", "노인맞춤돌봄", "", "x"], h), m.row_name(["", "", "12", "", "x"], h)]))`);
    expect(got).toEqual(["일차의료 방문진료", "노인맞춤돌봄", "12"]);
  });
});

describe("글 제목에서 시군구 (인천 개편 이름 뒤 괄호, 2026-10-22 재생성 때 인천 3개 구 207건이 '인천 전체'로 나옴)", () => {
  it("구 이름 바로 뒤에 괄호가 와도 그 구", () => {
    const got = py(`print(json.dumps([m.sigungu_of(t, "인천광역시") for t in ["인천광역시 서해구(舊 서구) 통합돌봄 서비스 메뉴판 (26년 5월말 기준)", "인천광역시 영종구(舊 중구) 통합돌봄 서비스 메뉴판", "인천광역시 미추홀구 통합돌봄 서비스 메뉴판"]]))`);
    expect(got).toEqual(["서해구", "영종구", "미추홀구"]);
  });
  it("시·도 전체 메뉴판은 시·도 그대로", () => {
    expect(py(`print(json.dumps(m.sigungu_of("세종특별자치시 통합돌봄 서비스 메뉴판(26년 3월 기준)입니다.", "세종특별자치시")))`)).toBe("세종특별자치시");
  });
});

describe("(2026-10-25) 칸이 밀린 행·'신규' 번호 — 광주 동구·남구, 울산 북구·동구 등에서 행이 통째로 빠지고 무주는 이름이 '2 신규'", () => {
  // 광주 동구 메뉴판(26년 5월) 표 머리글: 0 대분류 · 1 중분류 · 4 연번 · 5 사업명 · 8 사업내용 · 11 지원대상 · 12 제공기관 · 15 사업구분
  const cells = (o: Record<number, string>) => JSON.stringify(Array.from({ length: 16 }, (_, i) => o[i] ?? null));
  const head = cells({ 0: "대분류", 1: "중분류", 4: "연번", 5: "사업명", 8: "사업내용", 11: "지원대상", 12: "제공기관", 15: "사업구분" });
  // 밀린 칸은 표 전체를 보고 정한다 — 머리글 + (다른 행들) + 이 행
  const read = (row: string, after = false, others: string[] = []) =>
    py(`h = m.header_map(json.loads(r'${head}'))
table = [json.loads(r'${head}')] + [json.loads(x) for x in json.loads(r'${JSON.stringify(others)}')] + [json.loads(r'${row}')]
k, raw, s = m.read_row(table[-1], h, ${after ? "True" : "False"}, m.spill_cols(table, h))
print(json.dumps([k, raw["name"], raw["description"], raw["provider"], s]))`);
  it("번호 칸 머리글('연번')을 기억", () => {
    expect(py(`print(json.dumps(m.header_map(json.loads(r'${head}'))))`)).toMatchObject({ name: 5, name_next: 6, no: 4, description: 8, provider: 12 });
  });
  it("이름·내용·기관이 한 칸씩 밀린 행: 번호가 있으면 새 행으로, 밀린 칸에서 읽음", () => {
    expect(read(cells({ 1: "식사지원", 4: "34", 6: "거동불편 독거노인", 8: "도시락 배달 및\n안부확인 등", 11: "노인", 13: "빛고을종합", 15: "지역특화" }))).toEqual([
      "new", "거동불편 독거노인", "도시락 배달 및\n안부확인 등", "빛고을종합", true,
    ]);
  });
  it("밀린 행 다음 줄(번호 없음)은 이어지는 줄 — 이름 둘째 줄도 밀린 칸에서", () => {
    expect(read(cells({ 6: "도시락배달", 13: "사회복지관" }), true)).toEqual(["cont+name", "도시락배달", "", "사회복지관", false]);
  });
  it("보통 행의 이어지는 줄은 예전처럼 제자리 칸만", () => {
    expect(read(cells({ 6: "글자", 8: "이어지는 내용" }))).toEqual(["cont", "", "이어지는 내용", "", false]);
  });
  it("이름은 제자리, 내용만 밀린 행(The 조아 건강지킴이): 빈 내용 칸을 밀린 칸에서", () => {
    expect(read(cells({ 1: "스마트\n돌봄", 4: "39", 5: "The 조아\n건강지킴이", 9: "주1회 도서낭독 및", 11: "노인, 장애인", 12: "조선대학교", 15: "지역특화" }))).toEqual([
      "new", "The 조아\n건강지킴이", "주1회 도서낭독 및", "조선대학교", true,
    ]);
  });
  it("보통 행은 예전과 같음", () => {
    expect(read(cells({ 1: "일상생활\n지원", 4: "22", 5: "노인맞춤돌봄서비스", 8: "말벗, 안부확인", 11: "노인", 12: "빛고을종합", 15: "전국" }))).toEqual([
      "new", "노인맞춤돌봄서비스", "말벗, 안부확인", "빛고을종합", false,
    ]);
  });
  it("진주: 기관 옆 칸에 늘 '전국'이 함께 있으면 밀린 칸이 아님 — 빈 기관 칸에 '전국'을 넣지 않음", () => {
    const usual = cells({ 4: "28", 5: "방문요양", 8: "지정 장기요양기관", 11: "노인", 12: "지정 장기요양기관", 13: "전국", 15: "전국" });
    expect(read(cells({ 4: "27", 5: "의료급여\n사례관리", 8: "수급권자가 스스로", 11: "의료급여 수급자", 13: "전국" }), false, [usual, usual])).toEqual([
      "new", "의료급여\n사례관리", "수급권자가 스스로", "", false,
    ]);
  });
  it("무주: 이름 칸이 '2(줄바꿈)신규'이면 옆 칸의 이름", () => {
    const h = `["대분\\n류", "중분\\n류", "사업명", null, "사업내용", "대상자\\n범주", "세부대상자\\n(우선순위)", "서비스\\n제공기관", "사업구분"]`;
    const got = py(`h = m.header_map(json.loads(r'${h}'))
print(json.dumps([m.row_name([None, None, "2\\n신규", "방문의료\\n지원사업", "x", "", "", "", ""], h), m.row_name([None, None, "4", "AI·IoT기반", "x", "", "", "", ""], h)]))`);
    expect(got).toEqual(["방문의료\n지원사업", "AI·IoT기반"]);
  });
});

describe("(2026-10-25) 표 읽는 방식이 바뀌면 모든 글을 다시 읽음", () => {
  const posts = `[{"bid":"0075","listNo":"1","seq":"1"},{"bid":"0075","listNo":"2","seq":"1"}]`;
  it("어제 결과의 판이 지금과 다르면 전부, 같으면 바뀐 글만", () => {
    const got = py(`p = json.loads('${posts}'); prev = {"0075:1:1": [{}], "0075:2:1": [{}]}
print(json.dumps([sorted(m.posts_to_parse(p, prev, set(), 1)), sorted(m.posts_to_parse(p, prev, set(), m.PARSER_VERSION))]))`);
    expect(got).toEqual([["0075:1:1", "0075:2:1"], []]);
  });
});
