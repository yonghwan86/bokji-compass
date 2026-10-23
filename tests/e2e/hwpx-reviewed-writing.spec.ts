import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const samples = [
  { form: "agency-47230-health-kit-080701", program: "g47230.bokjiro-WLF00004929", source: "f1e5886e5e39ead2ffe928b62b24b32607a52af14a0bf2f5cdafa65966329005",
    values: { "0/0/1/2/0": "가상인", "0/0/3/2/0": "가상시 가상로 1", "0/0/5/0/5#i0": "2026", "0/0/5/0/5#i61": "10", "0/0/5/0/5#i70": "23" } },
  { form: "ordin-14971213", program: "g48310.gov24-537000000112", source: "24a70637f0c591a6961adc49be754431d2be80f772bd4266e76e386d6fe25627",
    values: { "0/0/1/1/0": "가상인", "0/0/2/1/0": "가상시 가상로 1", "0/0/8/0/1#p0": "2026", "0/0/8/0/1#i1": "10", "0/0/8/0/1#i7": "23" } },
  { form: "ordin-22522839", program: "s50000.gov24-650000000327", source: "c8b144b5944bf65c23244411f11b4dc9e844ee2fa73bb38c46bb9a45e0b0329f",
    values: { "0/0/5/8/0": "가상인", "0/0/10/8/0": "계좌변경", "0/0/11/0/3#p0": "2026", "0/0/11/0/3#i1": "10", "0/0/11/0/3#i10": "23" } },
  { form: "agency-41250-bok-20260617UUWBM1624260197448245-1", program: "g41250.bokjiro-WLF00006421", source: "8cd90bca5d9c8dcbf2c9c59128cbc5f064923479ee7e11814bef36dde84a61e4",
    values: { "0/0/0/2/0": "가상인", "0/0/1/2/0": "가상시 가상로 1" } },
  { form: "ordin-19951695", program: "g52800.bokjiro-WLF00002878", source: "113c5b036f2099bbc339f2861c115e3cab8403a08bc2d38524542d656fc1f986",
    values: { "0/0/1/1/0": "가상인", "0/0/7/0/0": "바퀴 수리", "0/0/10/0/3#i0": "2026", "0/0/10/0/3#i10": "10", "0/0/10/0/3#i16": "23" } },
  { form: "ordin-19758329", program: "g48740.gov24-541000000113", source: "b9ec6edced3983ef7016d575a4aad0c65728a3ca5572094d1cb15d540bcbd4be",
    values: { "0/0/3/4/0": "가상인", "0/0/10/3/0": "가상아", "0/0/21/0/2#p0": "2026", "0/0/21/0/2#i1": "10", "0/0/21/0/2#i6": "23" } },
];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function inspectSection(page: Page, xml: string) {
  return page.evaluate(xml => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("invalid downloaded XML");
    const paragraphs: Record<string, string> = {};
    const ownText = (paragraph: Element) => Array.from(paragraph.getElementsByTagNameNS("*", "t")).filter(node => {
      let parent = node.parentElement;
      while (parent && parent.localName !== "p") parent = parent.parentElement;
      return parent === paragraph;
    }).map(node => node.textContent ?? "").join("");
    const children = (node: Element, name: string) => Array.from(node.children).filter(child => child.localName === name);
    children(doc.documentElement, "p").forEach((p, i) => { paragraphs[`b/0/0/${i}`] = ownText(p); });
    Array.from(doc.getElementsByTagNameNS("*", "tbl")).forEach((table, index) => {
      for (const row of children(table, "tr")) for (const cell of children(row, "tc")) {
        const at = children(cell, "cellAddr")[0], sub = children(cell, "subList")[0];
        if (!at || !sub) throw new Error("missing cell address");
        children(sub, "p").forEach((p, i) => { paragraphs[`${index}/${at.getAttribute("rowAddr")}/${at.getAttribute("colAddr")}/${i}`] = ownText(p); });
      }
    });
    const structure = Array.from(doc.getElementsByTagName("*")).filter(node => node.localName !== "t")
      .map(node => [node.tagName, Array.from(node.attributes).map(attr => [attr.name, attr.value])]);
    return { paragraphs, structure };
  }, xml);
}

