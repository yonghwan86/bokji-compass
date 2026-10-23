import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { detailBucket } from "../../src/lib/data/bucket";
import type { PaperAt, PaperIndexShard, PaperManifest, PaperSlot } from "../../src/lib/data/paperWritingTypes";

const FORM = "ordin-19969911";
const PROGRAM = "g41280.gov24-394000000111";
const WRITE_URL = `/forms/write/${FORM}?program=${PROGRAM}`;
const MANIFEST_URL = `/forms/writing/v1/manifest/${FORM}.json`;
const SOURCE_SHA = "a548bdb8209887a2dfa6dbc6f282501db749bcdd7a7fe31674a2cde7dfcab7f5";
const SAMPLES = "logs/hwp-writing-20261022/team3/paper-writing-samples";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const atKey = (at: PaperAt) => `${at.section}/${at.table ?? "b"}/${at.row}/${at.col}/${at.p}`;

// 실제 변환본의 cellAddr와 문단 순서를 읽어 고정한 의미 좌표다. 생성 중인 slot ID는 사용하지 않는다.
const NAME_AT: PaperAt = { section: 0, table: 0, row: 1, col: 4, p: 0 };
const DATE_AT: PaperAt = { section: 0, table: 0, row: 4, col: 0, p: 2 };
const RECIPIENT_AT: PaperAt = { section: 0, table: 0, row: 4, col: 0, p: 7 };

function publishedFixture() {
  // 최종 컴파일이 아직 안 됐으면 실패한다. 오래된 draft를 쓰거나 skip으로 성공시키지 않는다.
  expect(existsSync(`public${MANIFEST_URL}`), "최종 공개 매니페스트가 먼저 생성되어야 합니다").toBe(true);
  const bytes = readFileSync(`public${MANIFEST_URL}`);
  const manifest = JSON.parse(bytes.toString("utf8")) as PaperManifest;
  const index = JSON.parse(readFileSync(`public/forms/writing/v1/index/${detailBucket(FORM)}.json`, "utf8")) as PaperIndexShard;
  expect(manifest.formId).toBe(FORM);
  expect(index.forms[FORM].manifestSha256).toBe(hash(bytes));
  expect(index.forms[FORM].source).toEqual(manifest.source);
  expect(index.forms[FORM].asset).toEqual(manifest.asset);
  expect(manifest.source.format).toBe("hwp");
  expect(manifest.source.sha256).toBe(SOURCE_SHA);
  const source = readFileSync(`public${manifest.source.path}`);
  const asset = readFileSync(`public${manifest.asset.path}`);
  expect(source.length).toBe(manifest.source.bytes);
  expect(hash(source)).toBe(SOURCE_SHA);
  expect(hash(readFileSync(`pipeline/forms/originals/${FORM}.hwp`))).toBe(SOURCE_SHA);
  expect(asset.length).toBe(manifest.asset.bytes);
  expect(hash(asset)).toBe(manifest.asset.sha256);
  return { manifest, asset };
}

function slotAt(manifest: PaperManifest, at: PaperAt, token?: PaperSlot["token"]) {
  const matches = Object.values(manifest.slots).filter(slot =>
    atKey(slot.at) === atKey(at) && !slot.locked && slot.kind !== "check" && slot.token === token);
  expect(matches, `작성 가능한 원문 좌표 ${atKey(at)} ${token ?? ""}`).toHaveLength(1);
  return matches[0];
}

