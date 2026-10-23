import { expect, test } from "@playwright/test";

/** QA 8차 (2026-10-09 실사용 시나리오 테스트) — 소득 입력·본인/부모님 분리·문장 재입력·질문 의존·검색 판정 말 */

test("월 소득: '100.5'는 그대로, '-100'은 오류를 보여 주고 결과로 넘어가지 않음 @mobile", async ({ page }) => {
  await page.goto("/situation?for=self&new=1&details=1");
  const inc = page.getByTestId("v2-income");
  await expect(inc).toBeVisible({ timeout: 20_000 });
  await page.locator("#sido").selectOption("41000");
  await page.locator("#sigungu").selectOption("41280");
  await inc.fill("100.5");
  await expect(inc).toHaveValue("100.5");
  await expect(page.getByTestId("v2-income-error")).toHaveCount(0);
  await inc.fill("-100");
  await expect(inc).toHaveValue("-100");
  await expect(page.getByTestId("v2-income-error")).toContainText("0 이상");
  await page.getByTestId("v2-submit").click();
  await expect(page).toHaveURL(/\/situation/);
  await expect(inc).toBeFocused();
});

test("내 복지 답이 부모님 복지로 넘어가지 않고, 돌아오면 그대로 @mobile", async ({ page }) => {
  await page.goto("/results?example=goyang-youth");
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await page.goto("/situation?for=parent&details=1");
  const inc = page.getByTestId("v2-income");
  await expect(inc).toBeVisible({ timeout: 20_000 });
  await expect(inc).toHaveValue("");
  await expect(page.getByRole("group", { name: /일을 하고 계신가요/ }).getByRole("radio", { name: "일자리를 찾고 있어요" })).not.toBeChecked();
  await expect(page.locator("#sigungu")).toHaveValue("");
  // 대상 버튼으로 바꾸면 적던 답이 돌아오고, 가져오기 단추로만 옮겨진다
  await page.getByTestId("mode-self").click();
  await expect(inc).toHaveValue("180");
  await page.getByTestId("mode-parent").click();
  await expect(inc).toHaveValue("");
  await page.getByTestId("carry-region").click();
  await expect(page.locator("#sigungu")).not.toHaveValue("");
  await expect(inc).toHaveValue("");
});

test("부모님 문장 '일하지 않아요' → 하는 일 '아니요', 지난 구직 답이 남지 않음", async ({ page }) => {
  await page.goto("/results?example=goyang-youth");
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await page.goto("/situation?for=self&details=1");
  await expect(page.getByRole("group", { name: /지금 하고 있는 일/ }).getByRole("radio", { name: "일자리를 찾고 있어요" })).toBeChecked({ timeout: 20_000 });
  await page.getByTestId("v2-text").fill("수원시에 사시는 59년생 부모님 두 분, 아버지가 거동이 불편하세요. 두 분 소득은 월 300만원이고 자가에 살아요. 일하지 않아요.");
  await page.getByTestId("v2-fill").click();
  await expect(page.getByTestId("v2-situation")).toHaveAttribute("data-mode", "parent");
  await expect(page.getByRole("group", { name: /일을 하고 계신가요/ }).getByRole("radio", { name: "아니요" })).toBeChecked();
  await expect(page.getByTestId("v2-income")).toHaveValue("300");
});

test("자녀 없음(고양 청년 예시) → 한부모 질문 없음, 성남 한부모 예시 → 어린이집·유치원 질문", async ({ page }) => {
  await page.goto("/results?example=goyang-youth");
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("v2-q-singleParent")).toHaveCount(0);
  await page.goto("/results?example=seongnam-single-parent");
  await expect(page.getByTestId("v2-q-daycare")).toBeVisible({ timeout: 20_000 });
});

test("검색: 저장된 상황이 있으면 맞춤 결과와 같은 판정 말, 지역 안내에 실린 중앙부처 사업 표시", async ({ page }) => {
  await page.goto("/results?example=parent-care&for=parent");
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await page.goto("/search?life=senior");
  const card = page.getByTestId("program-card").first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("card-judge").first()).toContainText(/받으실 수 있어요|신청할 때 확인|답하면 정해져요|맞지 않아요/);
  await expect(page.getByText(/가능성 있음|조건 불일치/)).toHaveCount(0);
  await expect(page.locator(".prow .meta").filter({ hasText: /중앙부처 사업 · 경기 수원시 안내/ }).first()).toBeVisible();
});

