import { describe, expect, it } from "vitest";
import type { ApplicationForm, FormLink } from "@/lib/data/forms";
import type { Program } from "@/lib/data/types";
import registry from "@/lib/data/verifiedAgencyForms.json";
import { agencyProgramLinkMatches, registeredAgencyForm, sameFormJurisdiction, validateFormLink } from "@/lib/data/formPublication";

const id="agency-44210-health-cts2393-initial-voucher";
const e=registry.forms[id];
const program={id:"n.gov24-PTR000050390",scope:"national",region:null,url:e.programs[0].url,sources:[]} as unknown as Program;
const form=():ApplicationForm=>({id,title:e.title,role:"application",sourceKind:"agency",regionCode:e.regionCode,regionLabel:e.regionLabel,
  lawId:e.lawId,lawTitle:e.lawTitle,lawUrl:e.lawEvidenceUrl,annexId:"",annexNumber:"",sourceUrl:e.sourceUrl,fetchedAt:e.checkedAt,
  dateKind:"checked",effectiveDate:e.checkedAt,agency:{agencyName:e.agencyName,sourcePageUrl:e.sourcePageUrl,finalUrl:e.finalUrl,
    attachmentId:e.attachmentId,sha256:e.sha256,bytes:e.bytes,format:"hwp",checkedAt:e.checkedAt,authorityEvidenceUrl:e.authorityEvidenceUrl,authorityBasis:{...e.authorityBasis,kind:"official-program"}},
  file:{hwp:`/forms/files/${id}-${e.sha256.slice(0,12)}.hwp`,format:"hwp",bytes:e.bytes,sha256:e.sha256}});
const link=():FormLink=>({formId:id,use:"conditional",condition:e.condition,evidenceUrl:e.sourcePageUrl,evidenceNote:e.authorityEvidenceNote,
  programEvidenceUrl:e.programs[0].url,checkedAt:e.checkedAt,scopeBasis:"national-municipal-intake-reference",
  nationalMunicipalIntakeReference:structuredClone(e.nationalMunicipalIntakeReference) as NonNullable<FormLink["nationalMunicipalIntakeReference"]>});

describe("national programme with a reviewed optional municipal intake",()=>{
  it("keeps the original city jurisdiction and admits its exact source-bound route",()=>{
    expect(sameFormJurisdiction(program,form())).toBe(false);
    expect(registeredAgencyForm(id)).toBeTruthy();
    expect(agencyProgramLinkMatches(program.id,form(),link())).toBe(true);
    expect(()=>validateFormLink(program,form(),link())).not.toThrow();
    const beforeAssetEmission=form();delete beforeAssetEmission.file;
    expect(()=>validateFormLink(program,beforeAssetEmission,link())).not.toThrow();
  });
  it("does not accept the municipal source through the ordinary national path",()=>{
    const missing=link();delete missing.scopeBasis;delete missing.nationalMunicipalIntakeReference;
    expect(()=>validateFormLink(program,form(),missing)).toThrow();
    expect(()=>validateFormLink(program,form(),{...link(),use:"main"})).toThrow();
    expect(()=>validateFormLink({...program,scope:"sido",region:{sido:"44000",label:"충청남도"}},form(),link())).toThrow();
    expect(()=>validateFormLink({...program,id:"n.gov24-OTHER"},form(),link())).toThrow();
  });
  it("rejects malformed national regions including an empty object in both gate languages",()=>{
    for(const region of [{},[],false,"",0])
      expect(()=>validateFormLink({...program,region} as unknown as Program,form(),link())).toThrow();
  });
  it.each([
    {sigungu:"44200"},{municipality:"당진시"},{programmeId:"n.gov24-OTHER"},{sourceSHA256:"0".repeat(64)},
    {municipalPageSHA256:"1".repeat(64)},{municipalPageUrl:e.sourcePageUrl+"&other=1"},{downloadUrl:e.sourceUrl+"?other=1"},
    {stage:"refund"},{checkedAt:"2026-10-22"},{httpStatus:404},{populationEvidence:"미검토"},
    {sameServiceEvidence:"별도 검토되지 않은 서산시의 다른 지원 신청 용도를 설명하는 임의의 긴 문장입니다."},
  ])("rejects changed jurisdiction, stage or evidence: %j",changes=>{
    const altered=link();Object.assign(altered.nationalMunicipalIntakeReference!,changes);
    expect(()=>validateFormLink(program,form(),altered)).toThrow();
  });
  it("binds condition, programme evidence and file bytes as well as the reference",()=>{
    for(const changes of [{condition:"서산시 외 지역에서도 제출합니다."},{programEvidenceUrl:"https://www.gov.kr/portal/rcvfvrSvc/dtlEx/OTHER"},
      {scopeBasis:"municipal-application-reference" as const}]) expect(()=>validateFormLink(program,form(),{...link(),...changes})).toThrow();
    expect(()=>validateFormLink(program,{...form(),file:{...form().file!,sha256:"2".repeat(64)}},link())).toThrow();
    const extra=link();Object.assign(extra.nationalMunicipalIntakeReference!,{coordinatorApproved:true});
    expect(()=>validateFormLink(program,form(),extra)).toThrow();
  });
  it("rejects a forged page digest even when both the link and registry reference change",()=>{
    const stored=e.nationalMunicipalIntakeReference.municipalPageSHA256;
    try {
      e.nationalMunicipalIntakeReference.municipalPageSHA256="3".repeat(64);
      expect(registeredAgencyForm(id)).toBeNull();
      expect(()=>validateFormLink(program,form(),link())).toThrow();
    } finally { e.nationalMunicipalIntakeReference.municipalPageSHA256=stored; }
  });
});
