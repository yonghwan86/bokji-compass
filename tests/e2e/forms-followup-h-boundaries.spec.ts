import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

// 기대 SHA·용도·제목은 승인 시 고정한 15원본/16관계의 정적 검토값이다.
const samples = [
  {
    "program": "g41480.gov24-406000000102",
    "form": "ordin-20589281",
    "sha256": "27a18064215adb1a12ca5239a277cb8cb1a2f76a3c7908dbf932cec7b8401990",
    "bytes": 94840,
    "format": "hwpx",
    "heading": "파주시 출생축하금 최초 신청 부분 · 통합서식",
    "conditionFragment": "최초 신청",
    "municipality": null,
    "writable": false
  },
  {
    "program": "g41480.bokjiro-WLF00001658",
    "form": "ordin-20589281",
    "sha256": "27a18064215adb1a12ca5239a277cb8cb1a2f76a3c7908dbf932cec7b8401990",
    "bytes": 94840,
    "format": "hwpx",
    "heading": "파주시 출생축하금 최초 신청 부분 · 통합서식",
    "conditionFragment": "최초 신청",
    "municipality": null,
    "writable": false
  },
  {
    "program": "g51770.bokjiro-WLF00006371",
    "form": "ordin-21184717",
    "sha256": "256bbe9a374517c2a7379d20f652da70e22877888f263518f80918a1f0415b0f",
    "bytes": 49152,
    "format": "hwp",
    "heading": "정선군 결혼장려금 지원 이행서약서",
    "conditionFragment": "부부가 모두",
    "municipality": null,
    "writable": true
  },
  {
    "program": "g11215.gov24-304000000236",
    "form": "ordin-22425545",
    "sha256": "6c0773a9cdb1fa6e1d51a49bfede485dd863142c2b05fc3fb6092d62a615c7df",
    "bytes": 46484,
    "format": "hwpx",
    "heading": "2026 회차자료 · 접수종료(6.29~7.22) — 인문학 강좌 수강료 감면·반환 신청서",
    "conditionFragment": "20,000원",
    "municipality": null,
    "writable": false
  },
  {
    "program": "g51170.gov24-421000000638",
    "form": "ordin-19859351",
    "sha256": "edcd9c693939aa6a9ced5850205899ff83b14fd10cdfffa2265b9ec699537b74",
    "bytes": 48640,
    "format": "hwp",
    "heading": "지류 등록 가맹점의 동해사랑상품권 환전 청구서",
    "conditionFragment": "지류형",
    "municipality": null,
    "writable": false
  },
  {
    "program": "g41610.gov24-554000000158",
    "form": "ordin-22282177",
    "sha256": "2129a6988fb231bf180d5b4ad537edd2d82e91cf5900b360ef2029f7e4eef29b",
    "bytes": 12288,
    "format": "hwp",
    "heading": "자연채 포장재 사용신청서",
    "conditionFragment": "50%",
    "municipality": null,
    "writable": false
  },
  {
    "program": "g41830.gov24-417000000101",
    "form": "ordin-19976627",
    "sha256": "9b711e559913fd9d4b80143320c71681dfe82243c11d180120b67d7da2fa7795",
    "bytes": 30720,
    "format": "hwp",
    "heading": "군립어린이집 입소 절차용 신청서 · 준비금 청구와 별도",
    "conditionFragment": "군립어린이집",
    "municipality": null,
    "writable": false
  },
  {
    "program": "g51760.gov24-O00002700004",
    "form": "ordin-21934315",
    "sha256": "cc4395b5fc3dbfb998035293ee8e776379b40461bb812bc3529916998142e86e",
    "bytes": 50688,
    "format": "hwp",
    "heading": "기존 15년 허가 장사시설의 사용허가 변경 신청서",
    "conditionFragment": "15년",
    "municipality": null,
    "writable": true
  },
  {
    "program": "g48310.gov24-537000000125",
    "form": "agency-48310-geoje-payment-238389",
    "sha256": "b978745ab400d7aac11bf2f9bd4ce99355de607355357ef7fcf82af664631e3d",
    "bytes": 38400,
    "format": "hwp",
    "heading": "2026 회차자료 · 접수종료(4.6~4.10) — 고등학교 우수 장학금 지급 신청서",
    "conditionFragment": "2026",
    "municipality": null,
    "writable": false
  },
  {
    "program": "g48310.gov24-537000000125",
    "form": "agency-48310-geoje-payment-238390",
    "sha256": "a2191e6b92053baeae8aa09c9ddbf1ec378992c8d49e3bb5be23eb6868ed0da4",
    "bytes": 38400,
    "format": "hwp",
    "heading": "2026 회차자료 · 접수종료(4.6~4.10) — 대학교 입학 우수 장학금 지급 신청서",
    "conditionFragment": "2026",
    "municipality": null,
    "writable": false
  },
  {
    "program": "g43745.bokjiro-WLF00003002",
    "form": "agency-43745-gazette825-independent-14",
    "sha256": "ba6d5ce8245e005bac71e369a8933a5f7fe2243942f12283bcd141015a83a3ee",
    "bytes": 415730,
    "format": "pdf",
    "heading": "독립유공자 보훈명예수당 지급 신청(변경신고)서 — 증평군보 제825호 14쪽",
    "conditionFragment": "14쪽",
    "municipality": null,
    "writable": false
  },
  {
    "program": "g44810.bokjiro-WLF00006603",
    "form": "agency-44810-yesan-postpartum-36547",
    "sha256": "9ad606e8ce71741d2d094325c5b9acd164f2fc18808a4bacf65ca3556d0162c9",
    "bytes": 54521,
    "format": "hwpx",
    "heading": "산후조리 비용 지원 신청서",
    "conditionFragment": "200만원",
    "municipality": null,
    "writable": false
  },
  {
    "program": "s47000.bokjiro-WLF00003658",
    "form": "agency-47000-bokjiro-wlf00003658-20260713-1",
    "sha256": "0058363ddb46393e957f4a4ed1c4d807fee8baab40ac783ddfcaa89022a62026",
    "bytes": 364718,
    "format": "pdf",
    "heading": "2026년 산모신생아 본인부담금 지원 안내·서식 — 서비스 해지 통보서(15쪽)",
    "conditionFragment": "15쪽",
    "municipality": null,
    "writable": false
  },
  {
    "program": "n.gov24-PTR000050390",
    "form": "agency-44210-health-cts2393-initial-voucher",
    "sha256": "369b21f72eae53a8d7bee4c7292e915d488cd76733e3fe9cc30778081cc21d39",
    "bytes": 108032,
    "format": "hwp",
    "heading": "서산시 보건소 접수용 산모·신생아 건강관리 이용권 신청서",
    "conditionFragment": "서산시보건소",
    "municipality": "서산시",
    "writable": false
  },
  {
    "program": "n.gov24-PTR000050390",
    "form": "rule-3211501",
    "sha256": "f922a89ff89c09bfb6325d493d03104bdc23c123fc1c4b469bfc77bb1597bde1",
    "bytes": 41935,
    "format": "hwpx",
    "heading": "사회보장급여(사회서비스이용권) 신청(변경)서",
    "conditionFragment": "30일",
    "municipality": null,
    "writable": true
  },
  {
    "program": "n.gov24-PTR000050390",
    "form": "rule-3249997",
    "sha256": "0a23cbf184e7bf01e088ede8eab4b8cb32948250cc9a322890460a80e5c753ba",
    "bytes": 39280,
    "format": "hwpx",
    "heading": "임신서비스 통합처리 신청서",
    "conditionFragment": "40일",
    "municipality": null,
    "writable": false
  }
] as const;
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const national="n.gov24-PTR000050390";
const seosan=samples.find(sample=>sample.municipality)!;
const asset=(sample:(typeof samples)[number])=>`/forms/files/${sample.form}-${sample.sha256.slice(0,12)}.${sample.format}`;
for(const sample of samples) test(`H exact original ${sample.program} / ${sample.form} @mobile`,async({page})=>{
  await page.goto(`/p/${sample.program}`);
  const panel=page.getByTestId("application-forms");
  if(sample.municipality) await panel.getByLabel("신청할 시·군·구").selectOption({label:sample.municipality});
  const button=panel.locator(`a[download][href="${asset(sample)}"]`);
  await expect(button).toBeVisible();
  const card=button.locator("xpath=ancestor::li[1]");
  await expect(card.getByRole("heading",{name:sample.heading,exact:true})).toBeVisible();
  await expect(card).toContainText(sample.conditionFragment);
  await expect(card.locator('a[href^="/forms/write/"]')).toHaveCount(sample.writable?1:0);
  const [download]=await Promise.all([page.waitForEvent("download"),button.click()]);
  expect(download.suggestedFilename()).toBe(sample.heading+"."+sample.format);
  const file=await download.path();expect(file).toBeTruthy();const bytes=readFileSync(file!);
  expect(bytes.length).toBe(sample.bytes);expect(hash(bytes)).toBe(sample.sha256);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("H national common forms remain visible and one city alternative requires selection @mobile",async({page})=>{
  await page.goto(`/p/${national}`);const panel=page.getByTestId("application-forms");
  const picker=panel.getByLabel("신청할 시·군·구");await expect(picker).toHaveValue("");
  const common=samples.filter(sample=>sample.program===national&&!sample.municipality);
  for(const sample of common) await expect(panel.locator(`a[download][href="${asset(sample)}"]`)).toBeVisible();
  await expect(panel.locator(`a[download][href="${asset(seosan)}"]`)).toHaveCount(0);
  await picker.selectOption({label:"서산시"});
  await expect(panel.getByText("서산시 접수용 (선택)",{exact:true})).toBeVisible();
  await expect(panel.locator(`a[download][href="${asset(seosan)}"]`)).toBeVisible();
  for(const sample of common) await expect(panel.locator(`a[download][href="${asset(sample)}"]`)).toBeVisible();
  await picker.selectOption("");await expect(panel.locator(`a[download][href="${asset(seosan)}"]`)).toHaveCount(0);
  await expect(panel.locator('a[download][href*="ordin-22392705"]')).toHaveCount(0);
});

test("H valid15year permit writer preserves source and fills only chosen name and address @mobile",async({page},info)=>{
  const sample=samples.find(sample=>sample.form==="ordin-21934315")!;
  await page.goto(`/forms/write/${sample.form}?program=${sample.program}`);
  await expect(page.getByTestId("paper-writer")).toBeVisible();
  await expect(page.getByTestId("paper-writer")).toContainText("15년");
  await page.getByTestId("paper-input-0/0/1/6/0").fill("홍길동");
  await page.getByTestId("paper-input-0/0/1/3/0").fill("가상주소");
  const [download]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:/내려받기.*HWPX/}).first().click()]);
  const directory="logs/forms-followup-20261023h/root/filled";mkdirSync(directory,{recursive:true});
  const output=`${directory}/${info.project.name}-${sample.form}.hwpx`;await download.saveAs(output);
  const manifest=JSON.parse(readFileSync(`public/forms/writing/v1/manifest/${sample.form}.json`,"utf8"));
  const before=unzipSync(readFileSync(`public${manifest.asset.path}`)),after=unzipSync(readFileSync(output));
  const oldXml=strFromU8(before["Contents/section0.xml"]),newXml=strFromU8(after["Contents/section0.xml"]);
  expect(oldXml).not.toContain("홍길동");expect(newXml).toContain("홍길동");expect(newXml).toContain("가상주소");
  expect(newXml).toContain("(15년)");
  for(const key of Object.keys(before).filter(key=>!/^Contents\/section/.test(key)&&key!=="Preview/PrvText.txt"&&key!=="Preview/PrvImage.png")) expect(after[key]).toEqual(before[key]);
  expect(hash(readFileSync(`public${asset(sample)}`))).toBe(sample.sha256);
});