/** 작성기 XML 인덱서와 독립적으로 브라우저 DOMParser로 실제 내려받은 ZIP의 각 칸을 읽는다. */
async function sectionSnapshot(page: Page, xml: string, section: number) {
  return page.evaluate(({ xml, section }) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("HWPX XML parse error");
    const children = (node: Element, name: string) => Array.from(node.children).filter(child => child.localName === name);
    const closestParagraph = (node: Element): Element | null => {
      let parent = node.parentElement;
      while (parent && parent.localName !== "p") parent = parent.parentElement;
      return parent;
    };
    const text = (paragraph: Element) => Array.from(paragraph.getElementsByTagNameNS("*", "t"))
      .filter(node => closestParagraph(node) === paragraph).map(node => node.textContent ?? "").join("");
    const paragraphs: Record<string, string> = {};
    children(doc.documentElement, "p").forEach((paragraph, p) => { paragraphs[`${section}/b/0/0/${p}`] = text(paragraph); });
    const tables = Array.from(doc.getElementsByTagNameNS("*", "tbl"));
    tables.forEach((table, tableIndex) => {
      for (const row of children(table, "tr")) for (const cell of children(row, "tc")) {
        const addr = children(cell, "cellAddr")[0];
        const subList = children(cell, "subList")[0];
        if (!addr || !subList) throw new Error("HWPX cell has no address or paragraphs");
        children(subList, "p").forEach((paragraph, p) => {
          paragraphs[`${section}/${tableIndex}/${addr.getAttribute("rowAddr")}/${addr.getAttribute("colAddr")}/${p}`] = text(paragraph);
        });
      }
    });
    // 빈 run에 추가되는 hp:t를 제외한 모든 요소·속성: 표, 글꼴 참조, 여백, 문단 구성 보존.
    const structure = Array.from(doc.getElementsByTagName("*")).filter(node => node.localName !== "t")
      .map(node => [node.tagName, Array.from(node.attributes).map(attr => [attr.name, attr.value])]);
    return { paragraphs, structure, tableCount: tables.length, paragraphCount: doc.getElementsByTagNameNS("*", "p").length };
  }, { xml, section });
}

async function storageSnapshot(page: Page) {
  return page.evaluate(() => ({
    local: Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])),
    session: Object.fromEntries(Object.keys(sessionStorage).sort().map(key => [key, sessionStorage.getItem(key)])),
  }));
}

