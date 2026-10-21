import { useEffect, useMemo, useState } from "react";
import type { HostDescriptor, HostInventory, InventoryItem } from "../shared/api";
import { copiedEntryPath, copyWarnings, extensionWarnings, isAlreadyExists, joinHostPath, textToBase64 } from "./copy-view";
import { errorText } from "./folder-browser";
import { compareRows, compareSummary, KIND_TEXT, stateText, type CompareRow } from "./host-compare-view";
import { importName } from "./market-view";

interface Props {
  hostId: string;
  hosts: HostDescriptor[];
}

/** 복사하기 전에 확인을 받을 것: 대상 OS 경고나 덮어쓰기 */
interface Pending {
  key: string;
  from: HostInventory;
  to: HostInventory;
  toLabel: string;
  item: InventoryItem;
  overwrite: boolean;
  warnings: string[];
  files?: Array<{ path: string; contentBase64: string }>;
}

/**
 * 두 호스트의 사용자 범위 리소스를 나란히 견주는 화면 (설계 §5.9 "호스트 비교 화면").
 * 한쪽에만 있는 것과 내용이 다른 것을 보이고, 여기서 바로 반대편으로 복사한다.
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
    void load();
  }, [hostId, otherId]);

  const rows = useMemo(() => (a && b ? compareRows(a, b) : []), [a, b]);
  const summary = compareSummary(rows);
  const shown = onlyDiff ? rows.filter((r) => r.state !== "same") : rows;

  /** 복사를 준비한다. 경고가 없고 덮어쓰지 않으면 바로 복사한다 */
  async function prepare(row: CompareRow, direction: "toB" | "toA") {
    const [from, to] = direction === "toB" ? [a!, b!] : [b!, a!];
    const item = direction === "toB" ? row.a! : row.b!;
    const next: Pending = { key: row.key, from, to, toLabel: label(to.hostId), item, overwrite: row.state === "different", warnings: [] };
    setNotice(undefined);
    setError(undefined);
    try {
      if (item.kind !== "context") {
        const exported = await window.piDesktop.exportResource(from.hostId, item.kind, item.path);
        next.files = exported.files.map((f) => ({ path: f.path, contentBase64: f.contentBase64 }));
        next.warnings =
          item.kind === "extension" ? extensionWarnings(exported.files, to.platform) : copyWarnings(exported.files, to.platform);
        if (exported.skipped?.length) next.warnings.push(`${exported.skipped.join(", ")}은(는) 옮기지 않습니다.`);
        if (exported.needsInstall) next.warnings.push("package.json의 의존성은 대상 폴더에서 npm install로 받아야 확장이 돕니다.");
      }
    } catch (e) {
      setError(errorText(e));
      return;
    }
    if (next.overwrite || next.warnings.length > 0) setPending(next);
    else await run(next);
  }

  async function run(p: Pending) {
    setBusy(true);
    setError(undefined);
    try {
      let toPath: string;
      let files: Array<{ path: string; contentBase64: string }>;
      if (p.item.kind === "context") {
        const source = await window.piDesktop.readResource(p.from.hostId, "", p.item.path);
        toPath = joinHostPath(p.to.agentDir, p.item.name, p.to.platform);
        const existing = await window.piDesktop.readResource(p.to.hostId, "", toPath).catch(() => null);
        await window.piDesktop.writeResource(p.to.hostId, "", toPath, source.content, existing?.mtimeMs);
        files = [{ path: p.item.name, contentBase64: textToBase64(source.content) }];
      } else {
        files = p.files!;
        const result = await window.piDesktop.importResourceFiles(p.to.hostId, {
          cwd: "",
          kind: p.item.kind,
          scope: "user",
          name: importName(p.item.name),
          files,
          ...(p.overwrite ? { replace: true } : {}),
        });
        toPath = copiedEntryPath(p.item.kind, result.target, p.item.path, files.length);
      }
      void window.piDesktop
        .recordCopy({
          kind: p.item.kind,
          name: p.item.name,
          fromHostId: p.from.hostId,
          fromPath: p.item.path,
          toHostId: p.to.hostId,
          toPath,
          files,
        })
        .catch(() => {});
      setPending(undefined);
      setNotice(`${p.toLabel}에 ${KIND_TEXT[p.item.kind]} ${p.item.name}을(를) 복사했습니다.${p.overwrite ? " 이전 것은 그 호스트의 백업 폴더에 남습니다." : ""}`);
      await load();
    } catch (e) {
      const message = errorText(e);
      setError(isAlreadyExists(message) ? `${message} (목록을 다시 읽은 뒤 해 보세요)` : message);
    } finally {
      setBusy(false);
    }
  }

  if (others.length === 0) {
    return <p className="muted">다른 호스트(WSL·SSH)를 추가하면 두 호스트의 스킬·프롬프트·확장·AGENTS.md를 견줄 수 있습니다.</p>;
  }

  const aLabel = label(hostId);
  const bLabel = label(otherId);

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
      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner ok">{notice}</div>}
      {(!a || !b) && !error && <p className="muted">두 호스트의 리소스를 읽는 중…</p>}
      {a && b && shown.length === 0 && <p className="muted">{rows.length === 0 ? "견줄 리소스가 없습니다." : "두 호스트가 같습니다."}</p>}
      {shown.length > 0 && (
        <table className="pi-checks settings-copy-table host-compare-table">
          <thead>
            <tr>
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
                pending={pending?.key === row.key ? pending : undefined}
                onCopy={(direction) => void prepare(row, direction)}
                onConfirm={() => pending && void run(pending)}
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
  pending,
  onCopy,
  onConfirm,
  onCancel,
}: {
  row: CompareRow;
  aLabel: string;
  bLabel: string;
  busy: boolean;
  pending: Pending | undefined;
  onCopy: (direction: "toB" | "toA") => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const problem = row.a?.error ?? row.b?.error;
  const canCopy = row.state !== "same" && row.state !== "unknown";
  return (
    <>
      <tr className={row.state === "same" ? "muted" : undefined}>
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
          <td colSpan={4}>
            {pending.overwrite && (
              <div className="banner warn">
                {pending.toLabel}의 {row.name}을(를) 덮어씁니다. 이전 것은 그 호스트의 백업 폴더에 남습니다.
              </div>
            )}
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