test("검색 지역은 새로고침해도 유지 (주소에는 싣지 않음), 결과 순서도 같음", async ({ page }) => {
  await page.goto("/search?life=senior");
  await page.locator("#s-sido").selectOption("41000");
  await page.locator("#s-sigungu").selectOption({ label: "용인시" });
  const names = () => page.locator(".prow h3").allInnerTexts();
  // 시·도 단위 결과가 아니라 고른 시·군·구 결과로 바뀐 뒤에 읽는다 (프로덕션에서 번들 받는 사이 읽어 개수가 달랐음)
  await expect(page.locator(".search-count")).toContainText("용인시", { timeout: 20_000 });
  const before = await names();
  const count = await page.locator(".search-count h2").innerText();
  expect(page.url()).not.toMatch(/41460|용인|sido|sigungu/);
  await page.reload();
  await expect(page.locator("#s-sigungu")).toHaveValue("41460", { timeout: 20_000 });
  await expect(page.locator(".search-count")).toContainText("용인시", { timeout: 20_000 });
  await expect(page.locator(".search-count h2")).toHaveText(count);
  expect(await names()).toEqual(before);
});

test("'91년생, 여자아이 2명, 남편외벌이, 월급 400만원' → 자녀 2명, 한부모 '아니요', 하는 일은 직장 아님 @mobile", async ({ page }) => {
  await page.goto("/situation?for=self&new=1&details=1");
  await expect(page.getByTestId("v2-text")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("v2-text").fill("91년생, 여자아이 2명, 남편외벌이, 월급 400만원");
  await page.getByTestId("v2-fill").click();
  await expect(page.getByTestId("v2-understood")).toContainText("자녀 2명");
  await expect(page.getByRole("group", { name: /자녀는 몇 명/ }).getByRole("radio", { name: "2명" })).toBeChecked();
  await expect(page.getByRole("group", { name: /한부모 가구인가요/ }).getByRole("radio", { name: "아니요" })).toBeChecked();
  await expect(page.getByRole("group", { name: /지금 하고 있는 일/ }).getByRole("radio", { name: "직장에 다녀요" })).not.toBeChecked();
});

test.describe("전국 확대 ③ 현재 위치로 내 지역 예시", () => {
  test("용인 위치 → '경기 용인시' 예시 5개, 받으실 수 있어요 많은 순, 누르면 그 지역 결과 @mobile", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 37.2411, longitude: 127.1776 });
    await page.goto("/");
    await page.getByTestId("locate-btn").click();
    await expect(page.getByTestId("locate-status")).toContainText("경기 용인시 기준", { timeout: 30_000 });
    const fits = await page.getByTestId("preset-fit").allInnerTexts();
    expect(fits).toHaveLength(5);
    const ns = fits.map((t) => Number(/(\d+)개/.exec(t)![1]));
    expect([...ns].sort((a, b) => b - a)).toEqual(ns);
    await page.getByTestId("preset-suwon-senior").click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("용인시", { timeout: 20_000 });
    await expect(page.getByTestId("example-banner")).toContainText("예시 결과");
    await expect(page.getByTestId("v2-chips")).toContainText("용인시");
  });
  test("위치 권한이 없으면 지역을 직접 고르기 — 서울 광진구", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("locate-btn").click();
    // 예시 칸이 보이면 자동으로 한 번 확인하므로(2026-10-16) 단추를 누른 결과와 자동 확인 결과 중 하나
    await expect(page.getByTestId("locate-status")).toContainText(/위치를 확인하지 못했어요|위치를 쓸 수 없어|위치 확인 불가/, { timeout: 20_000 });
    await page.locator("#pp-sido").selectOption("11000");
    await page.getByTestId("locate-sigungu").selectOption({ label: "광진구" });
    await expect(page.getByTestId("locate-status")).toContainText("서울 광진구 기준", { timeout: 30_000 });
    await expect(page.getByTestId("preset-goyang-youth")).toContainText("서울 광진구 구직 청년");
  });
});
