import { useEffect, useState } from "react";
import type { SettingsReadResult, SettingsTarget } from "@pi-desktop/host-protocol/messages";
import { errorText } from "./folder-browser";
import { jsonProblem } from "./settings-form";
import { lineDiff } from "./text-diff";
import { DiffView } from "./ToolCards";

interface Props {
  hostId: string;
  target: SettingsTarget | undefined;
}

/**
 * settings.json 원본 편집 (설계 §4.8 "원본 JSON 편집 모드").
 * 폼으로 다루지 않는 목록·묶음이나 깨진 파일을 고칠 때 쓴다. 저장 전에 차이를 보이고,
 * 읽은 뒤 다른 곳(Pi 등)에서 파일이 바뀌었으면 덮어쓰지 않는다. 이전 파일은 .bak으로 남는다.
 */
export function SettingsJsonEditor({ hostId, target }: Props) {
  const [file, setFile] = useState<SettingsReadResult | undefined>();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  async function load() {
    try {
      const next = await window.piDesktop.settingsRead(hostId, target);
      setFile(next);
      setText(next.raw || "{\n}\n");
      setPreview(false);
    } catch (e) {
      setError(errorText(e));
    }
  }

  useEffect(() => {
    void load();
  }, [hostId]);

  if (!file) return error ? <div className="banner error">{error}</div> : <p className="muted">settings.json을 읽는 중…</p>;

  const original = file.raw || "{\n}\n";
  const problem = jsonProblem(text);
  const changed = text !== original;

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const hadFile = file!.exists;
      await window.piDesktop.settingsWrite(hostId, text, file!.mtimeMs ?? null, target);
      await load();
      setNotice(`저장했습니다.${hadFile ? " 이전 파일은 settings.json.bak에 남습니다." : " 파일을 새로 만들었습니다."} 새로 여는 세션부터 쓰입니다.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-json">
      <p className="muted">
        {file.path}
        {file.exists ? "" : " (아직 없음, 저장하면 만듭니다)"}
      </p>
      {file.error && <div className="banner warn">{file.error} 여기서 고쳐 저장할 수 있습니다.</div>}
      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner ok">{notice}</div>}
      {preview ? (
        <>
          <DiffView lines={lineDiff(original, text)} />
          <div className="modal-actions">
            <button type="button" onClick={() => setPreview(false)}>
              계속 고치기
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>
        </>
      ) : (
        <>
          <textarea
            className="settings-json-text"
            value={text}
            spellCheck={false}
            onChange={(e) => {
              setNotice(undefined);
              setText(e.target.value);
            }}
          />
          {problem && changed && <div className="banner warn">{problem}</div>}
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={() => void load()}>
              다시 읽기
            </button>
            <button type="button" className="primary" disabled={busy || !changed || Boolean(problem)} onClick={() => setPreview(true)}>
              {changed ? "차이 보고 저장…" : "바뀐 것 없음"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
