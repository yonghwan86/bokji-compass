/** (2026-10-25) 신청서 파일은 이름 없는 inline — 운영(Vercel)의 'inline; filename="저장용 이름"'이 화면의 download 제목을 덮지 않게 */
import { expect, test } from "@playwright/test";

const files = [
  "/forms/files/ordin-20589281-27a18064215a.hwpx",
  "/forms/files/ordin-18462467-64cc91bc3373.hwp",
  "/forms/files/agency-41000-disability-medical-06696-b306e25c32bb.pdf",
  "/forms/writing/v1/converted/ordin-18462467-64cc91bc3373-11174e055b89.hwpx",
];

for (const path of files) {
  test(`신청서 파일 머리말에 저장용 이름이 없음: ${path}`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toBe("inline");
  });
}