async function expectBlocked(page: Page, reason: RegExp) {
  await expect(page.locator("main").getByRole("status")).toContainText(reason);
  await expect(page.getByTestId("paper-writer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /내려받기.*HWPX/ })).toHaveCount(0);
}

test("장수축하금 HWP 원본을 유지하고 입력한 칸만 HWPX로 내려받는다 @mobile", async ({ page }, info) => {
  const { manifest, asset } = publishedFixture();
  const name = slotAt(manifest, NAME_AT);
  expect(name.kind).toBe("text");
  const inputs = [
    { slot: name, value: "홍길동" }, // 실제 개인정보가 아닌 가상 입력
    ...(["년", "월", "일"] as const).map((token, i) => ({ slot: slotAt(manifest, DATE_AT, token), value: ["2026", "10", "23"][i] })),
  ];
  await page.goto(`/p/${PROGRAM}`);
  const panel = page.getByTestId("application-forms");
  const writerLink = panel.locator(`a[href="${WRITE_URL}"]`);
  await expect(writerLink).toBeVisible();
  await expect(writerLink).toHaveAttribute("data-testid", "paper-writer-link");
  const originalLink = panel.locator(`a[download][href="${manifest.source.path}"]`);
  await expect(originalLink).toBeVisible();
  const originalDownload = page.waitForEvent("download");
  await originalLink.click();
  const original = await originalDownload;
  mkdirSync(SAMPLES, { recursive: true });
  const sourceFile = `${SAMPLES}/${info.project.name}-${FORM}-source.hwp`;
  await original.saveAs(sourceFile);
  expect(original.suggestedFilename()).toMatch(/\.hwp$/i);
  expect(hash(readFileSync(sourceFile))).toBe(SOURCE_SHA);
  await writerLink.click();
  await expect(page.getByTestId("paper-writer")).toBeVisible();
  await expect(page.getByTestId("paper-source-download")).toHaveAttribute("href", manifest.source.path);
  await expect(page.getByTestId("paper-converted-notice")).toBeVisible();

  const storedBefore = await storageSnapshot(page);
  const urlBefore = page.url();
  const privacyViolations: string[] = [];
  const sensitive = ["홍길동", "2026-10-23", "2026년10월23일"];
  page.on("request", request => {
    const url = new URL(request.url());
    const payload = `${request.url()} ${request.postData() ?? ""}`;
    if (sensitive.some(value => payload.includes(value) || payload.includes(encodeURIComponent(value)))) privacyViolations.push("input_in_request");
    if ([...url.searchParams.values()].some(value => inputs.some(input => input.value === value))) privacyViolations.push("input_in_query");
    if (!["GET", "HEAD"].includes(request.method())) privacyViolations.push("write_request_after_input");
  });
  for (const input of inputs) await page.getByTestId(`paper-input-${input.slot.id}`).fill(input.value);
  // 서명·행정정보 동의·기관용 칸은 자동으로 채우지 않는다.
  for (const slot of Object.values(manifest.slots).filter(slot => slot.locked)) {
    await expect(page.getByTestId(`paper-input-${slot.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`paper-check-${slot.id}`)).toHaveCount(0);
  }
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /내려받기.*HWPX/ }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/_작성본\.hwpx$/);
  const file = `${SAMPLES}/${info.project.name}-${FORM}-filled.hwpx`;
  await download.saveAs(file);
  const filled = readFileSync(file);
  const before = unzipSync(asset), after = unzipSync(filled);
  expect(strFromU8(after.mimetype)).toBe("application/hwp+zip");
  expect(hash(filled)).not.toBe(manifest.asset.sha256);
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).filter(path => !manifest.preview.dropEntries.includes(path)).sort());
  for (const [path, bytes] of Object.entries(before)) {
    if (/^Contents\/section\d+\.xml$/.test(path) || path === manifest.preview.textEntry || manifest.preview.dropEntries.includes(path)) continue;
    expect(after[path], `원래 리소스 ${path}`).toEqual(bytes);
  }
  for (const section of manifest.sections) {
    const number = Number(section.name.match(/section(\d+)\.xml$/)![1]);
    const old = await sectionSnapshot(page, strFromU8(before[section.name]), number);
    const next = await sectionSnapshot(page, strFromU8(after[section.name]), number);
    expect(next.tableCount).toBe(section.tableCount);
    expect(next.paragraphCount).toBe(section.paragraphCount);
    expect(next.structure).toEqual(old.structure);
    const expected = { ...old.paragraphs };
    if (number === 0) {
      expect(old.paragraphs[atKey(NAME_AT)]).toBe("");
      expect(old.paragraphs[atKey(DATE_AT)].replace(/\s/g, "")).toBe("년월일");
      expect(next.paragraphs[atKey(NAME_AT)]).toBe("홍길동");
      expect(next.paragraphs[atKey(DATE_AT)].replace(/\s/g, "")).toBe("2026년10월23일");
      expected[atKey(NAME_AT)] = "홍길동";
      expected[atKey(DATE_AT)] = next.paragraphs[atKey(DATE_AT)];
      // 수신자는 빈칸이 아니라 고정 인쇄 문구다. 이름·날짜 입력으로 바뀌면 안 된다.
      expect(next.paragraphs[atKey(RECIPIENT_AT)].replace(/\s/g, "")).toBe("고양시장귀하");
      expect(old.paragraphs["0/0/4/0/0"]).toContain("제6조에 따라");
      expect(old.paragraphs["0/0/9/0/0"]).toContain("「전자정부법」 제36조제1항");
      expect(old.paragraphs["0/0/9/0/1"]).toContain("동의하지 않는 경우");
    }
    // 입력한 두 문단 외 법률·동의·서명·위임장·빈 문단 모두 정확히 보존한다.
    expect(next.paragraphs).toEqual(expected);
  }
  expect(strFromU8(after[manifest.preview.textEntry])).toContain("홍길동");
  expect(hash(readFileSync(`public${manifest.source.path}`))).toBe(SOURCE_SHA);
  expect(hash(readFileSync(`pipeline/forms/originals/${FORM}.hwp`))).toBe(SOURCE_SHA);
  expect(hash(readFileSync(`public${manifest.asset.path}`))).toBe(manifest.asset.sha256);
  expect(privacyViolations).toEqual([]);
  expect(await storageSnapshot(page)).toEqual(storedBefore);
  expect(page.url()).toBe(urlBefore);
  await page.reload();
  await expect(page.getByTestId("paper-writer")).toBeVisible();
  for (const input of inputs) await expect(page.getByTestId(`paper-input-${input.slot.id}`)).toHaveValue("");
  expect(privacyViolations).toEqual([]);
  await page.getByTestId(`paper-input-${name.id}`).fill("홍길동");
  await page.getByRole("link", { name: /상세로 돌아가기/ }).click();
  await expect(page.getByTestId("application-forms")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("paper-writer")).toBeVisible();
  await expect(page.getByTestId(`paper-input-${name.id}`)).toHaveValue("");
});

test("HWP 작성기는 연결되지 않은 사업을 차단한다 @mobile", async ({ page }) => {
  await page.goto(`/forms/write/${FORM}?program=n.welfare100-livelihood-benefit`);
  await expectBlocked(page, /연결된 신청서가 아니/);
});

test("세로 입력과 원본 보기 사이에 값이 유지되고 큰 글씨에서도 입력칸이 잘리지 않는다 @mobile", async ({ page }) => {
  const { manifest } = publishedFixture();
  const name = slotAt(manifest, NAME_AT);
  await page.goto(WRITE_URL);
  const fields = page.getByTestId("paper-fields");
  await expect(fields).toBeVisible();
  await page.getByTestId(`paper-input-${name.id}`).fill("홍길동");
  await page.getByRole("button", { name: "원본 양식으로 보기", exact: true }).click();
  await expect(page.getByTestId("paper-sheet")).toBeVisible();
  await expect(page.getByTestId(`paper-input-${name.id}`)).toHaveValue("홍길동");
  await expect(page.getByText("좁은 화면에서는 양식을 좌우로 밀어", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "세로로 입력하기", exact: true }).click();
  await expect(fields).toBeVisible();
  await expect(page.getByTestId(`paper-input-${name.id}`)).toHaveValue("홍길동");
  await page.getByTestId("large-text").click();
  const bounds = await fields.locator("input").evaluateAll(inputs => inputs.map(input => {
    const rect = input.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth };
  }));
  expect(bounds.length).toBeGreaterThan(0);
  for (const rect of bounds) { expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(rect.viewport + 1); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("HWP 작성기는 사업이 없는 주소를 차단한다 @mobile", async ({ page }) => {
  await page.goto(`/forms/write/${FORM}`);
  await expectBlocked(page, /어떤 복지 서비스의 신청서인지 확인할 수 없/);
});

test("공개 인덱스와 SHA가 다른 매니페스트로 작성하지 못한다 @mobile", async ({ page }) => {
  publishedFixture();
  let intercepted = false;
  await page.route(`**${MANIFEST_URL}`, async route => {
    const response = await route.fetch();
    const manifest = await response.json() as PaperManifest;
    intercepted = true;
    await route.fulfill({ response, json: { ...manifest, title: `${manifest.title} 변조` } });
  });
  await page.goto(WRITE_URL);
  await expectBlocked(page, /아직 화면에서 작성할 수 없|서식 정보를 불러오지 못/);
  expect(intercepted).toBe(true);
});

test("원본의 공백 두 칸짜리 실제 입력 셀도 작성해 내려받을 수 있다 @mobile", async ({ page }, info) => {
  const id = "ordin-20088657", program = "g48250.gov24-535000000607";
  const manifest = JSON.parse(readFileSync(`public/forms/writing/v1/manifest/${id}.json`, "utf8")) as PaperManifest;
  const slot = Object.values(manifest.slots).find(item => item.kind === "text" && item.expect === "  " && !item.locked)!;
  expect(slot).toBeDefined();
  await page.goto(`/forms/write/${id}?program=${program}`);
  await expect(page.getByTestId("paper-writer")).toBeVisible();
  await page.getByTestId(`paper-input-${slot.id}`).fill("가");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: /내려받기.*HWPX/ }).first().click();
  const file = `${SAMPLES}/${info.project.name}-${id}-filled.hwpx`;
  mkdirSync(SAMPLES, { recursive: true });
  await (await event).saveAs(file);
  const files = unzipSync(readFileSync(file));
  const snapshot = await sectionSnapshot(page, strFromU8(files[`Contents/section${slot.at.section}.xml`]), slot.at.section);
  expect(snapshot.paragraphs[atKey(slot.at)]).toBe("가");
  expect(hash(readFileSync(`public${manifest.source.path}`))).toBe(manifest.source.sha256);
});

test("크기가 같아도 SHA가 다른 작성용 파일은 다운로드를 차단한다 @mobile", async ({ page }) => {
  const { manifest, asset } = publishedFixture();
  const damaged = Buffer.from(asset);
  damaged[damaged.length - 1] ^= 1;
  expect(damaged.length).toBe(manifest.asset.bytes);
  expect(hash(damaged)).not.toBe(manifest.asset.sha256);
  let intercepted = false;
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  await page.route(`**${manifest.asset.path}`, async route => {
    intercepted = true;
    await route.fulfill({ status: 200, contentType: "application/hwp+zip", body: damaged });
  });
  await page.goto(WRITE_URL);
  await expect(page.getByTestId("paper-writer")).toBeVisible();
  const button = page.getByRole("button", { name: /내려받기.*HWPX/ }).first();
  await button.click();
  await expect(page.getByTestId("paper-writer").getByRole("alert")).toContainText(/등록된 변환본과 다릅니다/);
  await expect(button).toBeEnabled();
  expect(intercepted).toBe(true);
  expect(downloads).toBe(0);
  expect(hash(readFileSync(`public${manifest.source.path}`))).toBe(SOURCE_SHA);
});
