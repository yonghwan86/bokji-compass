import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

// E 회차 5원본·6관계의 용도 경계 회귀검사.
// 기대값은 모두 승인 원고에 고정된 정적 값이다. 실행 중 fixture 를 만들거나
// 화면·파일에서 읽은 값을 그대로 기대값으로 쓰지 않는다.

type Original = {
  readonly id: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly format: "hwp" | "hwpx";
  readonly heading: string;
};

const ASAN: Original = {
  id: "ordin-21127609",
  sha256: "b6100833b99537ce6e62a7fb00a82d5721d4226943c5f84a73d9d1c3e3a77599",
  bytes: 207_360,
  format: "hwp",
  heading: "아산시 산후관리비 통합신청서(조례 첨부 별지1)",
};

const SUNCHEON_GENERAL: Original = {
  id: "ordin-20214487",
  sha256: "2a4a805d19cb24737fc2656145672ce83188a4bdbc93cfd3c1afaf5d1b5c1483",
  bytes: 44_544,
  format: "hwp",
  heading: "순천시 지방보조금 교부 신청서(조례 별지 제1호)",
};

const EUMSEONG_PEPPER: Original = {
  id: "agency-43770-eumseong-pepper-148280",
  sha256: "9d65c74524d840783d127f44c2b4fe4f96951a6644969b9acfb3e4df94af846a",
  bytes: 134_656,
  format: "hwp",
  heading: "2026 회차자료 · 접수종료(금왕읍 2026.2.9) — 고추 생산장비 사업 신청서",
};

const SUNCHEON_PACKET: Original = {
  id: "agency-12150-suncheon-small-71811",
  sha256: "db42f2522e415d43fbd838308b7ff0dbe954ae670c9d9f80a4de904253449093",
  bytes: 65_536,
  format: "hwp",
  heading: "2026 회차자료 · 접수종료(2026.1.16) — 영세농가 소형 비닐하우스 신청·동의서 포함 계획",
};

// displayTitle 이 없으므로 실제 서식 제목이 그대로 heading 이 된다.
const NATIONAL_ANNEX2: Original = {
  id: "rule-3249999",
  sha256: "4b3961ff5ce2888a76c3c51fd62d7a1b3ce3507af323ce92369ace06bdc65daa",
  bytes: 37_825,
  format: "hwpx",
  heading: "출산서비스 통합처리 신청서",
};

const POHANG_PROGRAM = "g47110.gov24-502000000209";
const YANGGU_PROGRAM = "g51800.gov24-432000000240";
const SUNCHEON_PROGRAM = "g12150.gov24-482000000133";
const SUNCHEON_GARDEN_PROGRAM = "g12150.gov24-482000000141";
const EUMSEONG_PROGRAM = "g43770.gov24-447000000111";
const ASAN_PROGRAM = "g44200.gov24-452000000339";

const RELATIONS: ReadonlyArray<readonly [string, Original]> = [
  [ASAN_PROGRAM, ASAN],
  [SUNCHEON_PROGRAM, SUNCHEON_GENERAL],
  [SUNCHEON_PROGRAM, SUNCHEON_PACKET],
  [EUMSEONG_PROGRAM, EUMSEONG_PEPPER],
  [POHANG_PROGRAM, NATIONAL_ANNEX2],
  [YANGGU_PROGRAM, NATIONAL_ANNEX2],
];

function downloadPath(original: Original): string {
  return `/forms/files/${original.id}-${original.sha256.slice(0, 12)}.${original.format}`;
}

function cardFor(page: import("@playwright/test").Page, heading: string) {
  return page
    .getByTestId("application-forms")
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
}

async function expectTitleAndConditionBeforeDownload(
  page: import("@playwright/test").Page,
  original: Original,
  conditionFragment: string,
) {
  const card = cardFor(page, original.heading);
  await expect(card).toHaveCount(1);
  const order = await card.evaluate((element, args) => {
    const heading = element.querySelector("h4");
    const condition = Array.from(element.querySelectorAll("p")).find(p =>
      p.textContent?.includes(args.fragment),
    );
    const download = element.querySelector(`a[href="${args.href}"]`);
    if (!heading || !condition || !download) {
      return { headingBefore: false, conditionBefore: false };
    }
    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    return {
      headingBefore: Boolean(heading.compareDocumentPosition(download) & following),
      conditionBefore: Boolean(condition.compareDocumentPosition(download) & following),
    };
  }, { fragment: conditionFragment, href: downloadPath(original) });
  expect(order).toEqual({ headingBefore: true, conditionBefore: true });
}

async function expectNoWriter(
  page: import("@playwright/test").Page,
  heading: string,
) {
  const card = cardFor(page, heading);
  await expect(card.getByTestId("paper-writer-link")).toHaveCount(0);
  await expect(card.getByRole("link", { name: /화면에서 작성/ })).toHaveCount(0);
}

