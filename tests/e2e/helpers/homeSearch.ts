import { expect, type Page } from "@playwright/test";

/** 홈의 실제 검색 펼치기 동작을 거친 뒤 기존 입력 흐름을 이어 간다. */
export async function openHomeSearch(page: Page) {
  const disclosure = page.locator("details").filter({ has: page.locator("#home-q") });
  await expect(disclosure).toHaveCount(1);
  if (await disclosure.getAttribute("open") === null) {
    await disclosure.getByText("혜택 이름으로 검색", { exact: true }).click();
  }
  await expect(page.locator("#home-q")).toBeVisible();
}
