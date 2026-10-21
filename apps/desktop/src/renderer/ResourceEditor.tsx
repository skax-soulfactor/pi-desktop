import { useState } from "react";
import type { ResourceFile } from "@pi-desktop/host-protocol/messages";
import { errorText } from "./folder-browser";

interface Props {
  hostId: string;
  cwd: string;
  file: ResourceFile;
  /** 화면에 보일 짧은 경로 */
  label: string;
  /** 저장했다 (목록을 다시 읽게) */
  onSaved: () => void;
  /** 보고 있는 세션에 바로 반영한다 (bridge의 /desktop:reload). 세션이 없거나 입력 권한이 없으면 주지 않는다 */
  onReload?: () => Promise<void>;
  onClose: () => void;
}

/**
 * 리소스 마크다운 편집기 (설계 §4.2~4.5). 데몬이 연 뒤 바뀐 파일은 덮어쓰지 않으므로,
 * 저장이 거부되면 다시 열어 바뀐 내용을 보게 한다.
 */
export function ResourceEditor({ hostId, cwd, file, label, onSaved, onReload, onClose }: Props) {
  const [base, setBase] = useState(file);
  const [draft, setDraft] = useState(file.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [reloaded, setReloaded] = useState(false);
  const [reloading, setReloading] = useState(false);
  const dirty = draft !== base.content;

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const result = await window.piDesktop.writeResource(hostId, cwd, base.path, draft, base.mtimeMs);
      setBase({ path: result.path, content: draft, mtimeMs: result.mtimeMs });
      setSaved(true);
      setReloaded(false);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function reopen() {
    try {
      const fresh = await window.piDesktop.readResource(hostId, cwd, base.path);
      setBase(fresh);
      setDraft(fresh.content);
      setError(undefined);
      setSaved(false);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="resource-editor">
      <div className="resource-editor-head">
        <span className="resource-path" title={base.path}>
          {label}
          {dirty ? " · 고침" : ""}
        </span>
        <span className="spacer" />
        <button type="button" onClick={() => void reopen()} title="파일을 다시 읽습니다 (고친 내용은 버려집니다)">
          다시 열기
        </button>
        <button
          type="button"
          onClick={() => {
            if (dirty) setAskDiscard(true);
            else onClose();
          }}
        >
          목록으로
        </button>
        <button type="button" className="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
      {askDiscard && (
        <div className="banner warn">
          <span>저장하지 않은 변경이 있습니다.</span>
          <button type="button" className="danger" onClick={onClose}>
            버리고 나가기
          </button>
          <button type="button" onClick={() => setAskDiscard(false)}>
            계속 고치기
          </button>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      {saved && !dirty && !onReload && (
        <div className="banner ok">저장했습니다. 새로 여는 세션부터 반영됩니다.</div>
      )}
      {saved && !dirty && onReload && (
        <div className="banner ok">
          <span>{reloaded ? "저장하고 지금 세션에 반영했습니다." : "저장했습니다. 지금 보고 있는 세션에는 아직 반영되지 않았습니다."}</span>
          {!reloaded && (
            <button
              type="button"
              className="primary"
              disabled={reloading}
              onClick={() => {
                setReloading(true);
                setError(undefined);
                onReload()
                  .then(() => setReloaded(true))
                  .catch((e: unknown) => setError(errorText(e)))
                  .finally(() => setReloading(false));
              }}
            >
              {reloading ? "반영 중…" : "지금 세션에 반영"}
            </button>
          )}
        </div>
      )}
      <textarea
        className="resource-textarea"
        value={draft}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            if (dirty && !saving) void save();
          }
        }}
        aria-label="리소스 내용"
      />
    </div>
  );
}
