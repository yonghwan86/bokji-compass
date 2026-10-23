import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const exactFiles = [
  {
    program: "g43110.gov24-571000000197", form: "ordin-21714439",
    title: "학습비 면제 신청서", format: "hwp",
    bytes: 15872, sha256: "c09381d0b67b0ea52a3fc6eafea066f303d9a59c12c725079fb671cc9c071d50",
    condition: "해당 교육 종료 전", excluded: ["ordin-21714441"], writable: true,
  },
  {
    program: "s47000.bokjiro-WLF00004401", form: "agency-47000-bokjiro-wlf00004401-allowance-application",
    title: "경상북도 의사상자 특별위로금·수당지급 신청서", format: "hwp",
    bytes: 15872, sha256: "6402b5bea3df64d266234775f15b05d8dc76c4098391a0c6ae1e73bc9601d552",
    condition: "의사자 유족 월10만원", excluded: ["ordin-22706053"], writable: false,
  },
  {
    program: "g47230.bokjiro-WLF00004929", form: "agency-47230-health-kit-080701",
    title: "임신준비 키트 지원 신청서", format: "hwp",
    bytes: 102912, sha256: "f1e5886e5e39ead2ffe928b62b24b32607a52af14a0bf2f5cdafa65966329005",
    condition: "1가구당 1회", excluded: ["ordin-17542133"], writable: true,
  },
  {
    program: "g11215.gov24-304000000233", form: "ordin-22425515",
    title: "배우자 복지수당 대리 수령 신청서<신설 2025.7.28.>", format: "hwpx",
    bytes: 59139, sha256: "3759d8f21c50aaa43b5960021da8b6a874acf6fdde2caa017dbe36ae792d2909",
    condition: "대리인 계좌 수령", excluded: ["ordin-22425553"], writable: false,
  },
  {
    program: "g51130.gov24-419000000129", form: "ordin-22498207",
    title: "원주사랑상품권 환전 청구서", format: "hwp",
    bytes: 36352, sha256: "914df6e674262f770d618cad658293179b27a6963bd230737a75a6d37094d3c9",
    condition: "등록가맹점이 실제 물품 판매나 용역 제공으로 받은 지류", excluded: [], writable: false,
  },
  {
    program: "g26110.bokjiro-WLF00006649", form: "agency-26110-bokjiro-wlf00006649-20260720-1",
    title: "출산서비스 통합처리 신청서(중구) — 2025.10.1. 이후 출생아 출산축하금", format: "hwp",
    bytes: 119808, sha256: "6caa2fb4b460d4b841be849958f2af44e251be1eddbed48a9d219ddff03b7afb",
    condition: "2025년 10월 1일 이후 태어나", excluded: ["ordin-21161135"], writable: false,
  },
  {
    program: "g11215.gov24-304000000105", form: "ordin-18989767",
    title: "광진구 장애인 양육지원금 통합신청서(출생신고 시)", format: "hwpx",
    bytes: 89277, sha256: "7964c66ed5e1fbccd0c220afd57f4244eeb5ec659637b6a133c599d4b5116057",
    condition: "출생신고와 함께 출산서비스를 통합신청할 때", excluded: [], writable: false,
  },
  {
    program: "g44270.gov24-568000000105", form: "ordin-21685783",
    title: "당진시 중증장애아동 건강지원 신청·변경서(건강음료)", format: "hwp",
    bytes: 21504, sha256: "c6713e5df348d8103c5b3a294fa8f61ae9ba0ee0cdecd1390379eb1987f6557c",
    condition: "자동지원 중인 모든 가구가 이 서식을 새로 제출해야 한다는 뜻은 아닙니다", excluded: [], writable: false,
  },
  {
    program: "g44270.gov24-568000000105", form: "ordin-21685785",
    title: "당진시 중증장애아동 건강지원 금융정보 제공 동의서", format: "hwp",
    bytes: 27648, sha256: "75f0574b032abacabad0685540a11eafa036724c7359dc54132dcdf5a3b1e553",
    condition: "일반 자동지원 가구 전원에게 새로 금융동의를 요구하거나", excluded: [], writable: true,
  },
  {
    program: "g44250.gov24-558000000116", form: "ordin-15092343",
    title: "계룡시 생활안정 특별지원 신청·변경서(월동·건강·교육)", format: "hwp",
    bytes: 30720, sha256: "2d0964c9d36fb0c7c8aba2cce47a72d5b1706dbd8e421c46b79e97a6b918ee82",
    condition: "월동대책비·건강증진보조비·교육활동지원비", excluded: [], writable: false,
  },
  {
    program: "g41650.gov24-560000000105", form: "ordin-18291051",
    title: "포천시 장수수당 미지급 청구서", format: "hwp",
    bytes: 32768, sha256: "7e8d073e336ce00a0b22b197dfaecc42742d8c5852bcb76da9e9b10405001e0c",
    condition: "일반 장수수당 신규 신청이나 모든 상속인의 승계 신청으로 확대하지 않습니다", excluded: [], writable: true,
  },
  {
    program: "g41130.gov24-378000000137", form: "ordin-20004411",
    title: "성남시 아동의료비 지원금 지급계좌 변경 신청서", format: "hwp",
    bytes: 76288, sha256: "1f6567f2bceb85cd84f1849222f354f32922c1cadf60374455b1daea20cd39e1",
    condition: "사망·파산·압류 등 부득이한 사유", excluded: [], writable: true,
  },
  {
    program: "g41130.gov24-378000000137", form: "ordin-20004423",
    title: "성남시 아동의료비 지원금 상속대표 합의 동의서", format: "hwp",
    bytes: 14336, sha256: "13354e643ec9ecac326ca7d29d68fa2bd1919f10e75f4a5552342a404e5ef390",
    condition: "상속대표", excluded: [], writable: true,
  },
  {
    program: "s30000.gov24-630000000660", form: "ordin-22337089",
    title: "대전 다자녀 수도요금 감면 신청서(서식 모음 중 제21호)", format: "hwpx",
    bytes: 256473, sha256: "498d5b69f13835160ba157e1f80858a695d227e4417dc0241737796b564d8221",
    condition: "18세를 넘은 자녀도 포함", excluded: [], writable: false,
  },
  {
    program: "g12850.bokjiro-WLF00004578", form: "ordin-22371299",
    title: "완도군 출산장려금 통합신청서(별지 제1호)", format: "hwp",
    bytes: 30208, sha256: "49b5991d6753869d07b09067f5108d9359e405aca330073bc42cc4f597157ee7",
    condition: "양부 또는 양모를 포함합니다", excluded: [], writable: false,
  },
  {
    program: "g12850.bokjiro-WLF00000233", form: "ordin-22371301",
    title: "완도군 둘째아 이상 돌맞이 축하금 신청서", format: "hwpx",
    bytes: 55136, sha256: "64ee7db80102b2e8058b39e981b3dc35ca07575221f451bd1d6350b6f928e25c",
    condition: "출생신고를 한 뒤 1년이 지난 시점부터 60일", excluded: [], writable: false,
  },
  {
    program: "g41310.gov24-O00005100001", form: "ordin-13732705",
    title: "구리시 체육시설 전용사용 변경허가 신청서(기존 허가 행사)", format: "hwp",
    bytes: 14336, sha256: "43f7375af96a950e56400412361c62e65c4960d26040a800d3aed78672a83b06",
    condition: "이미 전용사용 허가받은 경기·행사", excluded: [], writable: false,
  },
  {
    program: "s11000.gov24-611000000174", form: "ordin-22876359",
    title: "서울시 수용가 수질검사 신청서(수도사업소 제출)", format: "hwp",
    bytes: 36868, sha256: "912ba7b4bcce0ee9a3fe01ab15b223281bf97b60066e135eef4a369d34e020ea",
    condition: "전화·온라인 신청자에게 이 종이서식을 추가로 반드시 제출", excluded: [], writable: false,
  },
  {
    program: "g51130.gov24-419000000129", form: "ordin-22498211",
    title: "원주사랑상품권 개인 지류 현금할인구매 신청서", format: "hwp",
    bytes: 48640, sha256: "8018eecb694d4c1ccd89aae3ed9f62825f45d006c92d7094e39c3e1e8ea4733d",
    condition: "법인", excluded: [], writable: false,
  },
  {
    program: "g12740.gov24-488000000129", form: "ordin-22321711",
    title: "고흥군 출산장려금 통합신청서(지자체 기재 확인)", format: "hwpx",
    bytes: 97750, sha256: "852577bd8fa941dce0b78aee814b339864f3b8d376024fb8040465b39732cd8b",
    condition: "첫째", excluded: [], writable: false,
  },
  {
    program: "g12740.gov24-488000000107", form: "ordin-22321711",
    title: "고흥군 산모건강회복비 통합신청서(지자체 기재 확인)", format: "hwpx",
    bytes: 97750, sha256: "852577bd8fa941dce0b78aee814b339864f3b8d376024fb8040465b39732cd8b",
    condition: "분만당1회", excluded: [], writable: false,
  },
  {
    program: "s12000.gov24-629000000179", form: "ordin-19755173",
    title: "5·18 생활지원금 신청서(종전 광주 5개 구)", format: "hwp",
    bytes: 57856, sha256: "82757c4193ccddec079f70bf6af7acb1f6896d95c93cbcb411b3ba8f9289486e",
    condition: "종전 광주광역시 5개 구", excluded: [], writable: true,
  },
  {
    program: "s12000.gov24-646000000234", form: "ordin-22255373",
    title: "출생기본소득 배우자 수령 동의서(종전 전남 도급여)", format: "hwpx",
    bytes: 35296, sha256: "759684c3fc44726049fa8753aef0593b8ac8a8fad82b845681dfca94e53a3e18",
    condition: "월10만원 한도", excluded: [], writable: false,
  },
  {
    program: "s12000.gov24-646000000234", form: "ordin-22255375",
    title: "출생기본소득 예외 소급 신청서(종전 전남 도급여)", format: "hwpx",
    bytes: 28517, sha256: "9be92b87549e1410ba24d69f4a8319f7317ca9da33b4e75adf93e6c2344d6a58",
    condition: "늦은 최초신청 이전 기간", excluded: [], writable: false,
  },
  {
    program: "g52180.bokjiro-WLF00001439", form: "agency-52180-jeongeup-249275",
    title: "2026 회차자료 · 접수종료(2025.12.17~12.30) — 별별꿈 재능바우처 지원사업 신청서", format: "hwpx",
    bytes: 77176, sha256: "70f20a2cf41858b903ce218f2319ff895f8b0059d34d2b928108b25fd19256d9",
    condition: "현재 신규 접수나 다음 회차 신청용", excluded: [], writable: false,
  },
];

