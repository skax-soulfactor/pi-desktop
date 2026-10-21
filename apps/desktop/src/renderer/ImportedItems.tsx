import { useEffect, useState } from "react";
import type { ImportRecord, ImportStatus } from "../shared/api";
import { errorText } from "./folder-browser";
import { formatRelative } from "./format";
import { lineDiff } from "./text-diff";
import { DiffView } from "./ToolCards";
import type { DiffLine } from "./tool-view";

/**
 * 가져온 스킬·프롬프트 관리 (설계 §4.6): 업데이트 확인, 로컬 수정 감지, 차이 보기, 업데이트, 제거.
 * 업데이트와 제거는 바로 지우지 않고 그 호스트의 백업 폴더로 옮긴다.
 */
export function ImportedItems({ hostId }: { hostId: string }) {
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [statuses, setStatuses] = useState<Map<string, ImportStatus>>(new Map());
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  /** 한 번 더 누르라고 묻는 중인 동작 */
  const [confirm, setConfirm] = useState<{ target: string; action: "update" | "remove" } | undefined>();
  const [diffOf, setDiffOf] = useState<string | undefined>();

  async function reload() {
    setRecords(await window.piDesktop.listImports(hostId).catch(() => []));
  }

  async function check() {
    setChecking(true);
    setError(undefined);
    // 상태가 바뀌면 열어 둔 차이는 맞지 않으므로 닫는다.
    setDiffOf(undefined);
    try {
      const list = await window.piDesktop.importStatus(hostId);
      setStatuses(new Map(list.map((s) => [s.target, s])));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [hostId]);

  async function act(record: ImportRecord, action: "update" | "remove") {
    setBusy(record.target);
    setError(undefined);
    setConfirm(undefined);
    setDiffOf(undefined);
    try {
      if (action === "update") {
        await window.piDesktop.importUpdate(hostId, record.target);
        setInfo(`${record.name}을(를) 원본 최신으로 바꿨습니다. 이전 내용은 그 호스트의 백업 폴더(~/.pi-desktop/resource-backups/imports)에 있습니다.`);
      } else {
        await window.piDesktop.importRemove(hostId, record.target);
        setInfo(`${record.name}을(를) 없앴습니다. 백업 폴더(~/.pi-desktop/resource-backups/imports)로 옮겨 두었습니다.`);
      }
      await reload();
      await check();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  }

  if (records.length === 0) {
    // 마지막 항목을 지운 뒤에도 결과 안내는 보이게 한다.
    return (
      <>
        {info && <div className="banner ok">{info}</div>}
        <p className="muted">이 호스트로 가져온 스킬·프롬프트가 없습니다.</p>
      </>
    );
  }

  return (
    <div className="imported-items">
      <div className="install-steps">
        <button type="button" disabled={checking} onClick={() => void check()}>
          {checking ? "확인 중…" : "업데이트·수정 확인"}
        </button>
        <span className="muted">원본 저장소의 최신 커밋과, 이 호스트에서 고친 파일을 확인합니다.</span>
      </div>
      {error && <div className="banner error">{error}</div>}
      {info && <div className="banner ok">{info}</div>}
      <ul className="resource-list">
        {records.map((record) => {
          const status = statuses.get(record.target);
          const canDiff = status && status.upstreamSha && (status.local === "modified" || status.upstream === "changed");
          return (
            <li key={record.target} className="imported-row">
              <div className="resource-main">
                <span className="resource-name">
                  {record.kind === "prompt" ? `/${record.name}` : record.name}
                  <span className="resource-badge">{record.kind === "skill" ? "스킬" : "프롬프트"}</span>
                  <span className="resource-badge">{record.scope === "user" ? "사용자" : "프로젝트"}</span>
                  {status && <StatusBadges status={status} />}
                </span>
                <span className="muted market-meta">
                  {record.source.owner}/{record.source.repo}/{record.source.path} @ {record.source.sha.slice(0, 7)} ·{" "}
                  {formatRelative(record.importedAt)} 가져옴
                </span>
                {status?.error && <span className="resource-problem">{status.error}</span>}
                {diffOf === record.target && status?.upstreamSha && <DiffPanel hostId={hostId} record={record} status={status} />}
              </div>
              <div className="imported-actions">
                {canDiff && (
                  <button type="button" className="small" onClick={() => setDiffOf(diffOf === record.target ? undefined : record.target)}>
                    {diffOf === record.target ? "차이 닫기" : "차이 보기"}
                  </button>
                )}
                {status?.upstream === "changed" &&
                  (confirm?.target === record.target && confirm.action === "update" ? (
                    <button type="button" className="small danger" disabled={busy !== undefined} onClick={() => void act(record, "update")}>
                      {status.local === "modified" ? "고친 내용 백업하고 바꾸기" : "정말 업데이트"}
                    </button>
                  ) : (
                    <button type="button" className="small primary" disabled={busy !== undefined} onClick={() => setConfirm({ target: record.target, action: "update" })}>
                      업데이트
                    </button>
                  ))}
                {confirm?.target === record.target && confirm.action === "remove" ? (
                  <button type="button" className="small danger" disabled={busy !== undefined} onClick={() => void act(record, "remove")}>
                    정말 제거
                  </button>
                ) : (
                  <button type="button" className="small" disabled={busy !== undefined} onClick={() => setConfirm({ target: record.target, action: "remove" })}>
                    제거
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusBadges({ status }: { status: ImportStatus }) {
  return (
    <>
      {status.local === "modified" && <span className="resource-badge off">이 호스트에서 고침 {status.localChanged.length}개</span>}
      {status.local === "missing" && <span className="resource-badge off">파일이 사라짐</span>}
      {status.upstream === "changed" && <span className="resource-badge on">원본 새 버전 ({status.upstreamChanged.length}개 파일)</span>}
      {status.upstream === "gone" && <span className="resource-badge off">원본에서 사라짐</span>}
      {status.upstream === "same" && status.local === "same" && <span className="resource-badge">최신</span>}
    </>
  );
}

/** 바뀐 파일을 골라 이 호스트의 내용과 원본 최신 내용을 비교한다 */
function DiffPanel({ hostId, record, status }: { hostId: string; record: ImportRecord; status: ImportStatus }) {
  const files = [...new Set([...status.localChanged, ...status.upstreamChanged])].sort();
  const [file, setFile] = useState(files[0]);
  const [lines, setLines] = useState<DiffLine[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!file) return;
    setLines(undefined);
    setError(undefined);
    // 프롬프트는 파일 하나라 경로를 쓰지 않는다.
    const path = record.kind === "prompt" ? "" : file;
    window.piDesktop
      .importDiff(hostId, record.target, path, status.upstreamSha!)
      .then((d) => setLines(lineDiff(d.local, d.upstream)))
      .catch((e: unknown) => setError(errorText(e)));
  }, [file]);

  return (
    <div className="imported-diff">
      <div className="install-steps">
        <select value={file} onChange={(e) => setFile(e.target.value)} aria-label="비교할 파일">
          {files.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <span className="muted">− 이 호스트 · + 원본 최신 ({status.upstreamSha!.slice(0, 7)})</span>
      </div>
      {error && <div className="banner error">{error}</div>}
      {lines === undefined ? <p className="muted">불러오는 중…</p> : lines.length === 0 ? <p className="muted">내용이 같습니다.</p> : <DiffView lines={lines} />}
    </div>
  );
}
