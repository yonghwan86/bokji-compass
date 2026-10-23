"use client";
/**
 * 원본 양식을 그대로 보며 빈칸만 직접 채우는 화면.
 *
 * 화면에 보이는 표·행·열 병합·본문 글자는 모두 변환한 양식의 실제 XML에서 뽑은 것이고,
 * 입력칸은 원본이 비워 둔 자리에 그 자리대로 놓인다. 원문 문구는 줄이거나 지우지 않는다.
 *
 * 적은 내용은 이 화면의 메모리에만 있다. 서버·저장소·주소창에 남기지 않고,
 * 화면을 떠나면 값과 내려받기 주소를 지운다. 양식 파일만 공개 주소에서 받아 온다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { loadProgramForms } from "@/lib/client/forms";
import { formAssetUrl } from "@/lib/data/formPublication";
import { buildFilledPaper, fetchPaperAsset, loadPaperManifest, paperFieldError, scopeManifestToProgram } from "@/lib/client/paperWriting";
import {
  normalizePaperInput, openSlots, paperBudgetLabel,
  type PaperManifest, type PaperNode, type PaperSlot,
} from "@/lib/data/paperWritingTypes";
import styles from "./PaperFormWriter.module.css";

type Gate =
  | { state: "loading" }
  | { state: "blocked"; reason: string }
  | { state: "ready"; manifest: PaperManifest; programName: string; use: "main" | "additional" | "conditional"; condition?: string; checkedAt: string };

const USE_LABEL = { main: "신청서", conditional: "해당하는 경우 내는 서식", additional: "함께 확인할 서류" } as const;
const LOCK_MARK = { signature: "서명", consent: "동의", agency: "기관" } as const;

function printedText(node: PaperNode): string {
  return node.kind === "paragraph" ? node.segments.map(segment => segment.kind === "text" ? segment.text : "").join("")
    : node.rows.flatMap(row => row.flatMap(cell => cell.nodes.map(printedText))).join(" ");
}

/** 원문 표의 머리글·왼쪽 역할 이름을 세로 입력의 문맥으로도 사용한다. */
function fieldGroups(manifest: PaperManifest, slots: PaperSlot[]): { title: string; slots: PaperSlot[] }[] {
  const tables: Extract<PaperNode, { kind: "table" }>[] = [];
  const visit = (nodes: PaperNode[]) => nodes.forEach(node => {
    if (node.kind === "table") { tables.push(node); node.rows.forEach(row => row.forEach(cell => visit(cell.nodes))); }
  });
  visit(manifest.blocks);
  const groups: { title: string; slots: PaperSlot[] }[] = [];
  for (const slot of slots) {
    const table = tables.find(node => node.index === slot.at.table && node.rows.some(row => row.some(cell =>
      cell.nodes.some(child => child.kind === "paragraph" && child.at.section === slot.at.section))));
    const cells = table?.rows.flat() ?? [];
    const text = (cell: (typeof cells)[number]) => cell.nodes.map(printedText).join(" ").replace(/\s+/g, " ").trim();
    const heading = cells.filter(cell => cell.row <= slot.at.row && cell.colSpan === table!.colCount
      && cell.nodes.length <= 2 && text(cell).length > 0 && text(cell).length <= 90).sort((a, b) => b.row - a.row)[0];
    const role = cells.filter(cell => cell.col < slot.at.col && cell.row <= slot.at.row
      && cell.row + cell.rowSpan > slot.at.row && cell.role === "printed" && text(cell).length > 0 && text(cell).length <= 40)
      .sort((a, b) => a.col - b.col)[0];
    const title = [heading ? text(heading) : manifest.title, role ? text(role) : ""].filter(Boolean).join(" · ");
    const previous = groups[groups.length - 1];
    if (previous?.title === title) previous.slots.push(slot);
    else groups.push({ title, slots: [slot] });
  }
  return groups;
}

/**
 * 공개된 사업–서식 연결과 원본 파일 정보가 변환 기록과 똑같을 때만 작성을 연다.
 * 원본 HWP의 바이트 수·SHA-256·공개 주소가 모두 같아야 하고, 다른 사업의 서식이면 막는다.
 */
