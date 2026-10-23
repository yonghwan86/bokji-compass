import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const samples = [
  { program: "g31710.gov24-373000000110", form: "rule-3211501", sha: "f922a89ff89c09bfb6325d493d03104bdc23c123fc1c4b469bfc77bb1597bde1", bytes: 41935,
    text: "초기 신청", writer: true },
  { program: "s27000.bokjiro-WLF00004976", form: "agency-27000-daegu-school-entry-2026", sha: "36dd742e2060d64f989ed3f4d4cda54e3da6f76e94d4fe7d3eaffdd86a9cfb2b", bytes: 84715,
    text: "접수는 2026.8.24~9.30에 종료", writer: false },
  { program: "g41550.gov24-408000000534", form: "ordin-22068451", sha: "ed03e451dbca6bac746c041270a8d9570c68492b39ab1c829496691b0b1d3f5c", bytes: 47777,
    text: "제공기관", writer: false },
  { program: "g51820.icare-0083-1489636-1-2-10", form: "ordin-22484269", sha: "c4d28777502093cd37baa083bc1cf02cf71a9500fa08d596d4ce1b7b711c396e", bytes: 49076,
    text: "주민이 희망택시 바우처카드를 처음 신청하는 양식은 별지1", writer: false },
  { program: "g12830.bokjiro-WLF00002311", form: "ordin-22537305", sha: "67f7962c7cdf4da0f22268b7e4eec05a0b54d29d9d42640d432fe280f731e440", bytes: 30636,
    text: "이·미용", writer: false },
  { program: "g12720.gov24-486000000126", form: "ordin-22742385", sha: "f7cb5887ede17237d282f705091315b92ab3fdfcee3528526ccf7f456c603795", bytes: 26975,
    text: "중요재산", writer: false },
  { program: "g11680.gov24-322000000108", form: "ordin-13620757", sha: "db70d822483995fc3c673a333579dab9514764a86cbc939cae5410e6ffc89bc0", bytes: 89002,
    text: "비뇨의학과", writer: false },
  { program: "g44200.gov24-452000000340", form: "ordin-21494683", sha: "f7b6b6e2bbcdeb0d116fec1894c50c26f6a74fc4f24ec45bb0ac4c72c1e87b43", bytes: 54694,
    text: "치과", writer: false },
  { program: "g47750.bokjiro-WLF00003661", form: "ordin-20017903", sha: "5882b9f13617e5e84d676f30ada6973568f13c940c1b20058dc1361c3221c5bd", bytes: 37740,
    text: "협약", writer: false },
  ...["g43720.bokjiro-WLF00003867", "g43720.gov24-442000000126"].map(program => ({
    program, form: "agency-43720-notice1415-current-application", sha: "fc9f3c06dd962a1c7a41845041b490c4cccba34abac282874068b60c111845fd", bytes: 58188,
    text: "2027", writer: false,
  })),
];

for (const sample of samples) test(`HWPX rematching ${sample.form} for ${sample.program} exact download and usage @mobile`, async ({ page }) => {
  await page.goto(`/p/${sample.program}`);
  const panel = page.getByTestId("application-forms");
  const button = panel.locator(`a[download][href="/forms/files/${sample.form}-${sample.sha.slice(0, 12)}.hwpx"]`);
  await expect(button).toBeVisible();
  const card = button.locator("xpath=ancestor::li[1]");
  await expect(card).toContainText(sample.text);
  await expect(card.locator('a[href^="/forms/write/"]')).toHaveCount(sample.writer ? 1 : 0);
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const path = await download.path(); expect(path).toBeTruthy();
  const bytes = readFileSync(path!);
  expect(bytes.length).toBe(sample.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(sample.sha);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Ulju reuses the existing common HWPX writer with its exact programme connection @mobile", async ({ page }, info) => {
  const sample = samples[0];
  const privateValue = "가상신청인";
  const carried: string[] = [];
  page.on("request", request => {
    const payload = request.url() + (request.postData() ?? "");
    if (payload.includes(privateValue) || payload.includes(encodeURIComponent(privateValue))) carried.push(payload);
  });
  await page.goto(`/forms/write/${sample.form}?program=${sample.program}`);
  await expect(page.getByTestId("writer-step")).toContainText("신청인");
  await page.getByLabel("성명", { exact: false }).first().fill(privateValue);
  let maternalSelected = false;
  for (let step = 0; step < 12; step += 1) {
    const maternal = page.getByRole("checkbox", { name: /산모.*신생아.*건강관리/ });
    if (await maternal.count()) { await maternal.first().check(); maternalSelected = true; }
    const next = page.getByRole("button", { name: /다음|마지막 확인으로/ });
    if (!(await next.count())) break;
    await next.click();
    if (await page.getByRole("heading", { name: "적은 내용 확인하기" }).count()) break;
  }
  await expect(page.getByRole("heading", { name: "적은 내용 확인하기" })).toBeVisible();
  expect(maternalSelected).toBe(true);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /작성한 신청서 내려받기/ }).click()]);
  const directory = "logs/hwpx-rematch-20261023/root/filled"; mkdirSync(directory, { recursive: true });
  const target = `${directory}/${info.project.name}-${sample.form}.hwpx`; await download.saveAs(target);
  const filled = unzipSync(readFileSync(target));
  const xml = strFromU8(filled["Contents/section0.xml"]);
  expect(xml).toContain(privateValue);
  expect(xml.replace(/<[^>]*>/g, "")).toMatch(/\[√ *\]산모신생아건강관리지원/);
  expect(carried).toEqual([]);
  expect(createHash("sha256").update(readFileSync(`public/forms/files/${sample.form}-${sample.sha.slice(0, 12)}.hwpx`)).digest("hex")).toBe(sample.sha);
});
