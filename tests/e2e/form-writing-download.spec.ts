import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";

/** 화면에서 작성한 내용이 실제 한글 파일의 그 칸에 들어가는지, 받은 파일로 확인한다. */
const SAMPLES = "logs/forms-completion/hwpx-writer/samples";

const cases = [
  {
    name: "사회보장급여 신청(변경)서",
    program: "n.welfare100-livelihood-benefit",
    form: "rule-3211495",
    sha256: "05a5fb88ab3199783d66d5fc77af32f425c07ba34552203d9ca4a2546e3bc1be",
    file: "사회보장급여 신청(변경)서_작성본.hwpx",
    fields: [
      { label: "성명", value: "홍길동" },
      { label: "주민등록번호 (외국인등록번호 전산관리번호)", value: "000000-0000000" },
      { label: "전화번호", value: "010-0000-0000" },
      { label: "주소", value: "서울특별시 종로구 세종대로 000" },
    ],
    expectInFile: ["홍길동", "000000-0000000", "서울특별시 종로구 세종대로 000"],
  },
  {
    name: "사회보장급여(사회서비스이용권) 신청(변경)서",
    program: "n.gov24-VOU000000020",
    form: "rule-3211501",
    sha256: "f922a89ff89c09bfb6325d493d03104bdc23c123fc1c4b469bfc77bb1597bde1",
    file: "사회보장급여(사회서비스이용권) 신청(변경)서_작성본.hwpx",
    fields: [
      { label: "성명", value: "홍길동" },
      { label: "주민등록번호 (외국인등록번호 전산관리번호)", value: "000000-0000000" },
      { label: "전화번호", value: "010-0000-0000" },
      { label: "주소", value: "서울특별시 종로구 세종대로 000" },
    ],
    expectInFile: ["홍길동", "000000-0000000", "서울특별시 종로구 세종대로 000"],
  },
];

for (const sample of cases) {
  test(`${sample.name} — 화면에서 작성해 실제 파일로 받는다 @mobile`, async ({ page }, info) => {
    const carried: string[] = [];
    const privateValues = sample.fields.map(field => field.value);
    page.on("request", request => {
      const payload = `${request.url()} ${request.postData() ?? ""}`;
      if (privateValues.some(word => payload.includes(word) || payload.includes(encodeURIComponent(word)))) carried.push(payload);
    });

    await page.goto(`/p/${sample.program}`);
    const panel = page.getByTestId("application-forms");
    await expect(panel).toBeVisible();
    const writerLink = panel.locator(`a[href="/forms/write/${sample.form}?program=${sample.program}"]`);
    await expect(writerLink).toHaveText("화면에서 작성하기");
    await writerLink.click();

    await expect(page.getByRole("heading", { level: 1, name: sample.name })).toBeVisible();
    await expect(page.getByText("적은 내용은 이 기기 안에서만 처리하고", { exact: false })).toBeVisible();
    // 첫 단계가 뜨기 전까지는 사업–서식 연결을 확인하는 중이다.
    await expect(page.getByTestId("writer-step")).toContainText("신청인");

    for (const field of sample.fields) await page.getByLabel(field.label, { exact: false }).first().fill(field.value);

    for (let step = 0; step < 12; step += 1) {
      const next = page.getByRole("button", { name: /다음|마지막 확인으로/ });
      if (!(await next.count())) break;
      await next.click();
      if (await page.getByRole("heading", { name: "적은 내용 확인하기" }).count()) break;
    }
    await expect(page.getByRole("heading", { name: "적은 내용 확인하기" })).toBeVisible();
    await expect(page.getByText("홍길동").first()).toBeVisible();
    await expect(page.getByText("파일을 받은 뒤 직접 해야 하는 것")).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /작성한 신청서 내려받기/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(sample.file);

    mkdirSync(SAMPLES, { recursive: true });
    const saved = `${SAMPLES}/${info.project.name}-${sample.form}.hwpx`;
    await file.saveAs(saved);

    const bytes = new Uint8Array(readFileSync(saved));
    const files = unzipSync(bytes);
    expect(strFromU8(files["mimetype"])).toBe("application/hwp+zip");
    const body = strFromU8(files["Contents/section0.xml"]);
    for (const word of sample.expectInFile) expect(body).toContain(word);
    expect(strFromU8(files["Preview/PrvText.txt"])).toContain("홍길동");

    // 원본 파일은 그대로고, 적은 값은 어떤 요청에도 실리지 않는다.
    const originalHash = createHash("sha256").update(readFileSync(`pipeline/forms/originals/${sample.form}.hwpx`)).digest("hex");
    expect(sample.sha256).toBe(originalHash);
    expect(createHash("sha256").update(bytes).digest("hex")).not.toBe(originalHash);
    expect(carried).toEqual([]);

    // 적은 값은 브라우저 저장소에도 남지 않고, 새로고침하면 처음 화면으로 돌아간다.
    const stored = await page.evaluate(() => [
      ...Object.keys(localStorage).map(key => `${key}=${localStorage.getItem(key)}`),
      ...Object.keys(sessionStorage).map(key => `${key}=${sessionStorage.getItem(key)}`),
    ].join("\n"));
    for (const word of privateValues) expect(stored).not.toContain(word);
    for (const word of privateValues) { expect(page.url()).not.toContain(word); expect(page.url()).not.toContain(encodeURIComponent(word)); }
    await page.reload();
    await expect(page.getByTestId("writer-step")).toContainText("신청인");
    await expect(page.getByLabel("성명", { exact: false }).first()).toHaveValue("");
  });
}

