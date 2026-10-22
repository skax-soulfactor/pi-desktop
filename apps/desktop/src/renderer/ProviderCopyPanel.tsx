import { useEffect, useState } from "react";
import type { HostDescriptor } from "../shared/api";
import { droppedText, isAlreadyExists, isLocalEndpoint } from "./copy-view";
import { errorText } from "./folder-browser";

interface Props {
  hosts: HostDescriptor[];
  fromHostId: string;
  providerId: string;
  baseUrl: string | undefined;
  /** 그 프로바이더의 모델 ID들 (모델 하나만 옮길 때 고른다) */
  models: string[];
  onClose: () => void;
}

/** 옮길 것: 프로바이더 전체, 또는 그 안의 모델 하나 */
type Exported = { kind: "provider"; data: Record<string, unknown>; dropped: string[] } | { kind: "model"; data: Record<string, unknown>; dropped: string[] };

/**
 * models.json의 프로바이더 하나, 또는 그 안의 모델 하나를 다른 호스트로 복사 (설계 §5.9 "프로바이더·모델 항목 단위로").
 * compat·headers 같은 폼 밖 필드도 옮기되, 비밀일 수 있는 값(그대로 키 값인 apiKey·헤더)은 빼고 알린다.
 * 모델 하나는 대상에 같은 이름의 프로바이더가 있어야 한다.
 */
export function ProviderCopyPanel({ hosts, fromHostId, providerId, baseUrl, models, onClose }: Props) {
  const targets = hosts.filter((h) => h.id !== fromHostId);
  const [toHostId, setToHostId] = useState(targets[0]?.id ?? "");
  /** 빈 글이면 프로바이더 전체, 아니면 그 모델 ID */
  const [modelId, setModelId] = useState("");
  const [exported, setExported] = useState<Exported | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [exists, setExists] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setExported(undefined);
    setError(undefined);
    setExists(false);
    const load = modelId
      ? window.piDesktop.modelsExportModel(fromHostId, providerId, modelId).then((r): Exported => ({ kind: "model", data: r.model, dropped: r.dropped }))
      : window.piDesktop.modelsExport(fromHostId, providerId).then((r): Exported => ({ kind: "provider", data: r.provider, dropped: r.dropped }));
    void load.then(setExported, (e: unknown) => setError(errorText(e)));
  }, [fromHostId, providerId, modelId]);

  async function copy(replace: boolean) {
    if (!exported) return;
    setBusy(true);
    setError(undefined);
    try {
      if (exported.kind === "model") await window.piDesktop.modelsImportModel(toHostId, providerId, exported.data, replace);
      else await window.piDesktop.modelsImport(toHostId, providerId, exported.data, replace);
      setDone(true);
      setExists(false);
    } catch (e) {
      const message = errorText(e);
      setExists(isAlreadyExists(message));
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const hostLabel = hosts.find((h) => h.id === toHostId)?.label ?? toHostId;
  const dropped = exported ? droppedText(exported.dropped) : undefined;
  const what = modelId ? `${providerId}/${modelId} 모델` : providerId;

  return (
    <div className="banner info provider-copy">
      {done ? (
        <span>
          {hostLabel}의 models.json에 {what}을(를) 복사했습니다.{dropped ? " 빠진 키는 그 호스트에서 넣어 주세요." : ""}
        </span>
      ) : (
        <div className="provider-copy-body">
          <label>
            복사할 것{" "}
            <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
              <option value="">프로바이더 전체 ({providerId})</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  모델 하나: {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            복사할 호스트{" "}
            <select value={toHostId} onChange={(e) => setToHostId(e.target.value)}>
              {targets.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
          {modelId && <div className="muted">대상에 같은 이름의 프로바이더({providerId})가 있어야 합니다. 없으면 프로바이더 전체를 옮기세요.</div>}
          {dropped && <div className="resource-problem">{dropped}</div>}
          {!modelId && isLocalEndpoint(baseUrl) && (
            <div className="resource-problem">
              {baseUrl}은 대상 호스트 기준의 주소입니다. 대상 호스트에서도 같은 서버가 떠 있어야 합니다 (WSL·SSH에서 Windows의 서버는 localhost로 닿지 않을 수 있습니다).
            </div>
          )}
          {error && <div className="resource-problem error">{error}</div>}
        </div>
      )}
      {!done && exists && (
        <button type="button" className="small danger" disabled={busy} onClick={() => void copy(true)} title="대상의 키·헤더 값은 남깁니다">
          대상의 것을 바꾸기
        </button>
      )}
      {!done && (
        <button type="button" className="small primary" disabled={busy || !exported || !toHostId} onClick={() => void copy(false)}>
          {busy ? "복사 중…" : "복사"}
        </button>
      )}
      <button type="button" className="small" onClick={onClose}>
        {done ? "닫기" : "취소"}
      </button>
    </div>
  );
}
