import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detailBucket } from "@/lib/data/bucket";
import scopes from "@/lib/data/paperWritingScopes.json";
import { paperFieldError, scopeManifestToProgram, validPaperManifest } from "@/lib/client/paperWriting";
import type { PaperManifest } from "@/lib/data/paperWritingTypes";

const read = (address: string) => JSON.parse(readFileSync(`public${address}`, "utf8"));

describe("새로 검토한 작성 범위의 실제 공개 자료", () => {
  it("모든 사업의 정확한 원본·변환본·입력 목록을 유지하고 유효한 날짜를 담을 수 있다", () => {
    for (const [formId, scope] of Object.entries(scopes.forms)) {
      const manifest = read(`/forms/writing/v1/manifest/${formId}.json`) as PaperManifest;
      expect(validPaperManifest(manifest, formId), formId).toBeTruthy();
      expect(manifest.source.sha256).toBe(scope.sourceSHA256);
      expect(manifest.asset.sha256).toBe(scope.assetSHA256);
      expect(manifest.programmeSlots).toEqual(scope.programmes);
      for (const [program, ids] of Object.entries(scope.programmes)) {
        const selected = scopeManifestToProgram(manifest, program)!;
        expect(Object.keys(selected.slots).filter(id => !selected.slots[id].locked).sort()).toEqual([...ids].sort());
        for (const id of ids) {
          const slot = selected.slots[id];
          if (slot.token) expect(paperFieldError(slot, slot.token === "년" ? "2026" : slot.token === "월" ? "12" : "31"), `${formId}/${id}`).toBeNull();
        }
      }
    }
  }, 20000);

  it("동두천 화장장려금은 인적사항을 열고 좁은 날짜칸은 직접 작성하도록 둔다", () => {
    const manifest = read("/forms/writing/v1/manifest/agency-41250-bok-20260617UUWBM1624260197448245-1.json") as PaperManifest;
    expect(manifest.source.sha256).toBe("8cd90bca5d9c8dcbf2c9c59128cbc5f064923479ee7e11814bef36dde84a61e4");
    expect(manifest.slots["0/0/0/2/0"].label).toBe("성 명");
    for (const id of ["0/0/13/0/2#i0", "0/0/13/0/2#i2", "0/0/13/0/2#i6"]) expect(manifest.slots[id]).toBeUndefined();
  });

  it("날짜만 열린 좁은 서식은 작성 대상으로 세지 않고 검증 HWPX 다운로드는 유지한다", () => {
    const index = read("/forms/writing/v1/index.json");
    for (const id of ["ordin-19437609", "ordin-20377219", "ordin-20864925", "ordin-21184325", "ordin-21211099", "ordin-21446321"]) {
      expect(index.formIds).not.toContain(id);
      expect(read(`/forms/writing/v1/downloads/${detailBucket(id)}.json`).forms[id].metadataSanitized).toBe(true);
    }
  });
});
