import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildIndexSummary, compileForm, readPublishedBaselines, validateConversion, type CatalogForm, type Conversion } from "../../scripts/build-paper-writing";
import { buildFilledPaper, buildFilledPaperSection, findBoxes, validPaperManifest } from "../../src/lib/client/paperWriting";
import { indexSection, findParagraph, paragraphInsertionStyle } from "../../src/lib/client/hwpxXml";
import { measurePaperSourceRange, measurePaperText } from "../../src/lib/client/paperTextMetrics";
import { paperSlotAtKey, type PaperManifest, type PaperSlot, type PaperWritingScope } from "../../src/lib/data/paperWritingTypes";
import writingScopes from "../../src/lib/data/paperWritingScopes.json";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const catalog = JSON.parse(readFileSync("public/forms/v1/catalog.json", "utf8")).forms as Record<string, CatalogForm>;
const conversions = JSON.parse(readFileSync("public/forms/writing/v1/conversions.json", "utf8")).forms as Record<string, Conversion>;
const reviewedScopes = writingScopes.forms as Record<string, PaperWritingScope>;
const sampleIds = ["ordin-19969911", "ordin-19969479", "law-17831953",
  "agency-41130-bokjiro-WLF00004843-20260730UUWBM1416490202996361", "agency-43000-cbfc-2026-art-grant", "rule-2305415"];
const publishedBaselines = readPublishedBaselines(undefined, undefined, new Set([...sampleIds,
  "agency-47000-bokjiro-wlf00004401-allowance-application", "ordin-20088657",
  "ordin-15008013", "ordin-16093327", "ordin-17263733", "ordin-21777271", "ordin-22562417",
  "law-17621759", "ordin-16095225", "ordin-16095227", "ordin-21777513", "ordin-21891611",
  "ordin-17655269", "agency-41220-bokjiro-WLF00005525-20230109UUWBM1405150016381710",
]));

function sample(id: string) {
  const form = catalog[id], conversion = conversions[id];
  const bytes = new Uint8Array(readFileSync(`public${conversion.asset.path}`));
  return { form, conversion, bytes, files: unzipSync(bytes),
    ...compileForm(id, form, conversion, bytes, reviewedScopes[id], publishedBaselines.get(id)) };
}

const header = `<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
${["HANGUL", "LATIN", "SYMBOL"].map(lang => `<hh:fontface lang="${lang}"><hh:font id="0" face="함초롬바탕" isEmbedded="0"/></hh:fontface>`).join("")}
${[0, 1].map(id => `<hh:charPr id="${id}" height="${id ? 2000 : 1000}" useKerning="0"><hh:fontRef hangul="0" latin="0" symbol="0"/><hh:ratio hangul="95" latin="90" symbol="100"/><hh:spacing hangul="0" latin="1" symbol="0"/><hh:relSz hangul="100" latin="90" symbol="100"/></hh:charPr>`).join("")}
<hh:paraPr id="0"><hh:margin><hc:left value="100" unit="HWPUNIT"/><hc:right value="200" unit="HWPUNIT"/><hc:intent value="50" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="160"/></hh:paraPr></hh:head>`;
const paragraph = (text = "", style = 0) => `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="${style}"><hp:t>${text}</hp:t></hp:run></hp:p>`;
const cell = (row: number, col: number, paragraphs: string, ownMargin = true) => `<hp:tc hasMargin="${ownMargin ? 1 : 0}"><hp:subList>${paragraphs}</hp:subList><hp:cellAddr rowAddr="${row}" colAddr="${col}"/><hp:cellSpan rowSpan="1" colSpan="1"/><hp:cellSz width="10000" height="20000"/><hp:cellMargin left="100" right="200" top="0" bottom="0"/></hp:tc>`;
const section = (cells: string) => `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:tbl><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:tr>${cells}</hp:tr></hp:tbl></hp:run></hp:p></hs:sec>`;
function synthetic(xml: string, headerXml = header, extraSections: Record<string, Uint8Array> = {}, reviewedSlotIds?: string[]) {
  const source = { form: catalog["ordin-19969911"], conversion: conversions["ordin-19969911"] };
  const bytes = zipSync({ mimetype: [strToU8("application/hwp+zip"), { level: 0 }],
    "Contents/header.xml": strToU8(headerXml), "Contents/section0.xml": strToU8(xml), ...extraSections });
  const sha256 = hash(bytes);
  const conversion: Conversion = { ...source.conversion, metadataSanitized: true,
    asset: { path: `/forms/writing/v1/converted/ordin-19969911-${source.conversion.source.sha256.slice(0, 12)}-${sha256.slice(0, 12)}.hwpx`, bytes: bytes.length, sha256 } };
  // Detection tests deliberately use `detected`, never an unreviewed public manifest.
  // The one synthetic fill test names its reviewed coordinate and binds the new asset bytes.
  const scope = reviewedSlotIds ? { sourceSHA256: conversion.source.sha256, assetSHA256: sha256,
    programmes: { "fixture-reviewed-applicant": reviewedSlotIds } } : undefined;
  return { bytes, ...compileForm("ordin-19969911", source.form, conversion, bytes, scope) };
}
const sourceOrder = (a: PaperSlot, b: PaperSlot) => a.at.section - b.at.section
  || (a.at.table ?? -1) - (b.at.table ?? -1) || a.at.row - b.at.row || a.at.col - b.at.col
  || a.at.p - b.at.p || (a.from ?? 0) - (b.from ?? 0);