for (const item of exactFiles) {
  test(`${item.program} / ${item.form}: 용도 조건과 검증된 원본 바이트를 함께 제공한다 @mobile`, async ({ page, request }) => {
    await page.goto(`/p/${item.program}`);
    const panel = page.getByTestId("application-forms");
    await expect(panel.getByRole("heading", { name: item.title, exact: true })).toBeVisible();
    await expect(panel).toContainText(item.condition);
    const original = panel.locator(`a[href^="/forms/files/${item.form}-"]`);
    await expect(original).toHaveCount(1);
    const href = await original.getAttribute("href");
    expect(href).toBe(`/forms/files/${item.form}-${item.sha256.slice(0, 12)}.${item.format}`);
    const response = await request.get(href!);
    expect(response.status()).toBe(200);
    const bytes = await response.body();
    expect(bytes.length).toBe(item.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(item.sha256);
    for (const id of item.excluded) await expect(panel.locator(`a[href^="/forms/files/${id}-"]`)).toHaveCount(0);
    const card = panel.getByRole("listitem").filter({ has: page.getByRole("heading", { name: item.title, exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("paper-writer-link")).toHaveCount(item.writable ? 1 : 0);
    if (["agency-26110-bokjiro-wlf00006649-20260720-1", "ordin-21685783", "ordin-22371299"].includes(item.form)) {
      expect((await request.get(`/forms/writing/v1/manifest/${item.form}.json`)).status()).toBe(404);
    }
    if (item.program === "s47000.bokjiro-WLF00004401") {
      await expect(panel.locator('a[href*="20260820UUWBM0928100205473333"]')).toHaveCount(0);
      await expect(panel).toContainText("통장사본");
    }
    if (item.program === "g43110.gov24-571000000197") await expect(panel).toContainText("일반 강좌 수강신청서나 환불청구서가 아닙니다");
  });
}

test("같은 사업의 다른 자료에서도 원본의 조건부 연결을 유지한다", async ({ page }) => {
  for (const [program, form] of [
    ["s47000.gov24-647000000122", "agency-47000-bokjiro-wlf00004401-allowance-application"],
    ["g11215.bokjiro-WLF00002162", "ordin-22425515"],
    ["g11215.bokjiro-WLF00004044", "ordin-18989767"],
    ["g41130.bokjiro-WLF00001629", "ordin-20004411"],
    ["g41130.bokjiro-WLF00001629", "ordin-20004423"],
  ]) {
    await page.goto(`/p/${program}`);
    const panel = page.getByTestId("application-forms");
    await expect(panel.locator(`a[href^="/forms/files/${form}-"]`)).toHaveCount(1);
    await expect(panel.locator('a[href^="/forms/files/ordin-22425553-"]')).toHaveCount(0);
  }
  await page.goto("/p/g51810.icare-0083-1489635-1-3-6");
  await expect(page.getByTestId("application-forms").locator('a[href^="/forms/files/ordin-17770713-"]')).toHaveCount(0);
});

test("광진 출생신고 통합서식을 첫돌축하금의 신청서로 확대하지 않는다", async ({ page }) => {
  for (const program of ["g11215.bokjiro-WLF00002664", "g11215.gov24-304000000108"]) {
    await page.goto(`/p/${program}`);
    const panel = page.getByTestId("application-forms");
    await expect(panel).toBeVisible();
    await expect(panel.locator('a[href^="/forms/files/ordin-18989767-"]')).toHaveCount(0);
  }
});