test("순천 신규 패킷은 접수종료·V선인쇄·기관평가를 다운로드 앞에 알리고 작성기를 열지 않는다 @mobile", async ({ page }) => {
  await page.goto(`/p/${SUNCHEON_PROGRAM}`);
  const card = cardFor(page, SUNCHEON_PACKET.heading);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("2026.1.16");
  await expect(card).toContainText("동의항목3곳에는 V표시가 선인쇄");
  await expect(card).toContainText("실제 동의로 간주하지 않습니다");
  await expect(card).toContainText("별지2 평가표는 기관 평가·확인용");
  await expect(card).toContainText("웹 자동작성은 제공하지 않습니다");
  await expect(card.locator(`a[href="${downloadPath(SUNCHEON_PACKET)}"]`)).toHaveCount(1);
  await expectTitleAndConditionBeforeDownload(page, SUNCHEON_PACKET, "2026.1.16");
  await expectNoWriter(page, SUNCHEON_PACKET.heading);
});

test("순천 일반 교부 별지1은 공고 별지1과 구분하고 추가 제출 단계를 단정하지 않는다 @mobile", async ({ page }) => {
  await page.goto(`/p/${SUNCHEON_PROGRAM}`);
  const card = cardFor(page, SUNCHEON_GENERAL.heading);
  await expect(card).toHaveCount(1);
  // 공고 붙임 별지1 과 조례 별지 제1호서식을 명시적으로 구분한다.
  await expect(card).toContainText("서로 다른 서식");
  await expect(card).toContainText("제출 필요 여부와 기일을 순천시 담당부서에 확인");
  await expect(card).toContainText("1-1호·1-2호·1-3호");
  // 단계를 단정하는 표현이 남아 있으면 안 된다.
  await expect(card).not.toContainText("선정자용");
  await expect(card).not.toContainText("이미 선정");
  await expect(card.locator(`a[href="${downloadPath(SUNCHEON_GENERAL)}"]`)).toHaveCount(1);
  // 정원수 자재지원으로 확대하지 않는다.
  await page.goto(`/p/${SUNCHEON_GARDEN_PROGRAM}`);
  await expect(page.locator(`a[href="${downloadPath(SUNCHEON_GENERAL)}"]`)).toHaveCount(0);
  await expect(page.locator(`a[href="${downloadPath(SUNCHEON_PACKET)}"]`)).toHaveCount(0);
});

test("음성 고추지원은 접수종료와 인쇄 기본값을 밝히고 실제 동의로 간주하지 않는다 @mobile", async ({ page }) => {
  await page.goto(`/p/${EUMSEONG_PROGRAM}`);
  const card = cardFor(page, EUMSEONG_PEPPER.heading);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("2026.2.9");
  await expect(card).toContainText("성별 ‘남’");
  await expect(card).toContainText("동의항목 선체크2곳");
  await expect(card).toContainText("‘2026.1.’");
  await expect(card).toContainText("내려받는 이용자의 개인정보·동의를 확인한 것이 아닙니다");
  await expect(card).toContainText("웹 자동작성·동의생성은 제공하지 않습니다");
  await expect(card.locator(`a[href="${downloadPath(EUMSEONG_PEPPER)}"]`)).toHaveCount(1);
  await expectTitleAndConditionBeforeDownload(page, EUMSEONG_PEPPER, "2026.2.9");
  await expectNoWriter(page, EUMSEONG_PEPPER.heading);
});

test("현행 국가 별지2는 포항·양구에 서로 다른 조건으로 제공하고 옛 지자체 원본을 대신하지 않는다 @mobile", async ({ page }) => {
  const href = downloadPath(NATIONAL_ANNEX2);

  await page.goto(`/p/${POHANG_PROGRAM}`);
  const pohang = cardFor(page, NATIONAL_ANNEX2.heading);
  await expect(pohang).toHaveCount(1);
  await expect(pohang).toContainText("출생축하금");
  await expect(pohang).toContainText("90일 이내");
  await expect(pohang).toContainText("첫째아를 제외하거나 거짓 출생순위에 표시하지 않습니다");
  await expect(pohang).toContainText("옛 포항 첨부 별지1과 동일 판본으로 표시하지 않으며");
  await expect(pohang.locator(`a[href="${href}"]`)).toHaveCount(1);
  // 옛 포항 원본 경로가 이 카드로 대체되지 않는다.
  await expect(page.locator('a[href^="/forms/files/ordin-21785751-"]')).toHaveCount(0);
  // 양구 쪽 수치가 포항 조건에 섞이지 않는다.
  await expect(pohang).not.toContainText("월3만원");

  await page.goto(`/p/${YANGGU_PROGRAM}`);
  const yanggu = cardFor(page, NATIONAL_ANNEX2.heading);
  await expect(yanggu).toHaveCount(1);
  await expect(yanggu).toContainText("건강보험가입 지원");
  await expect(yanggu).toContainText("월3만원");
  await expect(yanggu).toContainText("정부24의 월2만원");
  await expect(yanggu).toContainText("3년납5년보장");
  await expect(yanggu).toContainText("보험료·기간이 인쇄되어 있지 않습니다");
  await expect(yanggu.locator(`a[href="${href}"]`)).toHaveCount(1);
  await expect(page.locator('a[href^="/forms/files/ordin-20232531-"]')).toHaveCount(0);
  await expect(yanggu).not.toContainText("출생축하금");
});

