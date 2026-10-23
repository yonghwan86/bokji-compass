import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { buildFilledPaper, buildFilledPaperSection, loadPaperManifest, paperFieldError, paperFileName } from "@/lib/client/paperWriting";
import { writeHwpx } from "@/lib/client/hwpxZip";
import { detailBucket } from "@/lib/data/bucket";
import type { PaperManifest, PaperSlot } from "@/lib/data/paperWritingTypes";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const paragraph = (text: string) => `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`;
const section = (text: string) => `<hs:sec xmlns:hs="section" xmlns:hp="paragraph">${paragraph(text)}</hs:sec>`;

function fixture(id = "ordin-991122") {
  const files = {
    mimetype: strToU8("application/hwp+zip"),
    "Contents/header.xml": strToU8("<header/>"),
    "Contents/section0.xml": strToU8(section("고정 안내문")),
    "Contents/section1.xml": strToU8(section("년     월     일")),
    "Contents/content.hpf": strToU8("<metadata/>"),
    "META-INF/manifest.xml": strToU8("<manifest/>"),
    "Preview/PrvText.txt": strToU8("낡은 미리보기"),
    "Preview/PrvImage.png": new Uint8Array([1, 2, 3]),
    "BinData/image1.png": new Uint8Array([11, 22, 33, 44]),
  };
  const bytes = writeHwpx({ order: Object.keys(files), files });
  const sourceSha = "a".repeat(64), assetSha = hash(bytes);
  const at = { section: 1, table: null, row: 0, col: 0, p: 0 };
  const expectText = "년     월     일";
  const style = { family: "함초롬바탕", size: 1000 };
  const styles = { hangul: style, latin: style, symbol: style };
  const dateSlot = (token: "년" | "월" | "일", from: number, to: number): PaperSlot => ({
    id: token, at, kind: from === to ? "prefix" : "inline", expect: expectText,
    from, to, ...(from === to ? { after: token } : { pad: " " as const }),
    width: { available: token === "년" ? 3000 : 1500, styles, charPrIDRef: 0 },
    token, label: token, budget: token === "년" ? 6 : 3, input: "numeric", align: "right",
  });
  const manifest: PaperManifest = {
    schema: 1, formId: id, title: "신청서", lawTitle: "검사용", sourceKind: "law",
    source: { path: `/forms/files/${id}.hwp`, bytes: 10, sha256: sourceSha, format: "hwp" },
    asset: { path: `/forms/writing/v1/converted/${id}-${sourceSha.slice(0, 12)}-${assetSha.slice(0, 12)}.hwpx`, bytes: bytes.length, sha256: assetSha },
    pageCount: 2, checkedAt: "2026-10-23", sourceTextSha256: "b".repeat(64),
    sections: [0, 1].map(n => ({ name: `Contents/section${n}.xml`, tableCount: 0, paragraphCount: 1 })),
    preview: { textEntry: "Preview/PrvText.txt", exact: false, limit: null, dropEntries: ["Preview/PrvImage.png"] },
    blocks: [], slots: { 년: dateSlot("년", 0, 0), 월: dateSlot("월", 1, 6), 일: dateSlot("일", 7, 12) },
    lineMetrics: { "1/b/0/0/0": { available: 20000, runs: [{ from: 0, to: expectText.length, styles }] } },
    capacities: { "1/b/0/0/0": 40 }, unsupported: [], manual: [],
  };
  return { bytes, files, manifest };
}

afterEach(() => vi.unstubAllGlobals());