function useGate(formId: string, programId: string | undefined): Gate {
  const [gate, setGate] = useState<Gate>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    const blocked = (reason: string) => { if (alive) setGate({ state: "blocked", reason }); };
    if (!programId) {
      blocked("어떤 복지 서비스의 신청서인지 확인할 수 없어요. 서비스 상세 화면에서 '화면에서 작성하기'를 눌러 주세요.");
      return () => { alive = false; };
    }
    Promise.all([loadPaperManifest(formId), loadProgramForms(programId)]).then(([manifest, data]) => {
      if (!alive) return;
      if (!manifest) {
        blocked("이 서식은 아직 화면에서 작성할 수 없어요. 원본 받기로 내려받아 직접 작성해 주세요.");
        return;
      }
      if (!data) {
        blocked("서식 연결 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.");
        return;
      }
      const link = data.entry.links.find(item => item.formId === formId);
      const form = data.forms.find(item => item.id === formId);
      if (!link || !form) {
        blocked("이 서비스에 연결된 신청서가 아니에요. 서비스 상세 화면에서 안내된 서식을 확인해 주세요.");
        return;
      }
      const file = form.file;
      if (!file || file.format !== "hwp" || file.bytes !== manifest.source.bytes || file.sha256 !== manifest.source.sha256
        || formAssetUrl(file.hwp) !== manifest.source.path) {
        blocked("공개된 원본 서식이 작성용으로 변환해 둔 원본과 달라요. 원본 받기로 내려받아 직접 작성해 주세요.");
        return;
      }
      // 사업별 검토표가 있는 서식은 그 사업이 검토한 칸만 쓴다. 화면과 저장 모두 이 결과를 쓴다.
      const scoped = scopeManifestToProgram(manifest, programId);
      if (!scoped) {
        blocked("이 서비스에서는 아직 화면 작성을 열지 않은 서식이에요. 원본 받기나 HWPX 받기로 내려받아 직접 작성해 주세요.");
        return;
      }
      setGate({ state: "ready", manifest: scoped, programName: data.entry.name, use: link.use, condition: link.condition, checkedAt: link.checkedAt });
    }).catch(() => blocked("서식 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요."));
    return () => { alive = false; };
  }, [formId, programId]);
  return gate;
}

