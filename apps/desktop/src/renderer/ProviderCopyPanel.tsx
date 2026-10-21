import { useEffect, useState } from "react";
import type { ModelsExportResult } from "@pi-desktop/host-protocol/messages";
import type { HostDescriptor } from "../shared/api";
import { droppedText, isAlreadyExists, isLocalEndpoint } from "./copy-view";
import { errorText } from "./folder-browser";

interface Props {
  hosts: HostDescriptor[];
  fromHostId: string;
  providerId: string;
  baseUrl: string | undefined;
  onClose: () => void;
}

/**
 * models.json 프로바이더 하나를 다른 호스트로 복사 (설계 §5.9).
 * compat·headers 같은 폼 밖 필드도 옮기되, 비밀일 수 있는 값(그대로 키 값인 apiKey·헤더)은 빼고 알린다.
 */
export function ProviderCopyPanel({ hosts, fromHostId, providerId, baseUrl, onClose }: Props) {
  const targets = hosts.filter((h) => h.id !== fromHostId);
  const [toHostId, setToHostId] = useState(targets[0]?.id ?? "");
  const [exported, setExported] = useState<ModelsExportResult | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [exists, setExists] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void window.piDesktop.modelsExport(fromHostId, providerId).then(setExported, (e: unknown) => setError(errorText(e)));
  }, [fromHostId, providerId]);

  async function copy(replace: boolean) {
    if (!exported) return;
    setBusy(true);
    setError(undefined);
    try {
      await window.piDesktop.modelsImport(toHostId, providerId, exported.provider, replace);
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

  return (
    <div className="banner info provider-copy">
      {done ? (
        <span>
          {hostLabel}의 models.json에 {providerId}를 복사했습니다.{dropped ? " 빠진 키는 그 호스트에서 넣어 주세요." : ""}
        </span>
      ) : (
        <div className="provider-copy-body">
          <label>
            {providerId}를 복사할 호스트{" "}
            <select value={toHostId} onChange={(e) => setToHostId(e.target.value)}>
              {targets.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
          {dropped && <div className="resource-problem">{dropped}</div>}
          {isLocalEndpoint(baseUrl) && (
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
