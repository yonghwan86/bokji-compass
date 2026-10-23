import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scopeManifestToProgram } from "@/lib/client/paperWriting";
import type { PaperManifest, PaperNode, PaperSlot } from "@/lib/data/paperWritingTypes";

const actual = JSON.parse(readFileSync("public/forms/writing/v1/manifest/ordin-19969911.json", "utf8")) as PaperManifest;
const base = Object.values(actual.slots).find(slot => !slot.locked)!;
const text = (nodes: PaperNode[]): string => nodes.map(node => node.kind === "paragraph"
  ? node.segments.map(segment => segment.kind === "text" ? segment.text : "<input>").join("")
  : node.rows.flatMap(row => row.map(cell => text(cell.nodes))).join("")).join("");

describe("사업별 입력을 숨겨도 원본의 인쇄 표시는 남긴다", () => {
  it.each([
    { kind: "check", expect: "□ 전입지원 □ 출산지원", box: 0, boxShape: "square", printed: "□" },
    { kind: "check", expect: "[   ] 전입지원 [   ] 출산지원", box: 1, boxShape: "bracket", printed: "[   ]" },
    { kind: "inline", expect: "성명:     (인)", from: 3, to: 8, printed: "     " },
    { kind: "prefix", expect: "년    월", from: 0, to: 0, after: "년", printed: "" },
  ] as const)("$kind의 제외된 칸을 지우거나 다른 칸 입력으로 바꾸지 않는다", fixture => {
    const excluded = { ...base, ...fixture, id: "excluded", locked: undefined } as PaperSlot;
    const manifest: PaperManifest = { ...actual,
      slots: { keep: { ...base, id: "keep" }, excluded },
      programmeIds: ["g1.a", "g1.b"], programmeSlots: { "g1.a": ["keep"], "g1.b": ["excluded"] },
      blocks: [{ kind: "table", index: 0, colCount: 1, rows: [[{ row: 0, col: 0, rowSpan: 1, colSpan: 1, role: "entry",
        nodes: [{ kind: "paragraph", at: base.at, segments: [
          { kind: "text", text: "앞" }, { kind: "slot", id: "excluded" },
          { kind: "text", text: "뒤" }, { kind: "slot", id: "keep" },
        ] }],
      }]] }],
    };
    const before = JSON.stringify(manifest);
    const scoped = scopeManifestToProgram(manifest, "g1.a")!;
    expect(Object.keys(scoped.slots)).toEqual(["keep"]);
    expect(text(scoped.blocks)).toBe(`앞${fixture.printed}뒤<input>`);
    expect(JSON.stringify(manifest)).toBe(before);
    expect(scopeManifestToProgram(manifest, "g1.other")).toBeNull();
  });
});