for (const sample of samples) test(`reviewed HWPX ${sample.form} preserves source and fills exact cells @mobile`, async ({ page }, info) => {
  const manifest = JSON.parse(readFileSync(`public/forms/writing/v1/manifest/${sample.form}.json`, "utf8"));
  expect(manifest.source.sha256).toBe(sample.source);
  const source = readFileSync(`public${manifest.source.path}`);
  expect(hash(source)).toBe(sample.source);
  const asset = unzipSync(readFileSync(`public${manifest.asset.path}`));
  const leaked: string[] = [];
  page.on("request", request => {
    const payload = request.url() + (request.postData() ?? "");
    if (payload.includes("가상인") || payload.includes(encodeURIComponent("가상인"))) leaked.push(payload);
  });
  await page.goto(`/p/${sample.program}`);
  await page.getByTestId("application-forms").locator(`a[href="/forms/write/${sample.form}?program=${sample.program}"]`).click();
  await expect(page.getByTestId("paper-fields")).toBeVisible();
  for (const [id, value] of Object.entries(sample.values)) await page.getByTestId(`paper-input-${id}`).fill(value!);
  if (sample.form === "ordin-19758329") await page.getByTestId("paper-check-0/0/9/1/0#cs0").check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "작성한 신청서 내려받기 (HWPX)" }).last().click()]);
  const directory = "logs/hwpx-live-20261023/filled"; mkdirSync(directory, { recursive: true });
  const target = `${directory}/${info.project.name}-${sample.form}.hwpx`; await download.saveAs(target);
  const completed = unzipSync(readFileSync(target));
  for (const section of manifest.sections) {
    const before = await inspectSection(page, strFromU8(asset[section.name]));
    const after = await inspectSection(page, strFromU8(completed[section.name]));
    expect(after.structure).toEqual(before.structure);
    const sectionNumber = Number(/section(\d+)/.exec(section.name)![1]);
    const changed = new Set<string>();
    if (sample.form === "ordin-19758329" && sectionNumber === 0) {
      changed.add("0/9/1/0");
      expect(after.paragraphs["0/9/1/0"]).toMatch(/■\s*출산장려금/);
    }
    for (const [id, value] of Object.entries(sample.values)) {
      const slot = manifest.slots[id], at = slot.at;
      if (at.section !== sectionNumber) continue;
      const key = `${at.table ?? "b"}/${at.row}/${at.col}/${at.p}`;
      changed.add(key); expect(after.paragraphs[key]).toContain(value);
    }
    for (const key of Object.keys(before.paragraphs)) if (!changed.has(key)) expect(after.paragraphs[key], key).toBe(before.paragraphs[key]);
  }
  for (const name of Object.keys(asset)) if (!/^Contents\/section\d+\.xml$/.test(name) && !name.startsWith("Preview/"))
    expect(completed[name], name).toEqual(asset[name]);
  expect(hash(readFileSync(`public${manifest.source.path}`))).toBe(sample.source);
  expect(leaked).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const sample of [
  { program: "g48740.gov24-541000000113", visible: "0/0/9/1/0#cs0", hidden: "0/0/19/1/0#cs1" },
  { program: "g48740.gov24-541000000151", visible: "0/0/19/1/0#cs1", hidden: "0/0/9/1/0#cs0" },
]) test(`통합서식 ${sample.program}의 해당 급여 칸만 열고 기관 확인은 고정한다 @mobile`, async ({ page }) => {
  await page.goto(`/forms/write/ordin-19758329?program=${sample.program}`);
  await expect(page.getByTestId(`paper-check-${sample.visible}`)).toBeVisible();
  await expect(page.getByTestId(`paper-check-${sample.hidden}`)).toHaveCount(0);
  await expect(page.locator('input[data-testid^="paper-input-0/0/22/"]')).toHaveCount(0);
  await page.getByRole("button", { name: "원본 양식으로 보기" }).click();
  await expect(page.getByTestId("paper-sheet")).toContainText("출산장려금");
});

test("작성과 다운로드 건수를 구분하고 다른 혜택의 직접 주소는 막는다 @mobile", async ({ page }) => {
  await page.goto("/forms");
  await expect(page.getByTestId("forms-hwpx-download-summary")).toContainText("2,509개");
  await expect(page.getByTestId("forms-writing-summary")).toContainText("1,508개 서식");
  await page.goto("/forms/write/ordin-22522839?program=g41280.gov24-394000000111");
  await expect(page.locator("main").getByRole("status")).toContainText("이 서비스에 연결된 신청서가 아니에요");
  await expect(page.getByTestId("paper-fields")).toHaveCount(0);
});
