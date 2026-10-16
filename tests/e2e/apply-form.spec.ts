/** (2026-10-16 회의: 신청서 자동 채우기) 준비물 한 장 — 주민센터 장에 공통 신청서에서 체크할 칸 */
import { expect, test, type Page } from "@playwright/test";

async function toResults(page: Page, sentence: string) {
  await page.goto("/");
  await page.locator("#home-q").fill(sentence);
  await page.locator("#home-q").press("Enter");
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("pick").first()).toBeVisible({ timeout: 20_000 });
}

test("8개월 아기 엄마: 주민센터 장에 「사회보장급여 신청(변경)서」 체크 칸, 개인정보는 적지 않음 @mobile", async ({ page }) => {
  await toResults(page, "용인 사는 8개월 아기 엄마예요");
  await page.getByTestId("sheet-open").click();
  const sheet = page.getByTestId("visit-sheet");
  const center = sheet.getByTestId("vs-place").filter({ hasText: "주소지 행정복지센터(주민센터)에 가져갈 한 장" });
  await expect(center).toHaveCount(1, { timeout: 20_000 });
  const form = center.getByTestId("vs-form");
  await expect(form).toContainText("사회보장급여 신청(변경)서");
  await expect(form).toContainText("별지 제1호서식");
  await expect(form).toContainText(/영유아 · 부모급여\(현금\)|아동수당 · 아동수당/);
  await expect(form).toContainText("창구에서 직접 적어요");
  await expect(form).not.toContainText(/\d{6}-\d/);
});
