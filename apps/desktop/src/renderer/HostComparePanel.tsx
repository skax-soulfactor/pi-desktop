import { useEffect, useMemo, useState } from "react";
import type { HostDescriptor, HostInventory, InventoryItem } from "../shared/api";
import { copiedEntryPath, copyWarnings, extensionWarnings, isAlreadyExists, joinHostPath, textToBase64 } from "./copy-view";
import { errorText } from "./folder-browser";
import {
  bulkCopyable,
  compareRows,
  compareSummary,
  fileChanges,
  KIND_TEXT,
  stateText,
  type CompareRow,
  type FileChange,
} from "./host-compare-view";
import { importName } from "./market-view";
import { lineDiff } from "./text-diff";
import { DiffView } from "./ToolCards";

interface Props {
  hostId: string;
  hosts: HostDescriptor[];
}

/** 복사 하나를 준비한 것: 옮길 파일, 대상 OS 경고, 덮어쓰면 대상에서 달라질 파일 */
interface Prepared {
  key: string;
  from: HostInventory;
  to: HostInventory;
  toLabel: string;
  item: InventoryItem;
  overwrite: boolean;
  warnings: string[];
  files: Array<{ path: string; contentBase64: string }>;
  /** 덮어쓸 때 대상에서 생기고 바뀌고 사라질 파일 (보여 줄 때만 채운다) */
  changes?: FileChange[];
}

/** 확인을 받는 중인 복사: 한 줄, 또는 고른 여러 줄 */
type Pending = { kind: "one"; item: Prepared } | { kind: "bulk"; items: Prepared[]; direction: "toB" | "toA" };

/**
 * 두 호스트의 사용자 범위 리소스를 나란히 견주는 화면 (설계 §5.9 "호스트 비교 화면").
 * 한쪽에만 있는 것과 내용이 다른 것을 보이고, 여기서 바로 반대편으로 복사한다(한 줄씩 또는 여러 줄을 골라 한꺼번에).
 * 덮어쓸 때는 대상에서 생기고 바뀌고 사라질 파일을 먼저 보여 준다.
 * 복사는 리소스 창의 "다른 호스트로"와 같은 길(resources.export·import, 사용자 범위)을 쓰고 출처를 기록한다.
 */