export function PaperFormWriter({ formId, programId }: { formId: string; programId?: string }) {
  const gate = useGate(formId, programId);
  const [values, setValues] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"fields" | "paper">("fields");
  const urlRef = useRef<string | null>(null);

  // 화면을 떠나면 적은 값과 내려받기 주소를 지운다.
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  const manifest = gate.state === "ready" ? gate.manifest : null;
  const slots = useMemo(() => manifest ? openSlots(manifest) : [], [manifest]);
  const groups = useMemo(() => manifest ? fieldGroups(manifest, slots) : [], [manifest, slots]);
  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const slot of slots) {
      const problem = paperFieldError(slot, values[slot.id] ?? "");
      if (problem) out[slot.id] = problem;
    }
    return out;
  }, [slots, values]);
  const filled = useMemo(
    () => manifest ? normalizePaperInput(manifest, values, checks) : { values: {}, checks: {} },
    [manifest, values, checks],
  );

  if (gate.state !== "ready" || !manifest) {
    return (
      <div className={`wrap ${styles.page}`}>
        <Link className={styles.back} href={programId ? `/p/${encodeURIComponent(programId)}` : "/forms"}>← 돌아가기</Link>
        <h1 className={styles.title}>원본 양식 작성</h1>
        <p role="status">{gate.state === "blocked" ? gate.reason : "서식 정보를 확인하고 있어요."}</p>
      </div>
    );
  }

  const blockingErrors = Object.values(errors);
  const setValue = (id: string, value: string) => { setSaved(false); setValues(current => ({ ...current, [id]: value })); };
  const setCheck = (id: string, value: boolean) => { setSaved(false); setChecks(current => ({ ...current, [id]: value })); };

  async function download() {
    setFailure(null);
    setBusy(true);
    try {
      const bytes = await fetchPaperAsset(manifest!);
      const document_ = await buildFilledPaper(manifest!, bytes, { values, checks });
      const blob = new Blob([document_.bytes as unknown as BlobPart], { type: "application/hwp+zip" });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = document_.fileName;
      anchor.click();
      // 내려받기가 시작되면 메모리의 주소는 바로 되돌린다.
      setTimeout(() => { URL.revokeObjectURL(url); if (urlRef.current === url) urlRef.current = null; }, 4000);
      setSaved(true);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "파일을 만들지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  /** 잠긴 자리 — 원문은 그대로 보여 주고, 왜 채우지 않는지 알려 준다. */
  const renderLocked = (slot: PaperSlot) => (
    <span className={styles.locked} key={slot.id} title={slot.locked!.reason}>
      <span className={styles.lockedMark}>{LOCK_MARK[slot.locked!.kind]}</span>
      <span className="sr-only">{slot.label} — {slot.locked!.reason}</span>
      <span aria-hidden="true">{slot.kind === "check" ? (slot.boxShape === "square" ? "□" : "[  ]") : "____"}</span>
    </span>
  );

  const renderSlot = (slot: PaperSlot, linear = false) => {
    if (slot.locked) return renderLocked(slot);
    const describedBy = [slot.context ? `d-${slot.id}` : null, errors[slot.id] ? `e-${slot.id}` : null].filter(Boolean).join(" ");
    if (slot.kind === "check") {
      return (
        <label className={styles.box} key={slot.id}>
          <input
            type="checkbox"
            data-testid={`paper-check-${slot.id}`}
            checked={!!checks[slot.id]}
            disabled={busy}
            onChange={event => setCheck(slot.id, event.target.checked)}
            aria-describedby={describedBy || undefined}
          />
          <span>{slot.label}</span>
          {slot.context && <span className="sr-only" id={`d-${slot.id}`}>원문: {slot.context}</span>}
        </label>
      );
    }
    return (
      <span className={styles.slot} key={slot.id} data-invalid={errors[slot.id] ? "1" : undefined}>
        <label className={styles.slotName} htmlFor={`p-${slot.id}`}>{slot.label}</label>
        <input
          id={`p-${slot.id}`}
          data-testid={`paper-input-${slot.id}`}
          type={slot.input === "email" ? "email" : slot.input === "tel" ? "tel" : "text"}
          inputMode={slot.input === "numeric" ? "numeric" : slot.input === "tel" ? "tel" : undefined}
          style={linear ? undefined : { width: `${Math.min(Math.max(slot.budget, 6), 44)}ch` }}
          value={values[slot.id] ?? ""}
          disabled={busy}
          onChange={event => setValue(slot.id, event.target.value)}
          aria-invalid={errors[slot.id] ? true : undefined}
          aria-describedby={describedBy || undefined}
          autoComplete="off"
        />
        {slot.context && <span className="sr-only" id={`d-${slot.id}`}>원문: {slot.context} · {paperBudgetLabel(slot.budget)}</span>}
        {errors[slot.id] && <span className={styles.slotError} id={`e-${slot.id}`}>{errors[slot.id]}</span>}
      </span>
    );
  };

  const renderParagraph = (node: Extract<PaperNode, { kind: "paragraph" }>, className: string) => (
    <p className={className} key={`${node.at.section}-${node.at.table ?? "b"}-${node.at.row}-${node.at.col}-${node.at.p}`}>
      {node.segments.map((segment, index) => segment.kind === "text"
        ? <span key={index}>{segment.text}</span>
        : manifest.slots[segment.id] ? renderSlot(manifest.slots[segment.id]) : null)}
    </p>
  );

  const renderNode = (node: PaperNode, nested = false, path = "0"): React.ReactNode => {
    if (node.kind === "paragraph") return renderParagraph(node, nested ? styles.cellLine : styles.bodyLine);
    return (
      <table className={`${styles.table} ${nested ? styles.nested : ""}`} key={`t${path}`}>
        <tbody>
          {node.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map(cell => (
                <td
                  key={`${cell.row}-${cell.col}`}
                  data-role={cell.role}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                >
                  {cell.nodes.map((child, index) => renderNode(child, true, `${path}-${cell.row}-${cell.col}-${index}`))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const entries = slots
    .map(slot => ({ slot, value: slot.kind === "check" ? (filled.checks[slot.id] ? "고름" : "") : (filled.values[slot.id] ?? "") }))
    .filter(row => row.value);

  return (
    <div className={`wrap ${styles.page}`} data-testid="paper-writer">
      <Link className={styles.back} href={`/p/${encodeURIComponent(programId!)}`}>← {gate.programName} 상세로 돌아가기</Link>
      <h1 className={styles.title}>{manifest.title}</h1>
      <p className={styles.basis}>{gate.programName} · {USE_LABEL[gate.use]}{manifest.lawTitle ? ` · ${manifest.lawTitle}` : ""} · 연결 확인일 {gate.checkedAt}</p>
      {gate.condition && <p className={styles.basis}>{gate.condition}</p>}

      <p className={styles.converted} data-testid="paper-converted-notice">
        아래 양식은 공식 원본(HWP)을 <strong>작성용으로 변환한 양식</strong>이에요. 공식 원본 그 자체가 아니라,
        원본의 항목 순서에 맞춰 빈칸을 채우는 화면이에요. 화면의 줄바꿈과 크기는 인쇄본과 다를 수 있어요.
        내려받는 파일은 원본의 표·글꼴·여백을 유지하며, 서식에 따라 화면에서 채우지 못하는 칸도 있어요.
        일부 그림과 개체는 화면에 표시되지 않으니 원본 파일에서도 확인해 주세요.
        접수기관이 원본 파일을 요구하면 아래에서 받아 주세요.
        <a href={manifest.source.path} download data-testid="paper-source-download">공식 원본 받기 (HWP)</a>
      </p>

      <div className={styles.notice}>
        <p>적은 내용은 이 기기 안에서만 처리하고 외부로 보내지 않아요. 화면을 닫으면 사라지니 작성한 파일을 먼저 내려받아 주세요.</p>
        <p>해당되지 않는 칸은 비워 두어도 돼요. 다 쓰면 한글 파일로 받아 인쇄한 뒤 <strong>직접 서명하거나 도장을 찍어</strong> 접수기관에 내야 해요.</p>
        <p><strong>서명</strong>·<strong>동의</strong>·<strong>기관</strong> 표시가 붙은 자리는 화면에서 채우지 않아요. 서명과 동의 표시는 인쇄한 뒤 원문을 읽고 직접 해 주세요.</p>
        <p>이 화면에서 신청이 접수되지는 않아요. 수급 자격 여부는 접수기관이 심사해요.</p>
      </div>

      <div className={styles.toolbar}>
        <span className={styles.count} role="status">
          채울 수 있는 칸 {slots.length}개 중 {entries.length}개를 적었어요.
        </span>
        <button type="button" className={`btn btn-primary btn-lg ${styles.btnWide}`} onClick={download} disabled={busy || !!blockingErrors.length}>
          {busy ? "만드는 중…" : "작성한 신청서 내려받기 (HWPX)"}
        </button>
      </div>
      {!!blockingErrors.length && <p className={styles.failure} role="alert">{blockingErrors[0]}</p>}
      {failure && <p className={styles.failure} role="alert">{failure}</p>}
      {saved && <p className={styles.done} role="status">작성한 신청서를 내려받았어요. 인쇄해 서명·날인한 뒤 접수기관에 제출해 주세요.</p>}

      <section className={styles.doc} aria-label="원본 양식과 빈칸">
        <div className={styles.viewPicker} role="group" aria-label="작성 화면 고르기">
          <button type="button" className={`btn ${view === "fields" ? "btn-primary" : "btn-ghost"}`} aria-pressed={view === "fields"} onClick={() => setView("fields")}>세로로 입력하기</button>
          <button type="button" className={`btn ${view === "paper" ? "btn-primary" : "btn-ghost"}`} aria-pressed={view === "paper"} onClick={() => setView("paper")}>원본 양식으로 보기</button>
        </div>
        <p className="small muted">해당되는 칸만 적어 주세요. 원본 양식으로 바꾸면 안내사항과 입력 위치를 함께 확인할 수 있어요. 작성한 내용은 그대로 유지돼요.</p>
        {view === "fields" ? <div className={styles.fieldGroups} data-testid="paper-fields">
          {groups.map((group, index) => <fieldset className={styles.fieldGroup} key={index}>
            <legend>{group.title}</legend>
            <div className={styles.fieldList}>{group.slots.map(slot => renderSlot(slot, true))}</div>
          </fieldset>)}
        </div> : <>
        <p className="small muted">좁은 화면에서는 양식을 좌우로 밀어 볼 수 있어요. 입력이 불편하면 세로 입력으로 바꿔 주세요.</p>
        <div className={styles.sheet} data-testid="paper-sheet" role="region" tabIndex={0} aria-label="좌우로 이동할 수 있는 원본 양식">
          {manifest.blocks.map((node, index) => renderNode(node, false, String(index)))}
        </div>
        </>}
      </section>

      <section className={styles.review} aria-labelledby="paper-review-title">
        <h2 id="paper-review-title">적은 내용 확인하기</h2>
        {entries.length ? (
          <ul className={styles.reviewList}>
            {entries.map(row => (
              <li key={row.slot.id}>
                <span className={styles.reviewLabel}>{row.slot.label}</span>
                <span className={styles.reviewValue}>{row.value}</span>
              </li>
            ))}
          </ul>
        ) : <p className={styles.empty}>적은 내용이 없어요. 비워 둔 채로 받을 수 있어요.</p>}

        <div className={styles.manual}>
          <h3>파일을 받은 뒤 직접 해야 하는 것</h3>
          <ul>{manifest.manual.map(item => <li key={item}>{item}</li>)}</ul>
        </div>

        {!!manifest.unsupported.length && <details className={styles.held} data-testid="paper-unsupported">
          <summary>화면에서 열지 못한 칸 {manifest.unsupported.reduce((sum, row) => sum + row.count, 0)}곳</summary>
          <ul>{manifest.unsupported.map(row => <li key={row.reason}>{row.reason} ({row.count}곳)</li>)}</ul>
        </details>}

        <div className={styles.nav}>
          <a className={`btn btn-ghost btn-lg ${styles.btnWide}`} href={manifest.source.path} download>공식 원본 받기 (HWP)</a>
          <button type="button" className={`btn btn-primary btn-lg ${styles.btnWide}`} onClick={download} disabled={busy || !!blockingErrors.length}>
            {busy ? "만드는 중…" : "작성한 신청서 내려받기 (HWPX)"}
          </button>
        </div>
      </section>
    </div>
  );
}
