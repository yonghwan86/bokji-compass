import { expect, test } from "@playwright/test";

test("홈 바닥글에서 자료 출처로 이동하고 건수·한계가 보인다 @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "자료 출처 23,578건" }).click();
  await expect(page).toHaveURL(/\/about#sources$/);
  const sources = page.locator("#sources");
  await expect(sources).toBeVisible();
  await expect(sources.getByRole("heading", { name: "어디서 모았나" })).toBeVisible();
  await expect(sources).toContainText("23,578");
  await expect(sources).toContainText("23,575");
  await expect(sources).toContainText("9,336건");
  await expect(sources).toContainText("5,232건");
  await expect(sources).toContainText("10,218건");
  await expect(sources).toContainText("24,889");
  await expect(sources).toContainText("1,263");
  await expect(sources).toContainText("총 복지 수가 아닙니다");
  await expect(sources).toContainText("2,844개");
  await expect(sources).toContainText("2,564건");
  await expect(sources).toContainText("개별 원문 주소가 비어");
  await expect(sources).toContainText("23,528");
  await expect(sources).toContainText("50건");
  await expect(sources).toContainText("자료에 기록된 수집일");
  await expect(sources).toContainText("목록 캐시");
  await expect(sources).toContainText("연도만 기록된 기준값 461개");
  await expect(sources).not.toContainText("최종수정일이 없는 출처 표기 461건");
  await expect(sources).toContainText("2,359");
  await expect(sources).toContainText("공식 API가 아닙니다");
  await expect(sources).not.toContainText("전국 모든 복지 수집완료");

  const gov24 = sources.getByRole("link", { name: /정부24 혜택 원문/ });
  await expect(gov24).toHaveAttribute("href", "https://www.gov.kr/portal/rcvfvrSvc/main");
  await expect(sources.getByRole("link", { name: /정부24 API/ })).toHaveAttribute("href", "https://www.data.go.kr/data/15113968/openapi.do");
  await expect(sources.getByRole("link", { name: /복지로 중앙부처 API/ })).toHaveAttribute("href", "https://www.data.go.kr/data/15090532/openapi.do");
  await expect(sources.getByRole("link", { name: /복지로 지자체 API/ })).toHaveAttribute("href", "https://www.data.go.kr/data/15108347/openapi.do");
  await expect(sources.getByRole("link", { name: /통합돌봄 메뉴판 목록/ })).toHaveAttribute("href", "https://www.mohw.go.kr/menu.es?mid=a60600000000");
  await expect(sources.getByRole("link", { name: /수원시 어르신 교통비 지원/ })).toHaveAttribute("href", "https://www.suwon.go.kr/sw-www/saebitinfo/saebitinfo-01.jsp");
  expect(await sources.innerHTML()).not.toMatch(/serviceKey|DATA_GO_KR_SERVICE_KEY|javascript:/);

  await expect(page.locator("#privacy")).toContainText("개인정보 원칙");
  await expect(page.locator("#credits")).toBeVisible();
  await expect(page.getByRole("link", { name: "vuski/admdongkor" })).toBeVisible();

  await page.getByTestId("large-text").click();
  await expect(sources.getByRole("heading", { name: "어디서 모았나" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