export function HostComparePanel({ hostId, hosts }: Props) {
  const others = hosts.filter((h) => h.id !== hostId);
  const [otherId, setOtherId] = useState(others[0]?.id ?? "");
  const [a, setA] = useState<HostInventory | undefined>();
  const [b, setB] = useState<HostInventory | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [pending, setPending] = useState<Pending | undefined>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const label = (id: string) => hosts.find((h) => h.id === id)?.label ?? id;

  async function load() {
    setError(undefined);
    setA(undefined);
    setB(undefined);
    if (!otherId) return;
    try {
      const [left, right] = await Promise.all([window.piDesktop.hostInventory(hostId), window.piDesktop.hostInventory(otherId)]);
      setA(left);
      setB(right);
    } catch (e) {
      setError(errorText(e));
    }
  }

  useEffect(() => {
    if (!others.some((h) => h.id === otherId)) setOtherId(others[0]?.id ?? "");
  }, [hostId]);

  useEffect(() => {
    setPending(undefined);
    setNotice(undefined);
    setPicked(new Set());
    void load();
  }, [hostId, otherId]);

  const rows = useMemo(() => (a && b ? compareRows(a, b) : []), [a, b]);
  const summary = compareSummary(rows);
  const shown = onlyDiff ? rows.filter((r) => r.state !== "same") : rows;
  const pickedRows = rows.filter((r) => picked.has(r.key));

  /** 복사 하나를 준비한다: 원본을 읽고 경고를 만들고, withChanges면 대상의 지금 파일과 견준다 */
  async function prepare(row: CompareRow, direction: "toB" | "toA", withChanges: boolean): Promise<Prepared> {
    const [from, to] = direction === "toB" ? [a!, b!] : [b!, a!];
    const item = direction === "toB" ? row.a! : row.b!;
    const target = direction === "toB" ? row.b : row.a;
    const prepared: Prepared = { key: row.key, from, to, toLabel: label(to.hostId), item, overwrite: row.state === "different", warnings: [], files: [] };
    if (item.kind === "context") {
      const source = await window.piDesktop.readResource(from.hostId, "", item.path);
      prepared.files = [{ path: item.name, contentBase64: textToBase64(source.content) }];
      if (withChanges && target) {
        const now = await window.piDesktop.readResource(to.hostId, "", target.path);
        prepared.changes = fileChanges(prepared.files, [{ path: item.name, contentBase64: textToBase64(now.content) }]);
      }
      return prepared;
    }
    const exported = await window.piDesktop.exportResource(from.hostId, item.kind, item.path);
    prepared.files = exported.files.map((f) => ({ path: f.path, contentBase64: f.contentBase64 }));
    prepared.warnings = item.kind === "extension" ? extensionWarnings(exported.files, to.platform) : copyWarnings(exported.files, to.platform);
    if (exported.skipped?.length) prepared.warnings.push(`${exported.skipped.join(", ")}은(는) 옮기지 않습니다.`);
    if (exported.needsInstall) prepared.warnings.push("package.json의 의존성은 대상 폴더에서 npm install로 받아야 확장이 돕니다.");
    if (withChanges && target) {
      const now = await window.piDesktop.exportResource(to.hostId, item.kind, target.path);
      prepared.changes = fileChanges(prepared.files, now.files);
    }
    return prepared;
  }

  /** 한 줄 복사. 경고가 없고 덮어쓰지 않으면 바로 복사하고, 아니면 차이·경고를 보이고 묻는다 */
  async function copyOne(row: CompareRow, direction: "toB" | "toA") {
    setNotice(undefined);
    setError(undefined);
    setBusy(true);
    try {
      const prepared = await prepare(row, direction, row.state === "different");
      if (prepared.overwrite || prepared.warnings.length > 0) setPending({ kind: "one", item: prepared });
      else await run([prepared]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  /** 고른 줄을 한꺼번에. 덮어쓰거나 경고가 있으면 한 번에 모아 묻는다 */
  async function copyBulk(direction: "toB" | "toA") {
    setNotice(undefined);
    setError(undefined);
    setBusy(true);
    try {
      const prepared: Prepared[] = [];
      for (const row of bulkCopyable(pickedRows, direction)) prepared.push(await prepare(row, direction, false));
      if (prepared.some((p) => p.overwrite || p.warnings.length > 0)) setPending({ kind: "bulk", items: prepared, direction });
      else await run(prepared);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  /** 준비한 복사들을 차례로 한다. 하나가 실패해도 나머지는 계속하고, 끝나면 목록을 다시 읽는다 */
  async function run(items: Prepared[]) {
    setBusy(true);
    setError(undefined);
    const done: string[] = [];
    const failed: string[] = [];
    for (const p of items) {
      try {
        let toPath: string;
        if (p.item.kind === "context") {
          toPath = joinHostPath(p.to.agentDir, p.item.name, p.to.platform);
          const existing = await window.piDesktop.readResource(p.to.hostId, "", toPath).catch(() => null);
          const content = new TextDecoder().decode(Uint8Array.from(atob(p.files[0]!.contentBase64), (c) => c.charCodeAt(0)));
          await window.piDesktop.writeResource(p.to.hostId, "", toPath, content, existing?.mtimeMs);
        } else {
          const result = await window.piDesktop.importResourceFiles(p.to.hostId, {
            cwd: "",
            kind: p.item.kind,
            scope: "user",
            name: importName(p.item.name),
            files: p.files,
            ...(p.overwrite ? { replace: true } : {}),
          });
          toPath = copiedEntryPath(p.item.kind, result.target, p.item.path, p.files.length);
        }
        void window.piDesktop
          .recordCopy({ kind: p.item.kind, name: p.item.name, fromHostId: p.from.hostId, fromPath: p.item.path, toHostId: p.to.hostId, toPath, files: p.files })
          .catch(() => {});
        done.push(`${KIND_TEXT[p.item.kind]} ${p.item.name}`);
      } catch (e) {
        const message = errorText(e);
        failed.push(`${p.item.name}: ${isAlreadyExists(message) ? `${message} (목록을 다시 읽은 뒤 해 보세요)` : message}`);
      }
    }
    setPending(undefined);
    setPicked(new Set());
    const toLabel = items[0]?.toLabel ?? "";
    if (done.length > 0) {
      const overwrote = items.some((p) => p.overwrite);
      setNotice(`${toLabel}에 ${done.join(", ")}을(를) 복사했습니다.${overwrote ? " 덮어쓴 것의 이전 내용은 그 호스트의 백업 폴더에 남습니다." : ""}`);
    }
    if (failed.length > 0) setError(`복사하지 못한 것: ${failed.join(" / ")}`);
    setBusy(false);
    await load();
  }

  if (others.length === 0) {
    return <p className="muted">다른 호스트(WSL·SSH)를 추가하면 두 호스트의 스킬·프롬프트·확장·AGENTS.md를 견줄 수 있습니다.</p>;
  }

  const aLabel = label(hostId);
  const bLabel = label(otherId);
  const toB = bulkCopyable(pickedRows, "toB").length;
  const toA = bulkCopyable(pickedRows, "toA").length;

  return (
    <div className="host-compare">
      <div className="settings-copy-head">
        <label>
          {aLabel}와(과) 견줄 호스트{" "}
          <select value={otherId} onChange={(e) => setOtherId(e.target.value)}>
            {others.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> 다른 것만
        </label>
        <span className="spacer" />
        <button type="button" disabled={busy} onClick={() => void load()}>
          다시 읽기
        </button>
      </div>
      <p className="muted">
        사용자 범위(데이터 폴더)의 스킬·프롬프트·확장·AGENTS.md를 견줍니다. 패키지에 든 것과 프로젝트 범위는 빼고 봅니다.
        {rows.length > 0 &&
          ` 같음 ${summary.same} · 내용 다름 ${summary.different} · ${aLabel}에만 ${summary.onlyA} · ${bLabel}에만 ${summary.onlyB}${summary.unknown ? ` · 확인 못함 ${summary.unknown}` : ""}`}
      </p>
      {picked.size > 0 && !pending && (
        <div className="host-compare-bulk">
          <span>{picked.size}개 고름</span>
          <button type="button" className="small" disabled={busy || toB === 0} onClick={() => void copyBulk("toB")}>
            {toB}개 → {bLabel}
          </button>
          <button type="button" className="small" disabled={busy || toA === 0} onClick={() => void copyBulk("toA")}>
            {toA}개 ← {aLabel}
          </button>
          <button type="button" className="small" disabled={busy} onClick={() => setPicked(new Set())}>
            고르기 취소
          </button>
        </div>
      )}
      {pending?.kind === "bulk" && (
        <BulkConfirm pending={pending} busy={busy} onConfirm={() => void run(pending.items)} onCancel={() => setPending(undefined)} />
      )}
      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner ok">{notice}</div>}
      {busy && !pending && <p className="muted">준비하는 중…</p>}
      {(!a || !b) && !error && <p className="muted">두 호스트의 리소스를 읽는 중…</p>}
      {a && b && shown.length === 0 && <p className="muted">{rows.length === 0 ? "견줄 리소스가 없습니다." : "두 호스트가 같습니다."}</p>}
      {shown.length > 0 && (
        <table className="pi-checks settings-copy-table host-compare-table">
          <thead>
            <tr>
              <th />
              <th>종류</th>
              <th>이름</th>
              <th>상태</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <CompareLine
                key={row.key}
                row={row}
                aLabel={aLabel}
                bLabel={bLabel}
                busy={busy}
                picked={picked.has(row.key)}
                onPick={(on) =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(row.key);
                    else next.delete(row.key);
                    return next;
                  })
                }
                pending={pending?.kind === "one" && pending.item.key === row.key ? pending.item : undefined}
                onCopy={(direction) => void copyOne(row, direction)}
                onConfirm={() => pending?.kind === "one" && void run([pending.item])}
                onCancel={() => setPending(undefined)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CompareLine({
  row,
  aLabel,
  bLabel,
  busy,
  picked,
  onPick,
  pending,
  onCopy,
  onConfirm,
  onCancel,
}: {
  row: CompareRow;
  aLabel: string;
  bLabel: string;
  busy: boolean;
  picked: boolean;
  onPick: (on: boolean) => void;
  pending: Prepared | undefined;
  onCopy: (direction: "toB" | "toA") => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const problem = row.a?.error ?? row.b?.error;
  const canCopy = row.state !== "same" && row.state !== "unknown";
  return (
    <>
      <tr className={row.state === "same" ? "muted" : undefined}>
        <td>
          <input type="checkbox" aria-label={`${row.name} 고르기`} disabled={!canCopy || busy} checked={picked} onChange={(e) => onPick(e.target.checked)} />
        </td>
        <td>{KIND_TEXT[row.kind]}</td>
        <th title={[row.a?.path, row.b?.path].filter(Boolean).join("\n")}>{row.name}</th>
        <td>
          {stateText(row.state, aLabel, bLabel)}
          {problem && <div className="check-detail">{problem}</div>}
        </td>
        <td className="host-compare-actions">
          {canCopy && row.a && (
            <button type="button" className="small" disabled={busy} onClick={() => onCopy("toB")} title={`${aLabel}의 것을 ${bLabel}로 복사`}>
              → {bLabel}
            </button>
          )}
          {canCopy && row.b && (
            <button type="button" className="small" disabled={busy} onClick={() => onCopy("toA")} title={`${bLabel}의 것을 ${aLabel}로 복사`}>
              ← {aLabel}
            </button>
          )}
        </td>
      </tr>
      {pending && (
        <tr>
          <td colSpan={5}>
            {pending.overwrite && (
              <div className="banner warn">
                {pending.toLabel}의 {row.name}을(를) 덮어씁니다. 이전 것은 그 호스트의 백업 폴더에 남습니다.
              </div>
            )}
            {pending.changes && <ChangesView changes={pending.changes} />}
            {pending.warnings.map((w) => (
              <div key={w} className="banner warn">
                {w}
              </div>
            ))}
            <div className="modal-actions">
              <button type="button" onClick={onCancel}>
                취소
              </button>
              <button type="button" className={pending.overwrite ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>
                {busy ? "복사 중…" : pending.overwrite ? "덮어쓰기" : "복사"}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const CHANGE_TEXT = { added: "새로 생김", removed: "대상에만 있어 사라짐", changed: "바뀜" } as const;

/** 덮어쓰면 대상에서 달라질 파일들 (− 대상의 지금 내용 · + 복사할 내용) */
function ChangesView({ changes }: { changes: FileChange[] }) {
  if (changes.length === 0) return <div className="muted">파일 내용은 같습니다.</div>;
  return (
    <div className="host-compare-changes">
      <div className="muted">덮어쓰면 대상에서 이렇게 달라집니다 (− 대상의 지금 내용 · + 복사할 내용).</div>
      {changes.map((c) => (
        <details key={c.path} open={changes.length <= 3}>
          <summary>
            <code>{c.path}</code> · {CHANGE_TEXT[c.change]}
          </summary>
          {c.before === undefined && c.after === undefined ? (
            <div className="muted">글 파일이 아니라 내용을 보이지 않습니다.</div>
          ) : (
            <DiffView lines={lineDiff(c.before ?? "", c.after ?? "")} />
          )}
        </details>
      ))}
    </div>
  );
}

/** 여러 줄을 한꺼번에 복사하기 전에 덮어쓸 것과 경고를 모아 묻는다 */
function BulkConfirm({
  pending,
  busy,
  onConfirm,
  onCancel,
}: {
  pending: { items: Prepared[] };
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const overwrites = pending.items.filter((p) => p.overwrite);
  const warned = pending.items.filter((p) => p.warnings.length > 0);
  const toLabel = pending.items[0]?.toLabel ?? "";
  return (
    <div className="banner warn host-compare-bulk-confirm">
      <div>
        {toLabel}에 {pending.items.length}개를 복사합니다.
      </div>
      {overwrites.length > 0 && (
        <div>
          덮어쓸 것({overwrites.length}): {overwrites.map((p) => p.item.name).join(", ")}. 이전 것은 그 호스트의 백업 폴더에 남습니다. 차이는 줄마다
          복사하면 볼 수 있습니다.
        </div>
      )}
      {warned.map((p) => (
        <div key={p.key}>
          {p.item.name}: {p.warnings.join(" ")}
        </div>
      ))}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          취소
        </button>
        <button type="button" className={overwrites.length > 0 ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>
          {busy ? "복사 중…" : `${pending.items.length}개 복사`}
        </button>
      </div>
    </div>
  );
}