function textSlots(manifest: PaperManifest) { return Object.values(manifest.slots).filter(slot => slot.kind === "text").sort(sourceOrder); }
function detectedTextSlots(detected: Record<string, PaperSlot>) { return Object.values(detected).filter(slot => slot.kind === "text"); }
const bareTable = (title = "", nested = "") => `<hp:tbl><hp:inMargin left="0" right="0" top="0" bottom="0"/>
${title ? `<hp:tr>${cell(0, 0, paragraph(title)).replace('colSpan="1"', 'colSpan="2"')}</hp:tr>` : ""}
<hp:tr>${cell(1, 0, paragraph("성명"))}${cell(1, 1, nested ? `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${nested}</hp:run></hp:p>` : paragraph())}</hp:tr></hp:tbl>`;
const hostTable = (table: string) => `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${table}</hp:run></hp:p>`;
const bodySection = (body: string) => `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`;

describe("paper-writing compiler — actual source semantics", () => {
  it.each(["[별지 제1호 서식]", "별지 제2호서식", "【별지 제1호서식】", "■ [별지 제4호 서식]",
    "[서식 3호]", "[별지 제3-1호서식]", "[별지 서식]", "[별지]",
    "■ 고용보험법 시행규칙[별지 제107호서식] <개정 2026. 8. 19.>",
    "〔별지 제1호서식〕<개정 2024. 1. 26.>", "【별지 제1호서식】 제6조제1항 관련",
    "<개정 2025.4.25. 조례 제2953호>", "<개정이유 및 주요내용>",
    "※ 아래의 내용은 서식 작성 시 필요한 사항을 안내하는 부분으로 접수ㆍ보관되지 않습니다.",
    "「성주군 인구정책 조례」 및 동법 시행규칙에 따라 위와 같이 신청합니다. 년 월 일",
  ])("별지 표식·안내문 %s 옆의 여백은 입력란으로 열지 않는다", label => {
    const { detected } = synthetic(section(cell(0, 0, paragraph(label)) + cell(0, 1, paragraph())));
    expect(Object.keys(detected)).toHaveLength(0);
    const genuine = synthetic(section(cell(0, 0, paragraph("성명")) + cell(0, 1, paragraph())));
    expect(detectedTextSlots(genuine.detected).map(slot => slot.label)).toEqual(["성명"]);
    expect(genuine.entry.slotCount).toBe(0);
  });

  it("경북 실제 신청서의 머리말만 쓸 수 있는 경우 작성 가능으로 표시하지 않는다", () => {
    const { manifest, entry } = sample("agency-47000-bokjiro-wlf00004401-allowance-application");
    expect(Object.values(manifest.slots).filter(slot => !slot.locked)).toHaveLength(0);
    expect(entry.slotCount).toBe(0);
    expect(manifest.unsupported.some(row => /한양신명조/.test(row.reason))).toBe(true);
  });

  it("부산 중구의 부분 승인 통합서식은 다른 혜택의 체크란을 작성기로 제공하지 않는다", () => {
    const id = "agency-26110-bokjiro-wlf00006649-20260720-1";
    const form = catalog[id], conversion = conversions[id];
    const bytes = new Uint8Array(readFileSync(`public${conversion.asset.path}`));
    expect(() => validateConversion(id, form, conversion, bytes)).not.toThrow();
    expect(() => compileForm(id, form, conversion, bytes)).toThrow(/중구 출산축하금 부분만.*다른 서비스/);
    const source = readFileSync(`public${conversion.source.path}`);
    expect(hash(source)).toBe("6caa2fb4b460d4b841be849958f2af44e251be1eddbed48a9d219ddff03b7afb");
    expect(hash(bytes)).toBe(conversion.asset.sha256);

    const changedSHA = "a".repeat(64);
    const changedPath = conversion.source.path.replace(conversion.source.sha256.slice(0, 12), changedSHA.slice(0, 12));
    const changedForm = { ...form, file: { ...form.file!, hwp: changedPath, sha256: changedSHA } };
    const changedConversion = { ...conversion, source: { ...conversion.source, path: changedPath, sha256: changedSHA },
      asset: { ...conversion.asset, path: conversion.asset.path.replace(conversion.source.sha256.slice(0, 12), changedSHA.slice(0, 12)) } };
    expect(() => validateConversion(id, changedForm, changedConversion, bytes)).not.toThrow();
    expect(() => compileForm(id, changedForm, changedConversion, bytes)).toThrow(/원본이 바뀌어.*재검토/);
  });

  it("당진 건강음료의 부분 승인 통합서식은 다른 서비스 입력을 제공하지 않는다", () => {
    const id = "ordin-21685783";
    const form = catalog[id], conversion = conversions[id];
    const bytes = new Uint8Array(readFileSync(`public${conversion.asset.path}`));
    expect(() => validateConversion(id, form, conversion, bytes)).not.toThrow();
    expect(() => compileForm(id, form, conversion, bytes)).toThrow(/건강음료 지원 부분만.*다른 서비스/);
    expect(hash(readFileSync(`public${conversion.source.path}`)))
      .toBe("c6713e5df348d8103c5b3a294fa8f61ae9ba0ee0cdecd1390379eb1987f6557c");
  });

  it("완도 통합서식의 기관 확인란과 다른 급여 입력은 작성기로 제공하지 않는다", () => {
    const id = "ordin-22371299";
    const form = catalog[id], conversion = conversions[id];
    const bytes = new Uint8Array(readFileSync(`public${conversion.asset.path}`));
    expect(() => validateConversion(id, form, conversion, bytes)).not.toThrow();
    expect(() => compileForm(id, form, conversion, bytes)).toThrow(/완도군 출산장려금 부분.*접수기관/);
    expect(hash(readFileSync(`public${conversion.source.path}`)))
      .toBe("49b5991d6753869d07b09067f5108d9359e405aca330073bc42cc4f597157ee7");
  });

  it.each([
    ["ordin-21127609", "b6100833b99537ce6e62a7fb00a82d5721d4226943c5f84a73d9d1c3e3a77599", /산후관리비 부분만.*다른 국가급여/],
    ["agency-43770-eumseong-pepper-148280", "9d65c74524d840783d127f44c2b4fe4f96951a6644969b9acfb3e4df94af846a", /성별 남.*동의 선체크/],
    ["agency-12150-suncheon-small-71811", "db42f2522e415d43fbd838308b7ff0dbe954ae670c9d9f80a4de904253449093", /선인쇄 V표시3곳.*기관평가표/],
  ] as const)("%s: 부분 승인 밖 선택이나 인쇄 동의를 작성기로 생성하지 않는다", (id, sourceSHA, reason) => {
    const form = catalog[id], conversion = conversions[id];
    const bytes = new Uint8Array(readFileSync(`public${conversion.asset.path}`));
    expect(() => validateConversion(id, form, conversion, bytes)).not.toThrow();
    expect(hash(readFileSync(`public${conversion.source.path}`))).toBe(sourceSHA);
    expect(hash(bytes)).toBe(conversion.asset.sha256);
    expect(() => compileForm(id, form, conversion, bytes)).toThrow(reason);
  });

  it("원본에 ASCII 공백만 남은 실제 빈 셀도 런타임에서 같은 신원으로 읽는다", () => {
    const s = sample("ordin-20088657");
    const slot = Object.values(s.manifest.slots).find(item => item.kind === "text" && item.expect === "  " && !item.locked)!;
    expect(slot).toBeDefined();
    expect(validPaperManifest(s.manifest, s.manifest.formId)).not.toBeNull();
    const xml = strFromU8(s.files[`Contents/section${slot.at.section}.xml`]);
    const filled = buildFilledPaperSection(s.manifest, slot.at.section, xml, { values: { [slot.id]: "가" }, checks: {} });
    expect(findParagraph(indexSection(filled), slot.at.table!, slot.at.row, slot.at.col, slot.at.p).text).toBe("가");
  });
  it.each(["ordin-15008013", "ordin-16093327", "ordin-17263733", "ordin-21777271"])
    ("%s: later staff sections are locked and existing supported applicant cells remain open", id => {
      const s = sample(id), slots = Object.values(s.manifest.slots);
      if (id === "ordin-15008013") {
        expect(slots.filter(slot => slot.at.section === 0 && !slot.locked).sort(sourceOrder).map(slot => slot.id))
          .toEqual(["0/2/9/0/2#p0", "0/2/9/0/2#i1", "0/2/9/0/2#i6"]);
      }
      if (id === "ordin-21777271") expect(slots.some(slot => slot.at.section === 0 && slot.kind === "text" && !slot.locked)).toBe(true);
      const staff = slots.filter(slot => slot.at.section === 1);
      expect(staff.length).toBeGreaterThan(0);
      expect(staff.every(slot => slot.locked?.kind === "agency")).toBe(true);
      if (id === "ordin-15008013") expect(s.manifest.slots["1/0/2/3/0"].locked?.kind).toBe("agency");
      const xml = strFromU8(s.files["Contents/section1.xml"]);
      expect(buildFilledPaperSection(s.manifest, 1, xml, {
        values: Object.fromEntries(staff.map(slot => [slot.id, "홍길동"])),
        checks: Object.fromEntries(staff.map(slot => [slot.id, true])),
      })).toBe(xml);
    });

  it("actual later postpartum consent keeps the citizen's name open and consent choices locked", () => {
    const s = sample("ordin-22562417"), slots = Object.values(s.manifest.slots).filter(slot => slot.at.section === 1);
    const names = slots.filter(slot => slot.kind === "text" && /성\s*명/.test(slot.label));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every(slot => !slot.locked)).toBe(true);
    const choices = slots.filter(slot => slot.kind === "check" && /동의/.test(slot.expect));
    expect(choices.length).toBeGreaterThan(0);
    expect(choices.every(slot => slot.locked?.kind === "consent")).toBe(true);
    const xml = strFromU8(s.files["Contents/section1.xml"]), name = names[0];
    const written = indexSection(buildFilledPaperSection(s.manifest, 1, xml, { values: { [name.id]: "김가나" }, checks: {} }));
    expect(findParagraph(written, name.at.table!, name.at.row, name.at.col, name.at.p).text).toBe("김가나");
  });

  it.each(["law-17621759", "ordin-16095225", "ordin-16095227"])
    ("%s: actual bare agreement/disagreement boxes stay manual", id => {
      const s = sample(id), choices = Object.values(s.manifest.slots).filter(slot => slot.kind === "check"
        && (id === "law-17621759" ? slot.id === "0/0/12/3/0#cb0" : slot.at.row === 12 && slot.at.col === 0 && slot.at.p === 1));
      expect(choices.length).toBe(id === "law-17621759" ? 1 : 2);
      expect(choices.every(slot => slot.locked?.kind === "consent")).toBe(true);
      expect(choices.map(slot => slot.label)).toEqual(id === "law-17621759" ? ["동의"] : ["동의", "미동의"]);
      const xml = strFromU8(s.files["Contents/section0.xml"]);
      expect(buildFilledPaperSection(s.manifest, 0, xml, { values: {}, checks: Object.fromEntries(choices.map(slot => [slot.id, true])) })).toBe(xml);
    });

  it.each(["심사조서", "접수대장", "지급대장", "관리대장", "심사결과표", "예방접종실시대장", "호국보훈수당 지급대상 내역", "지원대상자 명부"])
    ("only the independent full-width agency title %s locks the table", title => {
      const { detected } = synthetic(bodySection(hostTable(bareTable(title))));
      expect(detectedTextSlots(detected)).toHaveLength(1);
      expect(detectedTextSlots(detected)[0].locked?.kind).toBe("agency");
    });

  it("body headings affect following tables only, reset at a citizen title and reset at a new section", () => {
    const xml = bodySection(hostTable(bareTable()) + paragraph("지원 검토조서") + hostTable(bareTable())
      + paragraph("개인정보 제공 동의서") + hostTable(bareTable()) + paragraph("지급대장"));
    const { detected } = synthetic(xml, header, { "Contents/section1.xml": strToU8(bodySection(hostTable(bareTable()))) });
    expect(detectedTextSlots(detected).map(slot => [slot.at.section, slot.at.table, slot.locked?.kind ?? "open"]))
      .toEqual([[0, 0, "open"], [0, 1, "agency"], [0, 2, "open"], [1, 0, "open"]]);
  });

  it("a new full-width citizen title ends the preceding agency region for following tables", () => {
    const { detected } = synthetic(bodySection(hostTable(bareTable("지급대장"))
      + hostTable(bareTable("지원금 신청서")) + hostTable(bareTable())));
    expect(detectedTextSlots(detected).map(slot => slot.locked?.kind ?? "open")).toEqual(["agency", "open", "open"]);
  });

  it("nested agency tables inherit their parent's role even if a child has a citizen title", () => {
    const { detected } = synthetic(bodySection(hostTable(bareTable("지원금 지급대장", bareTable("신청서")))));
    const child = detectedTextSlots(detected).filter(slot => slot.at.table === 1);
    expect(child).toHaveLength(1); expect(child[0].locked?.kind).toBe("agency");
  });

  it("a small staff label does not lock the whole applicant table or a generic family roster", () => {
    const cells = cell(0, 0, paragraph("성명")) + cell(0, 1, paragraph())
      + cell(1, 0, paragraph("담당 공무원 확인")) + cell(1, 1, paragraph());
    const { detected } = synthetic(section(cells));
    expect(detectedTextSlots(detected).map(slot => slot.locked?.kind ?? "open")).toEqual(["open", "agency"]);
    expect(detectedTextSlots(synthetic(bodySection(paragraph("가족 명부") + hostTable(bareTable()))).detected)[0].locked).toBeUndefined();
  });

  it.each(["[   ]동의", "□ 동 의 □ 미동의", "동의 □ 미동의 □", "동의[  ], 미동의[  ]", "개인정보 이용에 동의하십니까? □예 □아니오", "□예 □아니오(미동의 시 제한)"])
    ("explicit consent choices %s are locked without changing the source text", text => {
      const xml = section(cell(0, 0, paragraph(text))).replaceAll('width="10000"', 'width="60000"');
      const { manifest, detected } = synthetic(xml), choices = Object.values(detected).filter(slot => slot.kind === "check");
      expect(choices.length).toBeGreaterThan(0); expect(choices.every(slot => slot.locked?.kind === "consent")).toBe(true);
      expect(buildFilledPaperSection(manifest, 0, xml, { values: {}, checks: Object.fromEntries(choices.map(slot => [slot.id, true])) })).toBe(xml);
    });

  it("bare consent choices do not newly lock a name or unrelated benefit choices in the same paragraph", () => {
    const text = "성명:       / [  ] 출산가정 [  ] 전입가정 / 문자 안내: [  ] 동 의 [  ] 미동의";
    const { detected } = synthetic(section(cell(0, 0, paragraph(text))).replaceAll('width="10000"', 'width="80000"'));
    const slots = Object.values(detected), name = slots.find(slot => slot.kind === "inline");
    expect(name?.locked).toBeUndefined(); expect(name).toBeTruthy();
    expect(slots.filter(slot => slot.kind === "check").map(slot => slot.locked?.kind ?? "open"))
      .toEqual(["open", "open", "consent", "consent"]);
  });

  it.each(["ordin-21777513", "ordin-21891611"])("%s: squares introducing privacy headings stay printed, not checkable", id => {
    const s = sample(id);
    expect(strFromU8(s.files["Contents/section0.xml"])).toContain("수집·이용 목적");
    expect(Object.values(s.manifest.slots).filter(slot => slot.kind === "check"
      && /^(?:수집[·ㆍ]?이용목적|개인정보수집항목)$/.test(slot.label.replace(/\s+/g, "")))).toEqual([]);
  });

  it("대리인 서명행 아래 여백은 위의 라벨을 빌려 입력 칸으로 만들지 않는다", () => {
    const { manifest } = sample("law-17831953");
    expect(Object.values(manifest.slots).filter(slot => slot.at.section === 0 && slot.at.table === 1
      && slot.at.row === 12 && slot.at.col === 0)).toHaveLength(0);
  });
  for (const id of sampleIds) it(`${id}: source identity, real run metrics and source coordinates are preserved`, () => {
    const s = sample(id);
    expect(s.conversion.metadataSanitized).toBe(true);
    expect(s.manifest.source).toEqual(s.conversion.source);
    expect(s.manifest.asset).toEqual(s.conversion.asset);
    expect(hash(s.bytes)).toBe(s.conversion.asset.sha256);
    expect(s.entry.slotCount).toBeGreaterThan(0);
    expect(hash(readFileSync(`public${s.conversion.source.path}`))).toBe(s.conversion.source.sha256);
    const sections = new Map(s.manifest.sections.map(({ name }) => [Number(/section(\d+)\.xml$/.exec(name)![1]), strFromU8(s.files[name])]));
    const indexes = new Map([...sections].map(([section, xml]) => [section, indexSection(xml)]));
    for (const slot of Object.values(s.manifest.slots)) {
      const idx = indexes.get(slot.at.section)!;
      const p = slot.at.table === null ? idx.body[slot.at.p] : findParagraph(idx, slot.at.table, slot.at.row, slot.at.col, slot.at.p);
      expect(slot.expect).toBe(p.text);
      const box = slot.kind === "check" ? findBoxes(slot.expect).filter(item => item.shape === slot.boxShape)[slot.box!] : null;
      const from = box?.from ?? slot.from ?? 0;
      const to = box?.to ?? (slot.kind === "text" ? slot.expect.length : slot.to ?? from);
      expect(slot.width?.charPrIDRef).toBe(paragraphInsertionStyle(p, from, to));
      expect(slot.width!.available).toBeGreaterThan(0);
      const line = s.manifest.lineMetrics![paperSlotAtKey(slot.at)];
      expect(line.runs[0].from).toBe(0);
      expect(line.runs.at(-1)!.to).toBe(p.text.length);
      expect(measurePaperSourceRange(p.text, line)).not.toBeNull();
    }
    for (const [section, xml] of sections)
      expect(buildFilledPaperSection(s.manifest, section, xml, { values: {}, checks: {} })).toBe(xml);
  });

  it("장수: genuine whole-empty fields are exactly the basic8 and delegation5", () => {
    const { manifest } = sample("ordin-19969911");
    expect(textSlots(manifest).map(slot => `${slot.at.row}/${slot.at.col}/${slot.at.p}`)).toEqual([
      "1/4/0", "1/11/0", "1/14/0", "2/4/0", "2/11/0", "3/4/0", "3/7/0", "3/11/0",
      "12/5/0", "12/12/0", "13/5/0", "13/12/0", "14/5/0",
    ]);
    expect(textSlots(manifest).every(slot => !slot.locked)).toBe(true);
    for (const row of [4, 9, 15]) expect(textSlots(manifest).some(slot => slot.at.row === row)).toBe(false);
  });

  it("장수: 2026/10/23 keeps the printed year/month/day tokens at both actual coordinates", () => {
    const s = sample("ordin-19969911"), xml = strFromU8(s.files["Contents/section0.xml"]);
    const dates = Object.values(s.manifest.slots).filter(slot => slot.token).sort(sourceOrder);
    expect(dates.map(slot => [slot.at.row, slot.at.p, slot.token, slot.kind])).toEqual([
      [4, 2, "년", "prefix"], [4, 2, "월", "inline"], [4, 2, "일", "inline"],
      [15, 0, "년", "prefix"], [15, 0, "월", "inline"], [15, 0, "일", "inline"],
    ]);
    const values = Object.fromEntries(dates.map(slot => [slot.id, slot.token === "년" ? "2026" : slot.token === "월" ? "10" : "23"]));
    const filled = buildFilledPaperSection(s.manifest, 0, xml, { values, checks: {} });
    const before = indexSection(xml), after = indexSection(filled);
    for (const [row, p] of [[4, 2], [15, 0]]) expect(findParagraph(after, 0, row, 0, p).text).toBe("2026년 10월 23일");
    expect(after.paragraphCount).toBe(before.paragraphCount); expect(after.tableCount).toBe(before.tableCount);
    for (const c of before.tables[0].rows.flat()) c.paragraphs.forEach((paragraph, p) => {
      if (c.col === 0 && ((c.row === 4 && p === 2) || (c.row === 15 && p === 0))) return;
      expect(findParagraph(after, 0, c.row, c.col, p).text).toBe(paragraph.text);
    });
  });

  it("119: the writing-instruction example stays printed; trailing consents have distinct locked labels", () => {
    const { manifest } = sample("ordin-19969479"), slots = Object.values(manifest.slots);
    expect(slots.some(slot => slot.at.row === 12 && slot.at.col === 1)).toBe(false);
    const consents = slots.filter(slot => slot.at.row === 15 && slot.at.p === 8);
    expect(consents.map(slot => slot.label)).toEqual(["동의함", "동의하지 않음"]);
    expect(consents.every(slot => slot.locked?.kind === "consent")).toBe(true);
    expect(textSlots(manifest).some(slot => slot.at.row === 11 || slot.at.row === 16)).toBe(false);
  });

  it("multi-section law: instructions/procedure blank cells in the later section never become entries", () => {
    const { manifest } = sample("law-17831953");
    expect(manifest.sections.map(s => s.name)).toEqual(["Contents/section0.xml", "Contents/section1.xml"]);
    expect(Object.values(manifest.slots).filter(slot => slot.at.section === 1)).toEqual([]);
    expect(textSlots(manifest).some(slot => /쪽|이사장/.test(slot.label))).toBe(false);
  });

  it("whole-empty multi-paragraph cells open only p0 with a single-line width; mixed legal blanks stay printed", () => {
    const xml = section(cell(0, 0, paragraph("성명")) + cell(0, 1, paragraph() + paragraph() + paragraph())
      + cell(1, 0, paragraph("신청내용")) + cell(1, 1, paragraph("법률에 따른 동의 안내입니다.") + paragraph()));
    const { manifest } = synthetic(xml, header, {}, ["0/0/0/1/0"]), slots = textSlots(manifest);
    expect(slots).toHaveLength(1); expect(slots[0].at).toMatchObject({ row: 0, col: 1, p: 0 });
    expect(slots[0].width!.available).toBe(9350);
    const result = indexSection(buildFilledPaperSection(manifest, 0, xml, { values: { [slots[0].id]: "김가나" }, checks: {} }));
    expect(result.tables[0].rows[0][1].paragraphs.map(p => p.text)).toEqual(["김가나", "", ""]);
  });

  it.each(["<hp:lineBreak/>", "<hp:tab/>", "<hp:pic/>", "<hp:ctrl/>"])("non-text content %s never becomes an empty input", control => {
    const xml = section(cell(0, 0, paragraph("성명")) + cell(0, 1, paragraph().replace("<hp:t>", `${control}<hp:t>`)));
    const { manifest, detected } = synthetic(xml);
    expect(Object.keys(detected)).toHaveLength(0);
    expect(manifest.unsupported.some(item => /그림·필드·탭/.test(item.reason))).toBe(true);
  });

  it.each([[false, 8750], [true, 9350]] as const)("hasMargin=%s selects the actual inherited/own cell margins", (ownMargin, width) => {
    const xml = section(cell(0, 0, paragraph("성명")) + cell(0, 1, paragraph(), ownMargin))
      .replace('<hp:inMargin left="0" right="0"', '<hp:inMargin left="400" right="500"');
    const { manifest, detected } = synthetic(xml);
    const slot = detectedTextSlots(detected)[0];
    expect(slot.width!.available).toBe(width);
    expect(manifest.lineMetrics![paperSlotAtKey(slot.at)].available).toBe(width);
  });

  it.each([['face="함초롬바탕"', 'face="Unknown Declared Family"'], ['isEmbedded="0"', 'isEmbedded="1"'], ['useKerning="0"', 'useKerning="1"']])
    ("unknown/unsupported source font option %s is held without a fallback", (from, to) => {
      const { manifest, detected } = synthetic(section(cell(0, 0, paragraph("성명")) + cell(0, 1, paragraph())), header.replaceAll(from, to));
      expect(Object.keys(detected)).toHaveLength(0);
      expect(manifest.unsupported.some(item => /글꼴/.test(item.reason))).toBe(true);
    });

  it("mixed run blank uses the right input run's actual font/size/ratio/spacing, not its large label", () => {
    const p = `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="1"><hp:t>성명:</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t/></hp:run><hp:run charPrIDRef="0"><hp:t>       </hp:t></hp:run></hp:p>`;
    const { manifest, detected } = synthetic(section(cell(0, 0, p)));
    const slot = Object.values(detected)[0];
    expect(slot.width!.charPrIDRef).toBe(0);
    expect(slot.width!.styles.latin).toMatchObject({ family: "함초롬바탕", size: 1000, ratio: 90, relSz: 90, spacing: 1 });
    expect(slot.width!.available).toBe(measurePaperText("       ", slot.width!.styles));
    const runs = manifest.lineMetrics![paperSlotAtKey(slot.at)].runs;
    expect(runs.map(run => [run.from, run.to, run.styles.latin.size])).toEqual([[0, 3, 2000], [3, 3, 2000], [3, 10, 1000]]);
  });

  it("non-contiguous section names retain their actual section numbers in source coordinates", () => {
    const xml = section(cell(0, 0, paragraph("성명")) + cell(0, 1, paragraph()));
    const { manifest, detected } = synthetic(xml, header, { "Contents/section2.xml": strToU8(xml) });
    expect(manifest.sections.map(info => info.name)).toEqual(["Contents/section0.xml", "Contents/section2.xml"]);
    expect(detectedTextSlots(detected).map(slot => slot.at.section)).toEqual([0, 2]);
  });

  it("a date prefix at an explicit zero-length run binds that run without deleting printed tokens", () => {
    const p = `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="1"><hp:t/></hp:run><hp:run charPrIDRef="0"><hp:t>년     월     일</hp:t></hp:run></hp:p>`;
    const { detected } = synthetic(section(cell(0, 0, p)));
    const year = Object.values(detected).find(slot => slot.token === "년")!;
    expect(year.kind).toBe("prefix"); expect(year.from).toBe(0); expect(year.to).toBe(0); expect(year.after).toBe("년");
    expect(year.width!.charPrIDRef).toBe(1); expect(year.width!.styles.latin.size).toBe(2000);
  });

  it("actual embedded BinData and all non-body members survive a real applicant-name write unchanged", async () => {
    const s = sample(sampleIds[3]);
    expect(Object.keys(s.files).some(name => name.startsWith("BinData/"))).toBe(true);
    const name = Object.values(s.manifest.slots).find(slot => slot.kind === "text" && !slot.locked && /성\s*명|이름/.test(slot.label))!;
    expect(name).toBeTruthy();
    const filled = await buildFilledPaper(s.manifest, s.bytes, { values: { [name.id]: "김가나" }, checks: {} });
    const after = unzipSync(filled.bytes);
    for (const [name, data] of Object.entries(s.files)) {
      if (s.manifest.preview.dropEntries.includes(name) || name === s.manifest.preview.textEntry || /^Contents\/section\d+\.xml$/.test(name)) continue;
      expect(hash(after[name]), name).toBe(hash(data));
    }
    for (const info of s.manifest.sections) {
      const before = indexSection(strFromU8(s.files[info.name])), current = indexSection(strFromU8(after[info.name]));
      expect(current.tableCount).toBe(before.tableCount); expect(current.paragraphCount).toBe(before.paragraphCount);
    }
    const result = indexSection(strFromU8(after[`Contents/section${name.at.section}.xml`]));
    expect(findParagraph(result, name.at.table!, name.at.row, name.at.col, name.at.p).text).toBe("김가나");
  });

  it.each(["ordin-17655269", "agency-41220-bokjiro-WLF00005525-20230109UUWBM1405150016381710"])
    ("%s: unsupported real-source styles stay closed with reasons instead of a guessed font", id => {
      const s = sample(id);
      expect(s.entry.slotCount).toBe(0);
      expect(s.manifest.unsupported.length).toBeGreaterThan(0);
    });

  it("final filename binds both hashes and requires explicit sanitized metadata", () => {
    const s = sample("ordin-19969911");
    expect(() => validateConversion(s.form.id, s.form, s.conversion, s.bytes)).not.toThrow();
    for (const metadataSanitized of [undefined, false]) expect(() => validateConversion(s.form.id, s.form, { ...s.conversion, metadataSanitized }, s.bytes)).toThrow(/메타데이터/);
    for (const path of [s.conversion.asset.path.replace(/-[a-f0-9]{12}\.hwpx$/, ".hwpx"), "/forms/writing/v1/converted/../escape.hwpx"])
      expect(() => validateConversion(s.form.id, s.form, { ...s.conversion, asset: { ...s.conversion.asset, path } }, s.bytes)).toThrow(/경로/);
    expect(() => validateConversion("ordin-0", s.form, s.conversion, s.bytes)).toThrow(/식별자/);
    expect(() => validateConversion(s.form.id, s.form, { ...s.conversion, source: { ...s.conversion.source, sha256: "0".repeat(64) } }, s.bytes)).toThrow(/원본/);
    const altered = s.bytes.slice(); altered[altered.length - 1] ^= 1;
    expect(() => validateConversion(s.form.id, s.form, s.conversion, altered)).toThrow(/SHA/);
  });

  it("index summary includes every actual writable ID sorted while preserving shard identities", () => {
    const a = sample(sampleIds[0]), b = sample(sampleIds[1]);
    const shards: [string, Record<string, typeof a.entry>][] = [["01", { [sampleIds[0]]: a.entry }], ["02", { [sampleIds[1]]: b.entry }]];
    const summary = buildIndexSummary(shards, 6, 4);
    expect(summary.formIds).toEqual([sampleIds[0], sampleIds[1]].sort());
    expect(summary.counts).toEqual({ conversions: 6, writable: 2, unsupported: 4 });
    expect(shards[0][1][sampleIds[0]].source).toEqual(a.conversion.source);
    expect(a.entry.manifestSha256).toBe(hash(Buffer.from(JSON.stringify(a.manifest))));
  });
});
