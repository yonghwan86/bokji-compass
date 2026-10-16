"use client";
/**
 * 방문처별 준비물 (인쇄·이미지 저장·보내기). 이 기기에서만 만들고, 지역 이름만 넣는다 (나이·소득 등 입력값 없음).
 * (2026-10-16 소유자) 신청하러 갈 곳마다 한 장씩 — 주민센터용·시청용·보건소용을 따로 들고 갈 수 있게.
 * 한 장마다 '담당자께' 칸: 무엇을 신청하러 왔는지, 사업명·서비스 번호·근거·소관으로 원문을 찾아볼 수 있게 (원문에 있는 것만).
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Icon } from "@/components/Icon";
import { buildVisitSheet, SHEET_STATUS, type SheetEntry, type SheetPlace } from "@/lib/client/visit";
import { renderSheetPng } from "@/lib/client/sheetImage";
import { COMMON_FORM, formAttachments, formChecks } from "@/lib/client/applyForm";

const fileOf = (i: number) => `복지나침반-준비물-${i + 1}.png`;
/** 문의 문구에서 전화번호만 ('한부모상담전화 1577-4206' → '15774206'). 번호가 없으면 null */
function telOf(text: string): string | null {
  const m = text.match(/(?<!\d)(0\d{1,2}-?\d{3,4}-?\d{4}|1[5-9]\d{2}-?\d{4}|1\d{2})(?!\d)/);
  return m ? m[1].replace(/-/g, "") : null;
}

/** 곳 이름 + '에 가져갈 한 장' (신청이 필요 없는 묶음·온라인은 문구를 바꿈) */
function pageTitle(pl: SheetPlace): string {
  if (pl.key === "none") return "따로 신청하지 않아도 되는 것";
  if (pl.key === "online") return "온라인으로 신청할 것";
  if (pl.key === "agency") return "담당 기관에 먼저 문의할 것";
  return `${pl.label}에 가져갈 한 장`;
}

