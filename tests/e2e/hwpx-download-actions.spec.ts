import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// 생성기(scripts/build-hwpx-downloads.ts)를 돌린 뒤 도는 검사다. 기대값은 공개 자료에서
// 그대로 읽은 정적 값이고, 화면이 보여 준 값을 기대값으로 쓰지 않는다.
const PUBLIC = path.join(process.cwd(), "public");
const read = (file: string) => JSON.parse(readFileSync(path.join(PUBLIC, file), "utf-8"));
const conversions = read("forms/writing/v1/conversions.json").forms as Record<string, { source: { sha256: string; bytes: number }; asset: { path: string; bytes: number; sha256: string } }>;
const catalog = read("forms/v1/catalog.json").forms as Record<string, { file?: { hwp: string; format?: string; sha256: string } }>;

/** 그 사업 화면에서 실제로 쓰이는 조합 하나: 공개 원본이 이 변환의 바로 그 원본인 서식. */
function sampleFor(formId: string) {
  const conversion = conversions[formId], file = catalog[formId]?.file;
  if (!conversion || !file) throw new Error(`no published conversion: ${formId}`);
  return { conversion, file };
}

const WRITABLE = { program: "g11110.gov24-300000000119", form: "ordin-22073447" };
// 화면 입력을 지원하지 않지만 변환본은 검증된 서식.
const UNSUPPORTED = { program: "g11110.gov24-300000000111", form: "ordin-17178595" };

test("검증된 변환본을 HWPX로 바로 받을 수 있고 원본 HWP도 그대로 남는다 @mobile", async ({ page }) => {
  const { conversion, file } = sampleFor(WRITABLE.form);
  await page.goto(`/p/${WRITABLE.program}`);
  const panel = page.getByTestId("application-forms");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("status")).toHaveCount(0);

  const hwpx = panel.locator(`a[data-testid="hwpx-download-link"][href="${conversion.asset.path}"]`);
  await expect(hwpx).toHaveCount(1);
  await expect(hwpx).toContainText("HWPX로 받기");
  await expect(hwpx).toHaveAttribute("download", /\.hwpx$/);
  // 공식 원본(HWP) 받기가 사라지지 않는다.
  await expect(panel.locator(`a[download][href="${file.hwp}"]`)).toHaveCount(1);
  await expect(panel).toContainText("한글 원본(HWP)");
});

test("HWPX 주소가 실제 변환본 바이트를 그대로 내려 준다", async ({ request }) => {
  const { conversion } = sampleFor(WRITABLE.form);
  const response = await request.get(conversion.asset.path);
  expect(response.status()).toBe(200);
  const body = await response.body();
  expect(body.byteLength).toBe(conversion.asset.bytes);
  expect(createHash("sha256").update(body).digest("hex")).toBe(conversion.asset.sha256);
});

test("한 카드가 전체 변환 목록을 받지 않고 해당 샤드만 받는다 @mobile", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/forms/writing/v1/")) asked.push(url.pathname);
  });
  await page.goto(`/p/${WRITABLE.program}`);
  await expect(page.getByTestId("application-forms").getByRole("status")).toHaveCount(0);
  await expect(page.getByTestId("application-forms").getByTestId("hwpx-download-link").first()).toBeVisible();
  expect(asked).not.toContain("/forms/writing/v1/conversions.json");
  const shards = asked.filter(name => /^\/forms\/writing\/v1\/downloads\/[0-9a-f]{2}\.json$/.test(name));
  expect(shards.length).toBeGreaterThan(0);
  expect(shards.length).toBeLessThanOrEqual(8);
});

test("입력을 지원하지 않는 변환본에도 HWPX 받기가 나오고 작성 버튼은 나오지 않는다 @mobile", async ({ page }) => {
  const writableIds: string[] = read("forms/writing/v1/index.json").formIds;
  expect(writableIds).not.toContain(UNSUPPORTED.form);
  const { conversion, file } = sampleFor(UNSUPPORTED.form);
  await page.goto(`/p/${UNSUPPORTED.program}`);
  const panel = page.getByTestId("application-forms");
  await expect(panel.getByRole("status")).toHaveCount(0);
  const card = panel.locator(`a[download][href="${file.hwp}"]`).locator("xpath=ancestor::li[1]");
  await expect(card).toHaveCount(1);
  await expect(card.locator(`a[data-testid="hwpx-download-link"][href="${conversion.asset.path}"]`)).toHaveCount(1);
  // 받을 수 있다고 해서 입력까지 되는 것처럼 보이면 안 된다.
  await expect(card.getByTestId("paper-writer-link")).toHaveCount(0);
  await expect(card.getByTestId("form-writer-link")).toHaveCount(0);
  await expect(card.getByRole("link", { name: /화면에서 작성/ })).toHaveCount(0);
});
