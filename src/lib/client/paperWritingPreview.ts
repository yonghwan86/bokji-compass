/**
 * 변환 HWPX의 `Preview/PrvText.txt`를 완성된 본문에서 다시 만든다.
 *
 * 한글이 넣어 둔 미리보기 글은 본문을 줄 단위로 풀어 쓴 것이다. 관찰한 규칙:
 * - 표 밖 본문 문단은 글자가 있을 때만 그 글자 한 줄로 나온다.
 * - 표는 각 줄의 칸 글자를 `<...>`로 감싸 이어 붙이고, 세로로 합쳐진 칸이 끝나는 줄에서 끊는다.
 * - 한 칸에 여러 문단이 있으면 공백 하나로 잇는다.
 * - 표 안의 표는 담고 있는 표의 줄들이 모두 끝난 뒤, 칸 차례대로 이어서 나온다.
 * - 각 줄 끝에 `\r\n`이 붙는다.
 *
 * 이 규칙이 그 서식의 빈 원본 미리보기를 그대로 재현하는지는 컴파일할 때 확인하고
 * manifest의 `preview.exact`에 남긴다. 재현하지 못하는 서식이라도, 완성 파일에는
 * **완성된 본문에서 만든 글**을 넣어 낡은 빈 원본 미리보기가 남지 않게 한다.
 */
import type { SectionIndex, TableIndex } from "./hwpxXml";

function tableLines(index: SectionIndex, tableIndex: number, out: string[]): void {
  const table: TableIndex | undefined = index.tables[tableIndex];
  if (!table) return;
  let buffer = "";
  let groupEnd = 0;
  table.rows.forEach((row, rowIndex) => {
    let span = 1;
    for (const cell of row) {
      span = Math.max(span, cell.rowSpan);
      buffer += `<${cell.paragraphs.map(paragraph => paragraph.text).join(" ")}>`;
    }
    groupEnd = Math.max(groupEnd, rowIndex + span);
    if (rowIndex + 1 >= groupEnd) {
      out.push(buffer);
      buffer = "";
    }
  });
  if (buffer) out.push(buffer);
  // 표 안의 표 — 담고 있는 표의 줄이 끝난 뒤 칸 차례대로.
  index.tables.forEach((nested, nestedIndex) => {
    if (nested.host?.kind === "cell" && nested.host.table === tableIndex) tableLines(index, nestedIndex, out);
  });
}

/** 한 섹션이 미리보기 글에 보태는 줄들. */
export function paperPreviewLines(index: SectionIndex): string[] {
  const out: string[] = [];
  index.body.forEach((paragraph, paragraphIndex) => {
    if (paragraph.text !== "") out.push(paragraph.text);
    index.tables.forEach((table, tableIndex) => {
      if (table.host?.kind === "body" && table.host.p === paragraphIndex) tableLines(index, tableIndex, out);
    });
  });
  // 담고 있는 문단을 찾지 못한 표(글상자 안 등)는 마지막에 붙인다.
  index.tables.forEach((table, tableIndex) => {
    if (table.host === null) tableLines(index, tableIndex, out);
  });
  return out;
}

/**
 * 여러 섹션의 미리보기 글. `limit`이 있으면 원본이 잘려 있던 길이에서 똑같이 끊고,
 * 칸이 닫히지 않았으면 `>`로 닫는다.
 */
export function buildPaperPreviewText(sections: SectionIndex[], limit: number | null): string {
  const lines = sections.flatMap(paperPreviewLines);
  const full = lines.map(line => `${line}\r\n`).join("");
  if (limit === null || full.length <= limit) return full;
  const cut = full.slice(0, limit);
  const lastOpen = cut.lastIndexOf("<");
  const lastClose = cut.lastIndexOf(">");
  return lastOpen > lastClose ? cut.slice(0, -1) + ">" : cut;
}