/** 한 곳 한 장 (화면·인쇄 같은 내용) */
function PlacePage({ pl, i, n, region, date, forPrint, actions }: { pl: SheetPlace; i: number; n: number; region: string; date: string; forPrint?: boolean; actions?: React.ReactNode }) {
  const H = forPrint ? "p" : "h3";
  const tid = (id: string) => (forPrint ? undefined : id);
  const visit = pl.key !== "none" && pl.key !== "online";
  return (
    <article className="vs-place vs-page" data-testid={tid("vs-place")} data-key={pl.key}>
      <p className="vs-meta">
        복지나침반 · 방문처별 준비물{n > 1 ? ` ${i + 1}/${n}` : ""} · {region} 기준 · {date}
      </p>
      <H className="vs-ptitle">{pageTitle(pl)}</H>
      {visit && (
        <p className="vs-staff" data-testid={tid("vs-staff")}>
          <strong>담당자께</strong> 이 분은 아래 {pl.programs.length > 1 ? `${pl.programs.length}가지` : "사업"}을 신청(자격 확인 포함)하러 오셨어요. 사업명·서비스 번호로 정부24·복지로 원문을 찾아보실 수 있어요.
        </p>
      )}
      <p className="vs-k">{visit ? "신청할 것" : pl.key === "online" ? "신청할 것" : "해당하는 것"}</p>
      <ol className="vs-progs">
        {pl.programs.map((p) => (
          <li key={p.id} data-testid={tid("vs-prog")}>
            <strong>{p.name}</strong>
            {p.staff.ref && <span className="vs-ref"> · {p.staff.ref}</span>}
            {p.staff.what && <span className="vs-line">{p.staff.what}</span>}
            {p.staff.target && <span className="vs-line">대상(원문): {p.staff.target}</span>}
            {p.staff.basis && <span className="vs-line">{p.staff.basis}</span>}
            <span className="vs-sub">{[SHEET_STATUS[p.bucket], ...p.also].join(" · ")}</span>
          </li>
        ))}
      </ol>
      {pl.key !== "none" && (
        <>
          <p className="vs-k">{pl.key === "online" ? "준비할 서류" : "가져갈 것"}</p>
          {pl.bring.length > 0 && (
            <ul className="vs-check" data-testid={tid("vs-bring")}>
              {pl.bring.map((b) => (
                <li key={b.item}>
                  <span className="vs-box" aria-hidden="true" />
                  <span>
                    {b.item}
                    {pl.programs.length > 1 && <span className="vs-for"> ({b.for.length === pl.programs.length ? "모두" : b.for.join(", ")})</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {pl.cond.length > 0 && <p className="vs-note">해당하는 분만: {pl.cond.map((c) => `${c.item}${pl.programs.length > 1 ? ` (${c.for.join(", ")})` : ""}`).join(", ")}</p>}
          {pl.forms.length > 0 && (
            <p className="vs-note">신청서 서식(원문 첨부, 창구에도 있어요): {pl.forms.map((c) => `${c.item}${pl.programs.length > 1 ? ` (${c.for.join(", ")})` : ""}`).join(", ")}</p>
          )}
          {pl.proxy.length > 0 && <p className="vs-note">가족이 대신 신청할 때: {pl.proxy.join(", ")}</p>}
          {pl.programs.some((p) => p.docs === "missing") && (
            <p className="vs-note" data-testid={tid("vs-ask")}>
              가기 전에 전화로 물어볼 것 — 구비서류가 원문에 없어요: {pl.programs.filter((p) => p.docs === "missing").map((p) => p.name).join(", ")}
            </p>
          )}
          {(pl.trimmed > 0 || pl.programs.some((p) => p.more > 0)) && (
            <p className="vs-note">서류가 더 있어요 — 상세 페이지·창구에서 확인{pl.programs.some((p) => p.more > 0) ? `: ${pl.programs.filter((p) => p.more > 0).map((p) => p.name).join(", ")}` : ""}</p>
          )}
          {pl.programs.some((p) => p.docs === "none") && pl.key !== "online" && (
            <p className="vs-note">원문에 구비서류 &lsquo;해당 없음&rsquo;: {pl.programs.filter((p) => p.docs === "none").map((p) => p.name).join(", ")}</p>
          )}
        </>
      )}
      {pl.key === "center" && <FormHelp pl={pl} tid={tid} />}
      {pl.phones.length > 0 && (
        <p className="vs-note" data-testid={tid("vs-phones")}>
          문의:{" "}
          {pl.phones.map((x, k) => (
            <span key={x.phone}>
              {k > 0 && " / "}
              {/* 화면에서는 눌러서 바로 전화 (QA 7차 V1). 인쇄·이미지는 글자 그대로 */}
              {!forPrint && telOf(x.phone) ? <a href={`tel:${telOf(x.phone)}`}>{x.phone}</a> : x.phone}
            </span>
          ))}
        </p>
      )}
      <p className="vs-foot">원문(정부24·복지로) 기준이에요. 서류는 바뀔 수 있으니 가기 전에 전화로 확인하세요. 모르면 보건복지상담센터 129. 최종 자격은 담당 기관이 정해요.</p>
      {actions}
    </article>
  );
}

export function VisitSheet({ entries, region, sido, loading, extra, teen, onClose }: { entries: SheetEntry[]; region: string; sido?: string | null; loading: boolean; extra: number; teen?: boolean; onClose: () => void }) {
  const places = useMemo(() => buildVisitSheet(entries, sido), [entries, sido]);
  const date = useMemo(() => new Date().toLocaleDateString("ko-KR"), []);
  // 이 컴포넌트는 사용자가 버튼을 눌러야 열리므로(클라이언트에서만 렌더) 초기값에서 바로 확인한다
  const [canShare] = useState(() => {
    try {
      const f = new File([new Uint8Array(1)], fileOf(0), { type: "image/png" });
      return typeof navigator !== "undefined" && typeof navigator.share === "function" && !!navigator.canShare?.({ files: [f] });
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  /** 인쇄할 곳 (null = 곳마다 한 장씩 모두) */
  const [printOnly, setPrintOnly] = useState<number | null>(null);
  const mounted = typeof document !== "undefined";
  useEffect(
    () => () => {
      delete document.documentElement.dataset.print;
    },
    [],
  );

  const printSheet = (only: number | null) => {
    // 인쇄할 곳을 먼저 그려 놓고 인쇄 (곳마다 한 장씩 — 인쇄 화면에서 쪽이 나뉨)
    flushSync(() => setPrintOnly(only));
    document.documentElement.setAttribute("data-print", "sheet");
    const done = () => document.documentElement.removeAttribute("data-print");
    window.addEventListener("afterprint", done, { once: true });
    window.print();
  };
  const toPng = async (i: number) => {
    setBusy(true);
    try {
      return await renderSheetPng(places[i], { region, date, index: i, total: places.length });
    } finally {
      setBusy(false);
    }
  };
  const save = async (i: number) => {
    try {
      const blob = await toPng(i);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileOf(i);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMsg(`'${places[i].label}' 한 장을 이미지로 저장했어요. 사진첩이나 다운로드 폴더에서 카카오톡으로 보낼 수 있어요.`);
    } catch {
      setMsg("이미지를 만들지 못했어요. '이 곳 한 장 인쇄'에서 PDF로 저장해 주세요.");
    }
  };
  const send = async (i: number) => {
    try {
      const blob = await toPng(i);
      const file = new File([blob], fileOf(i), { type: "image/png" });
      await navigator.share({ files: [file], title: `방문처별 준비물 — ${places[i].label}` });
    } catch {}
  };
  const printed = printOnly === null ? places.map((pl, i) => ({ pl, i })) : places[printOnly] ? [{ pl: places[printOnly], i: printOnly }] : [];

  return (
    <section className="visit-sheet card" id="visit-sheet" aria-labelledby="vs-h" data-testid="visit-sheet" aria-busy={loading}>
      <h2 className="h2" id="vs-h">
        방문처별 준비물{places.length > 1 ? ` — ${places.length}곳, 곳마다 한 장` : ""}
      </h2>
      <p className="small muted vs-lead no-print">
        &lsquo;먼저 확인할 5가지&rsquo;{extra > 0 ? `와 직접 담은 ${extra}개` : ""}를 신청하는 곳별로 한 장씩 나눴어요. 그 곳에 가져갈 한 장만 들고 가서 담당자께 보여 드리면 돼요. 이 기기에서만 만들었고 나이·소득 같은 입력값은 넣지 않았어요.
      </p>
      {/* 10대 본인 (QA 7차 T1) */}
      {teen && (
        <p className="small vs-lead no-print" data-testid="vs-teen">
          부모님이나 선생님께 이 화면을 보여 드려도 좋아요.
        </p>
      )}
      {loading ? (
        <p className="muted">신청 방법·구비서류를 불러오는 중…</p>
      ) : (
        <div className="vs-places">
          {places.map((pl, i) => (
            <PlacePage
              key={pl.key}
              pl={pl}
              i={i}
              n={places.length}
              region={region}
              date={date}
              actions={
                <div className="btn-row vs-actions no-print">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => printSheet(i)} data-testid="vs-print-place">
                    <Icon name="printer" size={18} /> 이 곳 한 장 인쇄
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => save(i)} disabled={busy} data-testid="vs-png">
                    <Icon name="fileText" size={18} /> 이미지로 저장
                  </button>
                  {canShare && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => send(i)} disabled={busy} data-testid="vs-share">
                      <Icon name="share" size={18} /> 이미지로 보내기
                    </button>
                  )}
                </div>
              }
            />
          ))}
        </div>
      )}
      <div className="btn-row vs-actions no-print">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => printSheet(null)} disabled={loading} data-testid="vs-print">
          <Icon name="printer" size={18} /> {places.length > 1 ? "곳마다 한 장씩 모두 인쇄" : "인쇄"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} data-testid="vs-close">
          닫기
        </button>
      </div>
      {msg && (
        <p className="small" role="status" data-testid="vs-msg">
          {msg}
        </p>
      )}
      {mounted &&
        !loading &&
        createPortal(
          <div className="sheet-print-root" aria-hidden="true">
            {printed.map(({ pl, i }) => (
              <PlacePage key={pl.key} pl={pl} i={i} n={places.length} region={region} date={date} forPrint />
            ))}
          </div>,
          document.body,
        )}
    </section>
  );
}

/**
 * 주민센터 장: 공통 신청서 「사회보장급여 신청(변경)서」에서 체크할 칸 (2026-10-16 회의: 신청서 자동 채우기).
 * 칸 이름은 서식 원문 그대로, 개인정보는 적지 않는다 — 창구에서 받은 서식에 이 칸만 체크하면 된다.
 */
function FormHelp({ pl, tid }: { pl: SheetPlace; tid: (s: string) => string | undefined }) {
  const checks = formChecks(pl.programs);
  if (!checks.length) return null;
  const attach = formAttachments(checks);
  return (
    <div className="vs-form" data-testid={tid("vs-form")}>
      <p className="vs-k">신청서에서 체크할 칸</p>
      <p className="vs-note">
        창구의 「{COMMON_FORM.title}」 2쪽 &lsquo;사회보장급여 내용&rsquo;에서 (근거: {COMMON_FORM.basis})
      </p>
      <ul className="vs-check">
        {checks.map((c) => (
          <li key={`${c.section}-${c.label}`}>
            <span className="vs-box" aria-hidden="true" />
            <span>
              <b>{c.section}</b> · {c.label}
              {(c.for.length > 1 || c.for[0] !== c.label) && <span className="vs-for"> ({c.for.join(", ")})</span>}
            </span>
          </li>
        ))}
      </ul>
      {attach.length > 0 && <p className="vs-note">함께 쓰는 서식(창구에 있어요): {attach.join(", ")}</p>}
      <p className="vs-note">이름·주민등록번호·계좌는 창구에서 직접 적어요. 이 한 장에는 적지 않아요.</p>
    </div>
  );
}

