import { useEffect, useState } from "react";
import type { ResourceFile } from "@pi-desktop/host-protocol/messages";
import type { HostDescriptor } from "../shared/api";
import { baseNameOf, joinHostPath, textToBase64 } from "./copy-view";
import { errorText } from "./folder-browser";
import { lineDiff } from "./text-diff";
import { DiffView } from "./ToolCards";

interface Props {
  hosts: HostDescriptor[];
  fromHostId: string;
  /** 원본 호스트 데이터 폴더의 AGENTS.md·SYSTEM.md·APPEND_SYSTEM.md */
  path: string;
  onClose: () => void;
}

/**
 * 사용자 범위 AGENTS.md·SYSTEM.md·APPEND_SYSTEM.md를 다른 호스트로 복사 (설계 §5.9).
 * 대상 데이터 폴더의 같은 이름 파일로 쓴다. 이미 있으면 차이를 보여 주고 덮어쓸지 묻는다
 * (덮어쓰기 전 내용은 대상의 리소스 백업에 남는다).
 */
export function ContextCopyDialog({ hosts, fromHostId, path, onClose }: Props) {
  const targets = hosts.filter((h) => h.id !== fromHostId);
  const fileName = baseNameOf(path);
  const [toHostId, setToHostId] = useState(targets[0]?.id ?? "");
  const [source, setSource] = useState<ResourceFile | undefined>();
  const [targetPath, setTargetPath] = useState<string | undefined>();
  /** 대상에 이미 있는 파일. undefined면 아직 모름, null이면 없음 */
  const [existing, setExisting] = useState<ResourceFile | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<string | undefined>();

  useEffect(() => {
    void window.piDesktop.readResource(fromHostId, "", path).then(setSource, (e: unknown) => setError(errorText(e)));
  }, [fromHostId, path]);

  // 대상 데이터 폴더와 그곳의 같은 이름 파일을 읽는다.
  useEffect(() => {
    setTargetPath(undefined);
    setExisting(undefined);
    setError(undefined);
    if (!toHostId) return;
    void (async () => {
      try {
        const status = await window.piDesktop.piStatus(toHostId);
        const target = joinHostPath(status.data.agentDir, fileName, status.platform);
        setTargetPath(target);
        setExisting(await window.piDesktop.readResource(toHostId, "", target).catch(() => null));
      } catch (e) {
        setError(errorText(e));
      }
    })();
  }, [toHostId]);

  async function copy() {
    if (!source || !targetPath || existing === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await window.piDesktop.writeResource(toHostId, "", targetPath, source.content, existing?.mtimeMs);
      setDone(targetPath);
      // 출처 기록은 안내용이라 실패해도 복사는 끝난 것으로 둔다.
      void window.piDesktop
        .recordCopy({
          kind: "context",
          name: fileName,
          fromHostId,
          fromPath: path,
          toHostId,
          toPath: targetPath,
          files: [{ path: fileName, contentBase64: textToBase64(source.content) }],
        })
        .catch(() => {});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const same = existing && source && existing.content === source.content;
  const diff = existing && source && !same ? lineDiff(existing.content, source.content) : undefined;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal copy-resource" role="dialog" aria-label="다른 호스트로 복사" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="modal-title">다른 호스트로 복사: {fileName} (사용자)</h2>
        {targets.length === 0 ? (
          <div className="banner warn">복사할 다른 호스트가 없습니다.</div>
        ) : done ? (
          <div className="banner ok">
            복사했습니다: {done}
            {"\n"}대상 호스트에서 새로 여는 세션부터 쓰입니다.
          </div>
        ) : (
          <div className="ssh-host-form">
            <label>
              대상 호스트
              <select value={toHostId} onChange={(e) => setToHostId(e.target.value)}>
                {targets.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="muted">{targetPath ? `대상 파일: ${targetPath}` : "대상 데이터 폴더를 찾는 중…"}</div>
            {existing === null && <div className="banner info">대상에 없는 파일이라 새로 만듭니다.</div>}
            {same && <div className="banner info">대상의 내용이 이미 같습니다.</div>}
            {diff && (
              <>
                <div className="banner warn">대상에 이미 있습니다. 덮어쓰면 아래처럼 바뀝니다 (− 대상의 지금 내용 · + 복사할 내용). 이전 내용은 대상의 리소스 백업에 남습니다.</div>
                <DiffView lines={diff} />
              </>
            )}
          </div>
        )}
        {error && <div className="banner error">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {done ? "닫기" : "취소"}
          </button>
          {!done && targets.length > 0 && (
            <button
              type="button"
              className={diff ? "danger" : "primary"}
              disabled={busy || !source || !targetPath || existing === undefined || Boolean(same)}
              onClick={() => void copy()}
            >
              {busy ? "복사 중…" : diff ? "덮어쓰기" : "복사"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
