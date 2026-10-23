import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Program } from "@/lib/data/types";
import type { ApplicationForm, FormLink } from "@/lib/data/forms";
import { validateFormLink, statutoryApplicationMatches } from "@/lib/data/formPublication";
import { withStatutoryOriginalIdentity } from "../../scripts/build-forms";
import registry from "@/lib/data/verifiedStatutoryApplications.json";

const ENTRY = registry.applications["ulju-maternal-voucher-initial"];
const ORIGINAL = path.join(process.cwd(), "public/forms/files/rule-3211501-f922a89ff89c.hwpx");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const program = {
  id: ENTRY.programmeId, name: "산모·신생아 건강관리사 지원", scope: "sigungu",
  laws: [ENTRY.citedLawTitle, "모자보건법"],
  region: { sido: "31000", sigungu: "31710", label: "울산광역시 울주군" },
  url: ENTRY.programmeUrl, sources: [{ url: ENTRY.programmeUrl }],
} as unknown as Program;

const form: ApplicationForm = {
  id: "rule-3211501", title: "사회보장급여(사회서비스이용권) 신청(변경)서", role: "application",
  sourceKind: "rule", lawId: ENTRY.lawId, lawTitle: ENTRY.referencedLawTitle,
  annexId: "3211501", annexNumber: ENTRY.annexNumber, regionCode: "national", regionLabel: "전국 공통",
  effectiveDate: ENTRY.sourceEffectiveDate, sourceUrl: ENTRY.sourceUrl,
  lawUrl: "https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000278060", fetchedAt: "2026-10-23",
  file: { hwp: "/forms/files/rule-3211501-f922a89ff89c.hwpx", format: "hwpx",
    bytes: ENTRY.sourceBytes, sha256: ENTRY.sourceSHA256 },
};

const link: FormLink = {
  formId: "rule-3211501", use: "main", checkedAt: ENTRY.checkedAt,
  evidenceUrl: ENTRY.programmeUrl, programEvidenceUrl: ENTRY.programmeUrl,
  evidenceNote: "정부24 사업과 울주군보건소 안내를 대조했습니다.",
  condition: ENTRY.condition,
  scopeBasis: "official-application-reference",
  scopeReference: { kind: "statutory-chain", referenceId: ENTRY.referenceId,
    referencedLawTitle: ENTRY.referencedLawTitle, annexNumber: ENTRY.annexNumber,
    sourceSHA256: ENTRY.sourceSHA256,
    basis: "사업이 인용한 이용권법 제9조에서 시행규칙 제3조제1항을 거쳐 공통고시 제5조가 이 별지를 직접 특정합니다." },
};

