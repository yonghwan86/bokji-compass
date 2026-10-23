import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDataProvenance } from "../../scripts/build-data-provenance";
import {
  assertPublicProvenance,
  createSourceCensus,
  koCount,
  provenanceView,
  publicHttpsUrl,
  type DataProvenance,
} from "@/lib/data/dataProvenance";

const SECRET = "super-secret-service-key-value";

describe("공개 주소", () => {
  it("인증값·비https·내부 주소는 거절하고 값 자체는 오류에 남기지 않는다", () => {
    const rejected = [
      "javascript:alert(1)",
      "data:text/html,hi",
      "http://www.gov.kr/portal/rcvfvrSvc/main",
      "https://user:password@www.gov.kr/file",
      "https://127.0.0.1/private",
      "https://localhost/private",
      `https://www.gov.kr/a?serviceKey=${SECRET}`,
      "https://apis.data.go.kr/x?service_key=abc",
      "https://www.law.go.kr/DRF/lawService.do?OC=hidden-account",
      "https://www.bokjiro.go.kr/file.hwp?token=hidden-token",
      "https://www.data.go.kr/data/15113968/openapi.do?key=hidden",
      `https://www.mohw.go.kr/board.es?note=${SECRET}`,
    ];
    for (const url of rejected) expect(publicHttpsUrl(url), url).toBeNull();

    const census = createSourceCensus(1);
    let thrown = "";
    try {
      census.add({
        id: "n.gov24-secret",
        sources: [{ source: "gov24", id: "1", url: `https://www.gov.kr/a?serviceKey=${SECRET}`, fetchedAt: "2026-10-02" }],
      });
    } catch (error) {
      thrown = String(error);
    }
    expect(thrown).toMatch(/Rejected unsafe source URL/);
    expect(thrown).not.toContain(SECRET);
    expect(census.finish().programRecords).toBe(0);
  });

  it("실제 원문 호스트와 공공데이터포털 안내 주소는 통과한다", () => {
    const accepted = [
      "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/B41000200021",
      "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000001&wlfareInfoReldBztpCd=01",
      "https://www.mohw.go.kr/board.es?mid=a60601000000&bid=0075&act=view&list_no=1489529&tag=&nPage=2",
      "https://www.data.go.kr/data/15113968/openapi.do",
      "https://www.data.go.kr/data/15090532/openapi.do",
      "https://www.data.go.kr/data/15108347/openapi.do",
      "https://www.mohw.go.kr/menu.es?mid=a60600000000",
      "https://www.nhis.or.kr/static/html/wbma/c/wbmac0217.html",
      "https://www.suwon.go.kr/sw-www/saebitinfo/saebitinfo-01.jsp",
    ];
    for (const url of accepted) expect(publicHttpsUrl(url)).toBe(new URL(url).href);
  });
});

describe("집계 규칙", () => {
  it("연도 기준값을 누락으로 버리거나 날짜까지 있는 수정일로 바꾸지 않는다", () => {
    const census = createSourceCensus(1);
    census.add({ id: "year-reference", sources: [{ source: "bokjiro", id: "W-year", fetchedAt: "2026-10", updatedAt: "2026" }] });
    const source = census.finish().sources.find(item => item.id === "bokjiro");
    expect(source?.documentDate).toMatchObject({ min: "2026", max: "2026", datedRefs: 1, missingRefs: 0, precision: "year", granularity: { year: 1, month: 0, day: 0 } });
    expect(source?.fetchedAt).toMatchObject({ min: "2026-10", max: "2026-10", precision: "month" });
  });

  it("수집일이 없는 출처는 범위를 만들지 않고, 종류를 더한 수를 자료 수로 두지 않는다", () => {
    const census = createSourceCensus(1);
    census.add({
      id: "a",
      regionLabel: "인천 제물포구",
      sources: [
        { source: "gov24", id: "G1", url: "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/G1" },
        { source: "bokjiro", id: "W1", url: "https://www.bokjiro.go.kr/w", fetchedAt: "2026-10-06", updatedAt: "2022-06-29" },
      ],
    });
    census.add({
      id: "b",
      name: "확인한 제도",
      regionLabel: "인천 영종구",
      sources: [{ source: "manual", id: "m1", url: "https://www.nhis.or.kr/static/html/wbma/c/wbmac0217.html", fetchedAt: "2026-10-07", updatedAt: "2026-10-07" }],
    });
    census.add({
      id: "c",
      sources: [{ source: "welfare100", id: "slug", fetchedAt: "2026-10-06", updatedAt: "2026-09-24" }],
    });
    const done = census.finish();
    expect(done.programRecords).toBe(3);
    expect(done.programsWithoutSources).toBe(0);
    const gov24 = done.sources.find((source) => source.id === "gov24");
    expect(gov24?.fetchedAt).toBeUndefined();
    expect(gov24?.programLinks).toBe(1);
    expect(done.overlap.sourceKindLinkSum).toBe(4);
    expect(done.overlap.programsWithMultipleSourceKinds).toBe(1);
    expect(done.overlap.sourceKindLinkSum).not.toBe(done.programRecords);
    expect(done.sources.find((source) => source.id === "welfare100")?.refsWithoutUrl).toBe(1);
    expect(done.sources.find((source) => source.id === "manual")?.evidence).toEqual([
      { href: "https://www.nhis.or.kr/static/html/wbma/c/wbmac0217.html", label: "확인한 제도" },
    ]);
  });
});