test("아산 산후관리비는 6개월 신청기한과 6·12개월 거주기준 차이를 함께 알린다 @mobile", async ({ page }) => {
  await page.goto(`/p/${ASAN_PROGRAM}`);
  const card = cardFor(page, ASAN.heading);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("출생일부터6개월 이내");
  await expect(card).toContainText("출산일 전6개월 거주");
  await expect(card).toContainText("12개월 거주");
  await expect(card).toContainText("접수처의 현행 기준과 대조");
  await expect(card).toContainText("산후도우미 환급으로 확대하지 않습니다");
  await expect(card.locator(`a[href="${downloadPath(ASAN)}"]`)).toHaveCount(1);
  await expectNoWriter(page, ASAN.heading);
});

test("E 6관계의 공개 원본은 선언된 바이트와 SHA256 으로 내려온다", async ({ request }) => {
  for (const [program, original] of RELATIONS) {
    const response = await request.get(downloadPath(original));
    expect(response.status(), `${program} / ${original.id}`).toBe(200);
    const body = await response.body();
    expect(body.byteLength, `${original.id} bytes`).toBe(original.bytes);
    expect(createHash("sha256").update(body).digest("hex"), `${original.id} sha`).toBe(original.sha256);
  }
});

test("E 인쇄 동의·부분 승인 보류 원본은 작성기 매니페스트를 두지 않는다", async ({ request }) => {
  for (const original of [EUMSEONG_PEPPER, SUNCHEON_PACKET, ASAN]) {
    const response = await request.get(`/forms/writing/v1/manifest/${original.id}.json`);
    expect(response.status(), `${original.id} manifest`).toBe(404);
  }
});

test("계룡 오출처 의료비 원본을 제외해도 동일 SHA 출산 공개파일은 보존한다 @mobile", async ({ page, request }) => {
  const proper = "/forms/files/ordin-22429439-8e1bf9df8dfe.hwpx";
  const response = await request.get(proper);
  expect(response.status()).toBe(200);
  const body = await response.body();
  expect(body.byteLength).toBe(46_225);
  expect(createHash("sha256").update(body).digest("hex")).toBe(
    "8e1bf9df8dfe1bbc6e7f66a7b1466cafd2b44174fdce0976281cc41d7aeb302f",
  );

  await page.goto("/p/g44250.gov24-558000000112");
  await expect(page.locator(`a[href="${proper}"]`)).toHaveCount(1);
  // 오출처 식별자는 어느 화면에도 노출되지 않는다.
  await expect(page.locator('a[href^="/forms/files/ordin-22429465-"]')).toHaveCount(0);

  await page.goto("/p/g44250.bokjiro-WLF00006176");
  await expect(page.locator('a[href^="/forms/files/ordin-22429465-"]')).toHaveCount(0);
  await expect(page.locator(`a[href="${proper}"]`)).toHaveCount(0);
});

test("고성 오출처 일반 원본을 제외해도 참전 사망위로금 공개파일은 보존한다 @mobile", async ({ page, request }) => {
  const proper = "/forms/files/ordin-22484275-246c99528329.hwpx";
  const response = await request.get(proper);
  expect(response.status()).toBe(200);
  const body = await response.body();
  expect(body.byteLength).toBe(40_765);
  expect(createHash("sha256").update(body).digest("hex")).toBe(
    "246c9952832946ff8e2149a3cdb4feab0c035422e23437084bffcc26476bc46b",
  );

  await page.goto("/p/g51820.bokjiro-WLF00004138");
  await expect(page.locator(`a[href="${proper}"]`)).toHaveCount(1);
  await expect(page.locator('a[href^="/forms/files/ordin-22583083-"]')).toHaveCount(0);

  await page.goto("/p/g51820.gov24-434000000108");
  await expect(page.locator('a[href^="/forms/files/ordin-22583083-"]')).toHaveCount(0);
});