describe("statutory application reference", () => {
  it("binds the registered digest to the real published original bytes", () => {
    const bytes = readFileSync(ORIGINAL);
    expect(hash(bytes)).toBe(ENTRY.sourceSHA256);
    expect(bytes.length).toBe(ENTRY.sourceBytes);
  });

  it("accepts the reviewed Ulju maternal voucher chain", () => {
    expect(() => validateFormLink(program, form, link)).not.toThrow();
  });

  it("rejects another programme, city or scope", () => {
    expect(() => validateFormLink({ ...program, id: "g31710.gov24-OTHER" } as Program, form, link)).toThrow();
    expect(() => validateFormLink({ ...program, region: { sido: "31000", sigungu: "31200", label: "남구" } } as Program, form, link)).toThrow();
    expect(() => validateFormLink({ ...program, scope: "national", region: undefined } as unknown as Program, form, link)).toThrow();
  });

  it("rejects removing the actual cited act from the same programme", () => {
    for (const laws of [undefined, [], ["모자보건법"]])
      expect(() => validateFormLink({ ...program, laws } as Program, form, link)).toThrow();
  });

  it("rejects the same city's refund or housekeeping purpose and another effective day", () => {
    for (const condition of ["울주군", "울주군 본인부담금 현금 환급과 임산부 가사돌봄서비스의 변경 신청에 사용하는 서식입니다."]) {
      expect(() => validateFormLink(program, form, { ...link, condition })).toThrow();
      expect(statutoryApplicationMatches(program.id, form, { ...link, condition })).toBe(false);
    }
    const changed = { ...form, effectiveDate: "2026-07-01" };
    expect(() => validateFormLink(program, changed, link)).toThrow();
    expect(statutoryApplicationMatches(program.id, changed, link)).toBe(false);
  });

  it("requires current dates, evidence digests and exact legal URLs for every chain step", () => {
    const applications = registry.applications as unknown as Record<string, Record<string, unknown>>;
    const original = applications[ENTRY.referenceId];
    try {
      for (let index = 0; index < 3; index += 1) {
        for (const [key, value] of [["currentState", "prior"], ["checkedAt", "2026-10-22"], ["effectiveDate", "2027-01-01"],
          ["evidenceSHA256", "missing"], ["currentIdentityEvidenceSHA256", "missing"],
          ["url", ENTRY.chain[index].url.replace(ENTRY.chain[index].lawId, "1")]]) {
          const entry = structuredClone(ENTRY) as unknown as Record<string, unknown>;
          (entry.chain as Record<string, unknown>[])[index][key] = value;
          applications[ENTRY.referenceId] = entry;
          expect(() => validateFormLink(program, form, link)).toThrow();
        }
      }
      const entry = structuredClone(ENTRY);
      entry.chain[0].url = entry.chain[0].url.replace("joNo=0009", "joNo=0008");
      applications[ENTRY.referenceId] = entry as unknown as Record<string, unknown>;
      expect(() => validateFormLink(program, form, link)).toThrow();
      for (const suffix of ["&joNo=", "&joNo=0009", "&lsiSeq=", "&lsiSeq=257855"]) {
        const duplicate = structuredClone(ENTRY);
        duplicate.chain[0].url += suffix;
        applications[ENTRY.referenceId] = duplicate as unknown as Record<string, unknown>;
        expect(() => validateFormLink(program, form, link)).toThrow();
      }
    } finally { applications[ENTRY.referenceId] = original; }
  });

  it("rejects another form, annex, cited act or source url", () => {
    expect(() => validateFormLink(program, { ...form, id: "rule-3211497" }, { ...link, formId: "rule-3211497" })).toThrow();
    expect(() => validateFormLink(program, { ...form, annexNumber: "000103" },
      { ...link, scopeReference: { ...link.scopeReference!, annexNumber: "000103" } })).toThrow();
    expect(() => validateFormLink(program, { ...form, lawTitle: "사회보장급여의 이용·제공 및 수급권자 발굴에 관한 법률" }, link)).toThrow();
    expect(() => validateFormLink(program, { ...form, sourceUrl: "https://www.law.go.kr/LSW/flDownload.do?flSeq=1" }, link)).toThrow();
  });

  it("rejects a changed or missing original digest", () => {
    expect(() => validateFormLink(program, { ...form, file: { ...form.file!, sha256: "0".repeat(64) } }, link)).toThrow();
    expect(() => validateFormLink(program, { ...form, file: { ...form.file!, bytes: 1 } }, link)).toThrow();
    expect(() => validateFormLink(program, { ...form, file: undefined }, link)).toThrow();
    expect(() => validateFormLink(program, form,
      { ...link, scopeReference: { ...link.scopeReference!, sourceSHA256: "0".repeat(64) } })).toThrow();
  });

  it("rejects an unknown reference id, an opaque approval field and a wrong day", () => {
    expect(() => validateFormLink(program, form,
      { ...link, scopeReference: { ...link.scopeReference!, referenceId: "goyang-maternal" } })).toThrow();
    expect(() => validateFormLink(program, form,
      { ...link, scopeReference: { ...link.scopeReference!, coordinatorApproved: true } as never })).toThrow();
    expect(() => validateFormLink(program, form, { ...link, checkedAt: "2026-10-22" })).toThrow();
  });

  it("rejects a condition that does not name the city and evidence that is not the programme page", () => {
    expect(() => validateFormLink(program, form, { ...link, condition: "산모 바우처 초기 신청에 씁니다." })).toThrow();
    expect(() => validateFormLink(program, form, { ...link, evidenceUrl: form.lawUrl })).toThrow();
    expect(() => validateFormLink(program, form, { ...link, programEvidenceUrl: form.lawUrl })).toThrow();
  });

  it("keeps the two older reference kinds working as before", () => {
    const documents: FormLink = { ...link, scopeReference: { kind: "program-documents",
      referencedLawTitle: ENTRY.referencedLawTitle, annexNumber: ENTRY.annexNumber,
      basis: "사업 안내가 이 서식을 구비서류로 직접 적고 있어 원문과 대조했습니다." } };
    expect(() => validateFormLink(program, form, documents)).not.toThrow();
    expect(statutoryApplicationMatches(program.id, form, documents)).toBe(false);
  });

  it("lets the client reject a downloaded form whose bytes no longer match", () => {
    expect(statutoryApplicationMatches(program.id, form, link)).toBe(true);
    expect(statutoryApplicationMatches("g31710.gov24-OTHER", form, link)).toBe(false);
    expect(statutoryApplicationMatches(program.id, { ...form, file: { ...form.file!, sha256: "0".repeat(64) } }, link)).toBe(false);
    expect(statutoryApplicationMatches(program.id, undefined, link)).toBe(false);
  });

  it("derives the pre-emission file identity only for this route and only from stored bytes", () => {
    const bytes = readFileSync(ORIGINAL);
    const originals = new Map([["rule-3211501", { bytes, format: "hwpx" as const }]]);
    const raw = { ...form, file: undefined };
    const filled = withStatutoryOriginalIdentity(raw, link, originals, hash)!;
    expect(filled.file).toEqual({ hwp: "/forms/files/rule-3211501-f922a89ff89c.hwpx", format: "hwpx",
      bytes: ENTRY.sourceBytes, sha256: ENTRY.sourceSHA256 });
    expect(() => validateFormLink(program, filled, link)).not.toThrow();
    // 다른 경로의 링크에는 손대지 않는다.
    const other = { ...link, scopeReference: { ...link.scopeReference!, kind: "program-documents" as const } };
    expect(withStatutoryOriginalIdentity(raw, other, originals, hash)!.file).toBeUndefined();
    // 이미 방출된 식별자는 덮어쓰지 않는다.
    expect(withStatutoryOriginalIdentity(form, link, originals, hash)!.file).toBe(form.file);
    // 받아 둔 원본이 없으면 그대로 두고, SHA 검증은 그대로 실패한다.
    expect(withStatutoryOriginalIdentity(raw, link, new Map(), hash)!.file).toBeUndefined();
  });
});
