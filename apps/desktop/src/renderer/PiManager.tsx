import { useCallback, useEffect, useState } from "react";
import type { PiLatest, PiStatus } from "@pi-desktop/host-protocol/messages";
import type { HostDescriptor } from "../shared/api";
import { statusChecks } from "./pi-manager-view";

/** 한 호스트의 Pi 상태와 최신 버전. 최신 버전은 데몬이 1시간 캐시한다 */
export function usePiStatus(hostId: string, enabled: boolean) {
  const [status, setStatus] = useState<PiStatus | undefined>();
  const [latest, setLatest] = useState<PiLatest | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(
    async (force = false) => {
      setError(undefined);
      try {
        setStatus(await window.piDesktop.piStatus(hostId));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      // 최신 버전은 네트워크가 느릴 수 있어 상태를 먼저 보여주고 따로 채운다.
      setLatest(await window.piDesktop.piLatest(hostId, force).catch((e) => ({ error: String(e), checkedAt: Date.now() })));
    },
    [hostId],
  );

  useEffect(() => {
    setStatus(undefined);
    setLatest(undefined);
    if (enabled) void load();
  }, [enabled, load]);

  return { status, latest, error, reload: load };
}

/**
 * Pi 관리 창 (설계 §4.9). 지금은 읽기 전용 상태 화면이다.
 * 설치·업데이트·제거는 다음 단계에서 이 창에 붙인다.
 */
export function PiManager({
  hosts,
  initialHostId,
  onClose,
}: {
  hosts: HostDescriptor[];
  initialHostId: string;
  onClose: () => void;
}) {
  const [hostId, setHostId] = useState(initialHostId);
  const { status, latest, error, reload } = usePiStatus(hostId, true);
  const [refreshing, setRefreshing] = useState(false);
  const checks = status ? statusChecks(status, latest) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal pi-manager" role="dialog" aria-label="Pi 관리" onMouseDown={(e) => e.stopPropagation()}>
        <header className="pi-manager-head">
          <h2>Pi 관리</h2>
          <select value={hostId} onChange={(e) => setHostId(e.target.value)} aria-label="호스트">
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
          <div className="spacer" />
          <button
            type="button"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await reload(true);
              setRefreshing(false);
            }}
            title="상태와 최신 버전을 다시 확인합니다"
          >
            {refreshing ? "확인 중…" : "다시 확인"}
          </button>
          <button type="button" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </header>
        {error && <div className="banner error">{error}</div>}
        {!status && !error && <p className="muted">상태를 읽는 중…</p>}
        {status && (
          <table className="pi-checks">
            <tbody>
              {checks.map((check) => (
                <tr key={check.id} className={`check-${check.level}`}>
                  <th>
                    <span className={`check-dot ${check.level}`} />
                    {check.label}
                  </th>
                  <td>
                    <div>{check.value}</div>
                    {check.detail && <div className="check-detail">{check.detail}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="pi-manager-note muted">
          설치·업데이트·제거는 다음 단계에서 추가됩니다. 지금은 상태만 확인합니다.
        </p>
      </div>
    </div>
  );
}