describe("HWP 변환본의 작성 결과", () => {
  it("후반 섹션의 날짜만 채우고 앞 섹션·리소스·스타일을 바이트 그대로 지킨다", async () => {
    const { bytes, files, manifest } = fixture();
    const result = await buildFilledPaper(manifest, bytes, { values: { 년: "2026", 월: "10", 일: "23" }, checks: {} });
    const filled = unzipSync(result.bytes);
    expect(strFromU8(filled["Contents/section1.xml"])).toMatch(/2026년\s*10월\s*23일/);
    for (const name of ["Contents/section0.xml", "Contents/header.xml", "Contents/content.hpf", "BinData/image1.png"]) {
      expect(filled[name], name).toEqual(files[name as keyof typeof files]);
    }
    expect(filled["Preview/PrvImage.png"]).toBeUndefined();
    expect(strFromU8(filled["Preview/PrvText.txt"])).toContain("2026년");
    expect(Object.keys(filled)[0]).toBe("mimetype");
    expect(result.fileName).toBe("신청서_작성본.hwpx");
  });

  it("월·일 범위와 실제 달력을 확인하고 원문이 바뀌면 쓰기를 중단한다", () => {
    const { manifest, files } = fixture();
    expect(paperFieldError(manifest.slots.월, "13")).toMatch(/1부터 12/);
    expect(paperFieldError(manifest.slots.년, "26")).toMatch(/네 자리/);
    const xml = strFromU8(files["Contents/section1.xml"]);
    expect(() => buildFilledPaperSection(manifest, 1, xml, { values: { 년: "2026", 월: "2", 일: "30" }, checks: {} })).toThrow(/달력/);
    expect(() => buildFilledPaperSection(manifest, 1, xml.replace("년", "연도"), { values: { 년: "2026" }, checks: {} })).toThrow(/원본 서식의 내용/);
  });

  it("바이트 손상·본문 누락·리소스 참조가 남은 미리보기 삭제를 거절한다", async () => {
    const { manifest, bytes, files } = fixture();
    const broken = bytes.slice(); broken[0] ^= 1;
    await expect(buildFilledPaper(manifest, broken, { values: {}, checks: {} })).rejects.toThrow(/변환본/);
    await expect(buildFilledPaper({ ...manifest, sections: manifest.sections.slice(1) }, bytes, { values: {}, checks: {} })).rejects.toThrow(/본문 목록/);
    const referenced = { ...files, "Contents/content.hpf": strToU8('<item href="Preview/PrvImage.png"/>') };
    const referencedBytes = writeHwpx({ order: Object.keys(referenced), files: referenced });
    await expect(buildFilledPaper({ ...manifest, asset: { ...manifest.asset, bytes: referencedBytes.length, sha256: hash(referencedBytes) } }, referencedBytes, { values: {}, checks: {} })).rejects.toThrow(/미리보기 그림을 참조/);
  });

  it("동의·기관 잠금은 주입된 값도 쓰지 않고 다운로드 이름을 파일명으로 안전하게 만든다", () => {
    const { manifest, files } = fixture();
    manifest.slots.년.locked = { kind: "agency", reason: "기관 작성" };
    const xml = strFromU8(files["Contents/section1.xml"]);
    expect(buildFilledPaperSection(manifest, 1, xml, { values: { 년: "2026" }, checks: {} })).toBe(xml);
    expect(paperFileName({ ...manifest, title: '../신청서:주소\\기타?\u0000' })).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
  });

  for (const prefix of [false, true]) {
    it(`${prefix ? "날짜 앞 삽입" : "빈칸 교체"}이 런 경계의 앞 글꼴을 물려받지 않는다`, () => {
      const { manifest } = fixture();
      const tail = prefix ? "년" : "    ";
      const xml = `<hs:sec>${paragraph(":").replace('charPrIDRef="0"', 'charPrIDRef="7"').replace("</hp:p>", `<hp:run charPrIDRef="8"><hp:t>${tail}</hp:t></hp:run></hp:p>`)}</hs:sec>`;
      const narrow = { family: "함초롬바탕", size: 1000 }, wide = { family: "함초롬바탕", size: 2000 };
      const styles = { hangul: narrow, latin: narrow, symbol: narrow };
      const before = { hangul: wide, latin: wide, symbol: wide };
      const slot: PaperSlot = { ...manifest.slots.년, id: "entry", kind: prefix ? "prefix" : "inline", expect: `:${tail}`, from: 1, to: prefix ? 1 : 5,
        ...(prefix ? { after: "년", token: "년" as const } : { pad: " " as const, token: undefined }),
        width: { available: prefix ? 4000 : 2500, styles, charPrIDRef: 8 }, label: "입력" };
      manifest.slots = { entry: slot };
      manifest.lineMetrics = { "1/b/0/0/0": { available: prefix ? 4000 : 2500, runs: [{ from: 0, to: 1, styles: before }, { from: 1, to: 1 + tail.length, styles }] } };
      const filled = buildFilledPaperSection(manifest, 1, xml, { values: { entry: prefix ? "2026" : "WW" }, checks: {} });
      expect(filled).toContain('<hp:run charPrIDRef="7"><hp:t>:</hp:t></hp:run>');
      expect(filled).toContain(`<hp:run charPrIDRef="8"><hp:t>${prefix ? "2026년" : "WW"}</hp:t></hp:run>`);
      slot.width!.charPrIDRef = 7;
      expect(() => buildFilledPaperSection(manifest, 1, xml, { values: { entry: prefix ? "2026" : "WW" }, checks: {} })).toThrow(/입력 위치의 글꼴/);
    });
  }

  it("빈 런 뒤 교체는 실제 글자가 있는 런과 폭 분석을 대조한다", () => {
    const { manifest } = fixture();
    const xml = '<hs:sec><hp:p paraPrIDRef="0"><hp:run charPrIDRef="7"><hp:t/></hp:run><hp:run charPrIDRef="8"><hp:t>    </hp:t></hp:run></hp:p></hs:sec>';
    const narrow = { family: "함초롬바탕", size: 1000 }, styles = { hangul: narrow, latin: narrow, symbol: narrow };
    manifest.slots = { entry: { ...manifest.slots.월, id: "entry", token: undefined, expect: "    ", from: 0, to: 4, width: { available: 2500, styles, charPrIDRef: 7 } } };
    manifest.lineMetrics = { "1/b/0/0/0": { available: 2500, runs: [{ from: 0, to: 0, styles }, { from: 0, to: 4, styles }] } };
    expect(() => buildFilledPaperSection(manifest, 1, xml, { values: { entry: "WW" }, checks: {} })).toThrow(/입력 위치의 글꼴/);
  });

  it("한 줄의 시작일과 종료일을 각각 검증해 앞 날짜를 덮어쓰지 않는다", () => {
    const { manifest } = fixture();
    const original = "년     월     일", text = `${original}부터 ${original}까지`;
    const first = Object.values(manifest.slots);
    const both = [...first, ...first.map(slot => ({ ...slot, id: `end-${slot.id}`, from: slot.from! + 16, to: slot.to! + 16 }))]
      .map(slot => ({ ...slot, expect: text }));
    manifest.slots = Object.fromEntries(both.map(slot => [slot.id, slot]));
    const styles = first[0].width!.styles;
    manifest.lineMetrics = { "1/b/0/0/0": { available: 40000, runs: [{ from: 0, to: text.length, styles }] } };
    expect(() => buildFilledPaperSection(manifest, 1, section(text), { values: { 년: "2026", 월: "2", 일: "30", "end-년": "2026", "end-월": "3", "end-일": "1" }, checks: {} })).toThrow(/달력/);
  });
});

describe("작성 버튼의 공개 파일 신원 검증", () => {
  for (const corrupt of [false, true]) {
    it(corrupt ? "manifest가 바뀌면 내용을 해석하기 전에 차단한다" : "원본 SHA와 변환본 SHA가 묶인 manifest를 읽는다", async () => {
      const id = corrupt ? "ordin-991124" : "ordin-991123";
      const { manifest } = fixture(id), text = JSON.stringify(manifest);
      const bucket = detailBucket(id);
      const entry = { source: manifest.source, asset: manifest.asset, manifest: `/forms/writing/v1/manifest/${id}.json`, manifestSha256: hash(strToU8(text)), pageCount: 2, checkedAt: manifest.checkedAt, slotCount: 3, lockedCount: 0 };
      vi.stubGlobal("fetch", vi.fn(async (path: string) => path.includes("/index/")
        ? new Response(JSON.stringify({ schema: 1, bucket, forms: { [id]: entry } }))
        : new Response(corrupt ? text.replace("신청서", "다른서식") : text)));
      expect(await loadPaperManifest(id)).toEqual(corrupt ? null : manifest);
    });
  }
});
