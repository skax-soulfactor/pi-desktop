import { useEffect, useState } from "react";
import { errorText } from "./folder-browser";

interface Props {
  hostId: string;
  hostLabel: string;
  /** 처음 넣을 상위 폴더 (지금 입력한 작업 폴더). 비었으면 홈 */
  initialParent: string;
  /** 상위 폴더를 고르는 창을 연다 (로컬은 OS 대화상자, 그 밖은 폴더 탐색 창). 고른 경로를 돌려준다 */
  onBrowse: (current: string) => Promise<string | undefined>;
  /** 만든 폴더. startSession이면 바로 그 폴더에서 새 세션을 연다 */
  onCreated: (path: string, startSession: boolean) => void;
  onClose: () => void;
}

/**
 * 세션을 시작할 새 폴더를 만든다 (그 호스트에서: 로컬·WSL·SSH). 만든 뒤 작업 폴더로 넣거나 바로 새 세션을 연다.
 */
export function NewFolderDialog({ hostId, hostLabel, initialParent, onBrowse, onCreated, onClose }: Props) {
  const [parent, setParent] = useState(initialParent);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // 상위 폴더가 비었으면 그 호스트의 홈을 넣어 둔다 (어디에 만들어지는지 보이게).
  useEffect(() => {
    if (initialParent.trim()) return;
    void window.piDesktop.listDir(hostId, undefined).then((r) => setParent((p) => p || r.home), () => {});
  }, [hostId]);

  async function create(startSession: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const path = await window.piDesktop.makeDir(hostId, parent.trim(), name.trim());
      onCreated(path, startSession);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal new-folder" role="dialog" aria-label="새 폴더" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="modal-title">새 폴더 ({hostLabel})</h2>
        <form
          className="ssh-host-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create(true);
          }}
        >
          <label>
            만들 위치
            <div className="new-folder-parent">
              <input value={parent} onChange={(e) => setParent(e.target.value)} placeholder="비우면 홈" spellCheck={false} />
              <button
                type="button"
                disabled={busy}
                onClick={() => void onBrowse(parent).then((picked) => picked && setParent(picked))}
              >
                찾아보기
              </button>
            </div>
          </label>
          <label>
            폴더 이름
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" spellCheck={false} autoFocus />
          </label>
          {error && <div className="banner error">{error}</div>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              취소
            </button>
            <button type="button" disabled={busy || !name.trim()} onClick={() => void create(false)}>
              만들기
            </button>
            <button type="submit" className="primary" disabled={busy || !name.trim()}>
              {busy ? "만드는 중…" : "만들고 새 세션"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
