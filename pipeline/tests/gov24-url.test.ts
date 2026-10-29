/**
 * (2026-10-29) 정부24 API가 상세 주소를 plus.gov.kr 새 주소로 주기 시작함 (10,937건 전부).
 * 서식 연결 검증(정부24 사업 29개)이 옛 주소와 정확히 같은지로 확인하므로, 같은 서비스ID의 옛 주소 형식을 유지한다 (소유자 결정 ①).
 */
import { describe, expect, it } from "vitest";
import { gov24DetailUrl } from "../src/sources/gov24";

describe("정부24 상세 주소: 옛 주소 형식 유지", () => {
  it("새 주소(svcId가 서비스ID와 같음) → 옛 주소", () => {
    expect(gov24DetailUrl("https://plus.gov.kr/portal/benefitV2/benefitTotalSrvcList/benefitSrvcDtl?svcSeq=556551&bnefType=all&svcId=105100000001", "105100000001"))
      .toBe("https://www.gov.kr/portal/rcvfvrSvc/dtlEx/105100000001");
    expect(gov24DetailUrl("https://plus.gov.kr/portal/benefitV2/benefitTotalSrvcList/benefitSrvcDtl?svcSeq=1&svcId=O00023700005", "O00023700005"))
      .toBe("https://www.gov.kr/portal/rcvfvrSvc/dtlEx/O00023700005");
  });
  it("옛 주소는 그대로", () => {
    expect(gov24DetailUrl("https://www.gov.kr/portal/rcvfvrSvc/dtlEx/105100000001", "105100000001")).toBe("https://www.gov.kr/portal/rcvfvrSvc/dtlEx/105100000001");
  });
  it("svcId가 다르거나 없거나 다른 주소면 원천 그대로 (지어내지 않음)", () => {
    const other = "https://plus.gov.kr/portal/benefitV2/benefitTotalSrvcList/benefitSrvcDtl?svcSeq=1&svcId=999";
    expect(gov24DetailUrl(other, "105100000001")).toBe(other);
    expect(gov24DetailUrl("https://plus.gov.kr/portal/benefitV2/x?svcSeq=1", "105100000001")).toBe("https://plus.gov.kr/portal/benefitV2/x?svcSeq=1");
    expect(gov24DetailUrl("https://example.org/a?svcId=105100000001", "105100000001")).toBe("https://example.org/a?svcId=105100000001");
    expect(gov24DetailUrl(undefined, "105100000001")).toBeUndefined();
  });
});