test("연결되지 않은 사업으로는 작성 화면이 열리지 않는다 @mobile", async ({ page }) => {
  await page.goto("/forms/write/rule-3211501?program=n.welfare100-livelihood-benefit");
  await expect(page.getByText("이 서비스에 연결된 신청서가 아니에요", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /내려받기/ })).toHaveCount(0);
});

test("사업을 지정하지 않으면 작성 화면이 열리지 않는다 @mobile", async ({ page }) => {
  await page.goto("/forms/write/rule-3211495");
  await expect(page.getByText("어떤 복지 서비스의 신청서인지 확인할 수 없어요", { exact: false })).toBeVisible();
});

test("등록되지 않은 서식 주소는 404다 @mobile", async ({ page }) => {
  for (const id of ["ordin-99999999999999999999", "%25"]) {
    const response = await page.goto(`/forms/write/${id}`);
    expect(response?.status()).toBe(404);
  }
});

async function advanceToChoice(page: Page, key: string) {
  await expect(page.getByTestId("writer-step")).toBeVisible();
  for (let step = 0; step < 12; step += 1) {
    if (await page.getByTestId(`writer-check-${key}`).isVisible()) return;
    await page.getByRole("button", { name: /^(다음|마지막 확인으로)$/ }).click();
  }
  throw new Error(`선택 항목을 찾을 수 없음: ${key}`);
}

test("휴대전화 할인 취소 후 가구원 입력은 지워진다 @mobile", async ({ page }) => {
  await page.goto("/forms/write/rule-3211495?program=n.welfare100-livelihood-benefit");
  await advanceToChoice(page, "d.mobile");
  const mobile = page.getByTestId("writer-check-d.mobile");
  const name = page.locator('[id="f-disc0.name"]');
  await expect(name).toHaveCount(0);
  await mobile.check();
  await name.fill("홍길순");
  await page.getByTestId("writer-check-disc0.carrier0").check();
  await mobile.uncheck();
  await expect(name).toHaveCount(0);
  await mobile.check();
  await expect(name).toHaveValue("");
  await expect(page.getByTestId("writer-check-disc0.carrier0")).not.toBeChecked();
});

test("카드사를 바꾸면 다른 카드의 은행명은 남지 않는다 @mobile", async ({ page }) => {
  await page.goto("/forms/write/rule-3211501?program=n.gov24-VOU000000020");
  await advanceToChoice(page, "s.firstMeet");
  await page.getByTestId("writer-check-s.firstMeet").check();
  await page.getByTestId("writer-check-fm.card1").check();
  const bc = page.locator('[id="f-fm.bcBank"]'), kb = page.locator('[id="f-fm.kbBank"]');
  await bc.fill("가나");
  await expect(kb).toHaveCount(0);
  await page.getByTestId("writer-check-fm.card4").check();
  await expect(bc).toHaveCount(0);
  await kb.fill("다라");
  await page.getByTestId("writer-check-fm.card1").check();
  await expect(bc).toHaveValue("");
  await expect(kb).toHaveCount(0);
});
