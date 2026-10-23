import { expect, test } from "@playwright/test";

test("정읍은 종료된 2026회차임을 다운로드 앞에 알리고 작성기를 열지 않는다 @mobile", async ({ page }) => {
  await page.goto("/p/g52180.bokjiro-WLF00001439");
  const title = "2026 회차자료 · 접수종료(2025.12.17~12.30) — 별별꿈 재능바우처 지원사업 신청서";
  const card = page.getByTestId("application-forms").getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("현재 신규 접수나 다음 회차 신청용을 뜻하지 않습니다");
  await expect(card).toContainText("2026.2~12월");
  await expect(card.getByTestId("paper-writer-link")).toHaveCount(0);
  await expect(card.getByRole("link", { name: /화면에서 작성/ })).toHaveCount(0);
  const order = await card.evaluate(element => {
    const heading = element.querySelector("h4")!;
    const condition = Array.from(element.querySelectorAll("p")).find(p => p.textContent?.includes("현재 신규 접수나 다음 회차"))!;
    const download = element.querySelector('a[href^="/forms/files/agency-52180-jeongeup-249275-"]')!;
    return { headingBefore: Boolean(heading.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING), conditionBefore: Boolean(condition.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  expect(order).toEqual({ headingBefore: true, conditionBefore: true });
});

test("고흥 동일 통합원본을 출산장려금과 산모건강회복비의 서로 다른 조건으로 제공한다 @mobile", async ({ page }) => {
  for (const [program, title, condition] of [
    ["g12740.gov24-488000000129", "고흥군 출산장려금 통합신청서(지자체 기재 확인)", "첫째"],
    ["g12740.gov24-488000000107", "고흥군 산모건강회복비 통합신청서(지자체 기재 확인)", "분만당1회"],
  ]) {
    await page.goto(`/p/${program}`);
    const card = page.getByTestId("application-forms").getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(condition);
    await expect(card.locator('a[href="/forms/files/ordin-22321711-852577bd8fa9.hwpx"]')).toHaveCount(1);
    await expect(card.getByTestId("paper-writer-link")).toHaveCount(0);
  }
});

test("출생기본소득 배우자 동의와 예외 소급을 구 전남 도급여 범위로 구분한다 @mobile", async ({ page }) => {
  await page.goto("/p/s12000.gov24-646000000234");
  const panel = page.getByTestId("application-forms");
  const consent = panel.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "출생기본소득 배우자 수령 동의서(종전 전남 도급여)", exact: true }) });
  await expect(consent).toContainText("친족·제3자의 일반 대리신청 위임장이나 모든 타인계좌 수령에 사용하지 않습니다");
  await expect(consent).toContainText("월10만원 한도");
  const retroactive = panel.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "출생기본소득 예외 소급 신청서(종전 전남 도급여)", exact: true }) });
  await expect(retroactive).toContainText("운영위원회 심의");
  await expect(retroactive).toContainText("늦은 최초신청 이전 기간이나 전출·자격상실인 제1호");
  await expect(retroactive).toContainText("통합시 전역이나 시군 추가급여로 확대하지 않습니다");
});

test("완도 돌맞이는 출생신고 기준 기한과 양부모·입양재혼 특칙을 함께 안내한다 @mobile", async ({ page }) => {
  await page.goto("/p/g12850.bokjiro-WLF00000233");
  const card = page.getByTestId("application-forms").getByRole("listitem").filter({ has: page.getByRole("heading", { name: "완도군 둘째아 이상 돌맞이 축하금 신청서", exact: true }) });
  await expect(card).toContainText("양부 또는 양모를 포함합니다");
  await expect(card).toContainText("출생신고를 한 뒤 1년이 지난 시점부터 60일");
  await expect(card).toContainText("이전자녀가 13세 이상");
  await expect(card).toContainText("입양·재혼 가정");
  await expect(card).toContainText("같은 주민등록 세대");
});