describe("세부 자료 전수", () => {
  const doc = buildDataProvenance();
  const saved = JSON.parse(readFileSync("src/lib/data/dataProvenance.json", "utf8")) as DataProvenance;
  const view = provenanceView(doc);

  it("생성 결과가 저장된 JSON과 같고 비밀값이 없다", () => {
    expect(doc).toEqual(saved);
    expect(buildDataProvenance()).toEqual(doc);
    assertPublicProvenance(doc);
    const raw = readFileSync("src/lib/data/dataProvenance.json", "utf8");
    expect(raw).not.toMatch(/serviceKey|service_key|DATA_GO_KR_SERVICE_KEY|Infuser |javascript:|127\.0\.0\.1|localhost/i);
    expect(raw).not.toMatch(/[A-Za-z]:\\Users\\|\/root\/|\\\\Users\\/);
  }, 120_000);

  it("256조각의 고유 자료 23578건과 출처 연결을 구분한다", () => {
    expect(doc.basis).toMatchObject({ shardFiles: 256, programRecords: 23578, duplicateIds: 0, programsWithoutSources: 0 });
    expect(doc.metaUniquePrograms).toBe(23575);
    expect(doc.metaPlacements).toBe(23578);
    expect(doc.districtCopies).toMatchObject({
      extraRecords: 3,
      groups: 3,
      regions: ["인천 영종구", "인천 제물포구"],
      sourceKinds: ["bokjiro"],
    });
    const links = Object.fromEntries(doc.sources.map((source) => [source.id, source.programLinks]));
    expect(links).toEqual({ gov24: 9336, bokjiro: 5232, icare: 10218, welfare100: 100, manual: 3 });
    const refs = Object.fromEntries(doc.sources.map((source) => [source.id, source.sourceRefs]));
    expect(refs).toEqual({ gov24: 9703, bokjiro: 5271, icare: 10294, welfare100: 100, manual: 3 });
    expect(doc.overlap).toMatchObject({ sourceKindLinkSum: 24889, programsWithMultipleSourceKinds: 1263, byKindCount: { "2": 1215, "3": 48 } });
    expect(9336 + 5232 + 10218 + 100 + 3).toBe(24889);
    expect(doc.overlap.sourceKindLinkSum).not.toBe(doc.basis.programRecords);
    expect(doc.sources.find((source) => source.id === "welfare100")?.refsWithoutUrl).toBe(100);
    for (const source of doc.sources) {
      if (source.id !== "welfare100") expect(source.refsWithoutUrl).toBe(0);
    }
    expect(doc.urlCoverage).toEqual({ programsWithRecordedUrl: 23528, programsWithoutAnyUrl: 50, welfare100OnlyWithoutUrl: 50 });
    expect(doc.urlCoverage.programsWithRecordedUrl + doc.urlCoverage.programsWithoutAnyUrl).toBe(23578);
    expect(doc.outsideDetail).toEqual({ rawInputRecords: 28861, regionalOperations: 2359 });
    expect(doc.pipelineInputs.reduce((sum, row) => sum + row.records, 0)).toBe(28861);
    expect(doc.sources.find((source) => source.id === "icare")).toMatchObject({ distinctUrls: 230, distinctBoards: 17 });
  });

  it("수집일·원문 기준일·법령 검토일·서식 건수를 섞지 않는다", () => {
    const fetched = Object.fromEntries(doc.sources.map((source) => [source.id, source.fetchedAt && [source.fetchedAt.min, source.fetchedAt.max, source.fetchedAt.datedRefs]]));
    expect(fetched).toEqual({
      gov24: ["2026-10-02", "2026-10-02", 9703],
      bokjiro: ["2026-10-06", "2026-10-06", 5271],
      icare: ["2026-10-01", "2026-10-01", 10294],
      welfare100: ["2026-10-06", "2026-10-06", 100],
      manual: ["2026-10-07", "2026-10-07", 3],
    });
    expect(doc.sources.find((source) => source.id === "bokjiro")?.documentDate).toMatchObject({
      min: "2022-06-29", max: "2026-10-02", datedRefs: 5271, missingRefs: 0,
      precision: "mixed", granularity: { year: 461, month: 0, day: 4810 },
    });
    expect(doc.sources.find((source) => source.id === "icare")?.documentDate).toMatchObject({
      min: "2026-03", max: "2026-07", precision: "mixed", label: "기준 시점",
    });
    expect(doc.sources.find((source) => source.id === "icare")?.documentDate?.meaning).toContain("수집일이 아닙니다");
    expect(doc.sources.find((source) => source.id === "welfare100")?.documentDate?.min).toBe("2026-09-24");
    expect(doc.bundleGeneratedAt).toBe("2026-10-08T14:57:47.456Z");
    expect(doc.forms).toMatchObject({
      downloadOriginals: 2844,
      linkedPrograms: 2564,
      censusPrograms: 23578,
      lawReviewCheckedAt: "2026-10-23",
    });
    expect(doc.forms.portalListCheckedAt).toBe("2026-10-16T16:26:04.977154+00:00");
    expect(doc.forms.formBundleGeneratedAt).not.toBe(doc.bundleGeneratedAt);
  });

  it("화면 문구는 건수·한계·공식 링크를 드러내고 완료 선언을 하지 않는다", () => {
    const text = [view.fetchedNote, view.linkNote, ...view.paragraphs, view.tableCaption, ...view.rows.map((row) => `${row.title} ${row.programs} ${row.fetched}`), view.refNote, ...view.dates, view.forms, ...view.limits, ...view.links.map((link) => `${link.label} ${link.roleLabel} ${link.href}`)].join("\n");
    expect(text).toContain("23,578");
    expect(text).toContain("23,575");
    expect(text).toContain("9,336");
    expect(text).toContain("5,232");
    expect(text).toContain("10,218");
    expect(text).toContain("24,889");
    expect(text).toContain("1,263");
    expect(text).toContain("2,844");
    expect(text).toContain("2,564");
    expect(text).toContain("총 복지 수가 아닙니다");
    expect(text).toContain("개별 원문 주소가 비어");
    expect(text).toContain("23,528");
    expect(text).toContain("50건");
    expect(text).toContain("오류나 예전 값이 아닙니다");
    expect(text).toContain("자료에 기록된 수집일");
    expect(text).toContain("목록 캐시 파일의 수정 시각");
    expect(text).toContain("2026-10-08");
    expect(text).toContain("선행 대시보드 수집본");
    expect(text).toContain("230개");
    expect(text).toContain("17곳");
    expect(text).toContain("다시 만든 것은 아닙니다");
    expect(text).toContain("공식 API가 아닙니다");
    expect(text).toContain("2,359");
    expect(text).toContain("28,861");
    expect(text).toContain("지금 모두 열어 확인한 것은 아닙니다");
    expect(text).not.toMatch(/재수집(을|으로)? 완료|원문 재수집 완료/);
    expect(text).toContain("제공 API");
    expect(text).toContain("원문 기관");
    expect(text).toContain("https://www.data.go.kr/data/15113968/openapi.do");
    expect(text).toContain("https://www.data.go.kr/data/15090532/openapi.do");
    expect(text).toContain("https://www.data.go.kr/data/15108347/openapi.do");
    expect(text).toContain("https://www.gov.kr/portal/rcvfvrSvc/main");
    expect(text).toContain("https://www.bokjiro.go.kr/");
    expect(text).toContain("https://www.mohw.go.kr/menu.es?mid=a60600000000");
    expect(text).toContain("https://www.nhis.or.kr/static/html/wbma/c/wbmac0217.html");
    expect(text).toContain("https://www.suwon.go.kr/sw-www/saebitinfo/saebitinfo-01.jsp");
    expect(text).not.toContain("전국 모든 복지 수집완료");
    expect(text).not.toMatch(/serviceKey|DATA_GO_KR_SERVICE_KEY/);
    expect(view.rows.map((row) => row.programs)).toEqual(["9,336건", "5,232건", "10,218건", "100건", "3건"]);
    expect(koCount(doc.basis.programRecords)).toBe("23,578");
    const welfareLinks = doc.sources.find((source) => source.id === "welfare100")?.links ?? [];
    expect(welfareLinks).toEqual([]);
  });
});

describe("안내 페이지 연결", () => {
  const about = readFileSync("src/app/about/page.tsx", "utf8");
  const footer = readFileSync("src/components/SiteFooter.tsx", "utf8");

  it("about의 개인정보·다른 절을 지우지 않고 출처 앵커와 바닥글 링크를 둔다", () => {
    expect(about).toContain("<DataSources />");
    expect(about).toContain('id="privacy"');
    expect(about).toContain("개인정보 원칙");
    expect(about).toContain('id="v2"');
    expect(about).toContain('id="income"');
    expect(about).toContain('id="credits"');
    expect(about).toContain("vuski/admdongkor");
    expect(about).not.toContain("전국 모든 복지 수집완료");
    expect(footer).toContain('href="/about#sources"');
    expect(footer).toContain("자료 출처");
    expect(footer).toContain('href="/about#privacy"');
  });
});
