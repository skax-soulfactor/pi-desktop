import { useCallback, useEffect, useState } from "react";
import type { PiLatest, PiStatus } from "@pi-desktop/host-protocol/messages";
import type { HostDescriptor } from "../shared/api";
import { statusChecks } from "./pi-manager-view";
import { PiDataPanel } from "./PiDataPanel";
import { SettingsCopyPanel } from "./SettingsCopyPanel";
import { SettingsFormPanel } from "./SettingsFormPanel";
import { HostComparePanel } from "./HostComparePanel";
import { PiInstallPanel } from "./PiInstallPanel";
import { PiUpdatePanel } from "./PiUpdatePanel";
import { ModelsPanel } from "./ModelsPanel";
import { ProvidersPanel } from "./ProvidersPanel";

/** 최신 버전 조회가 실패했을 때 다시 묻는 간격 */
const LATEST_RETRY_MS = 2 * 60_000;
/** 최신 버전을 다시 묻는 간격 (데몬 캐시가 1시간이라 그보다 길게) */
const LATEST_REFRESH_MS = 6 * 60 * 60_000;

/** 한 호스트의 Pi 상태와 최신 버전. 최신 버전은 데몬이 1시간(실패는 1분) 캐시한다 */
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

  // 최신 버전을 다시 묻는다: 실패했으면 곧(일시적 네트워크 오류일 수 있다), 성공했으면 몇 시간마다.
  // 연결할 때 한 번만 물으면 한 번 실패한 뒤로는 앱을 다시 열 때까지 업데이트 배지가 나오지 않는다.
  useEffect(() => {
    if (!enabled || !latest) return;
    const timer = setTimeout(
      () => {
        void window.piDesktop
          .piLatest(hostId, false)
          .then(setLatest)
          .catch(() => {});
      },
      latest.error ? LATEST_RETRY_MS : LATEST_REFRESH_MS,
    );
    return () => clearTimeout(timer);
  }, [enabled, hostId, latest]);

  return { status, latest, error, reload: load };
}

/**
 * Pi 관리 창 (설계 §4.9, §4.7). 상태 점검표와 업데이트, 프로바이더 인증. 설치·제거는 다음 단계에서 붙인다.
 */
export function PiManager({
  hosts,
  initialHostId,
  initialTab = "status",
  onClose,
  onChanged,
  onOAuthLogin,
  onRunInTerminal,
  projectCwd,
}: {
  hosts: HostDescriptor[];
  initialHostId: string;
  /** 처음 열 탭 (/settings, /login 등) */
  initialTab?: "status" | "providers" | "models" | "settings" | "compare";
  /** 지금 탭의 작업 폴더 (설정의 프로젝트 범위 기본값) */
  projectCwd?: string;
  onClose: () => void;
  /** 업데이트 등으로 상태가 바뀌었을 수 있다 (상단 바 표시를 다시 읽게) */
  onChanged?: () => void;
  /** 이 호스트의 pi를 내장 터미널에 열고 /login을 실행한다 */
  onOAuthLogin?: (hostId: string, provider: string) => void;
  /** 이 호스트의 셸 터미널을 열고 명령을 실행한다 (설치·제거) */
  onRunInTerminal?: (hostId: string, command: string, title: string) => void;
}) {
  const [hostId, setHostId] = useState(initialHostId);
  const { status, latest, error, reload } = usePiStatus(hostId, true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"status" | "providers" | "models" | "settings" | "compare">(initialTab);
  const [settingsMode, setSettingsMode] = useState<"edit" | "copy">("edit");
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
          <div className="segmented" role="tablist">
            <button type="button" className={tab === "status" ? "on" : ""} onClick={() => setTab("status")}>
              상태
            </button>
            <button type="button" className={tab === "providers" ? "on" : ""} onClick={() => setTab("providers")}>
              프로바이더
            </button>
            <button type="button" className={tab === "models" ? "on" : ""} onClick={() => setTab("models")}>
              모델
            </button>
            <button type="button" className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
              설정
            </button>
            <button type="button" className={tab === "compare" ? "on" : ""} onClick={() => setTab("compare")}>
              비교
            </button>
          </div>
          <div className="spacer" />
          <button
            type="button"
            hidden={tab !== "status"}
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
        {tab === "providers" && (
          <ProvidersPanel
            hostId={hostId}
            onChanged={() => void reload()}
            {...(onOAuthLogin ? { onOAuthLogin: (provider: string) => onOAuthLogin(hostId, provider) } : {})}
          />
        )}
        {tab === "models" && <ModelsPanel hostId={hostId} hosts={hosts} onChanged={() => void reload()} />}
        {tab === "settings" && (
          <>
            <div className="segmented settings-mode" role="tablist">
              <button type="button" className={settingsMode === "edit" ? "on" : ""} onClick={() => setSettingsMode("edit")}>
                편집
              </button>
              <button type="button" className={settingsMode === "copy" ? "on" : ""} onClick={() => setSettingsMode("copy")}>
                다른 호스트로 복사
              </button>
            </div>
            {settingsMode === "edit" ? (
              <SettingsFormPanel hostId={hostId} {...(projectCwd && hostId === initialHostId ? { projectCwd } : {})} />
            ) : <SettingsCopyPanel hostId={hostId} hosts={hosts} />}
          </>
        )}
        {tab === "compare" && <HostComparePanel hostId={hostId} hosts={hosts} />}
        {tab === "status" && error && <div className="banner error">{error}</div>}
        {tab === "status" && !status && !error && <p className="muted">상태를 읽는 중…</p>}
        {tab === "status" && status && (
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
        {tab === "status" && status && (
          <PiUpdatePanel
            hostId={hostId}
            status={status}
            latest={latest}
            onFinished={() => {
              void reload(true);
              onChanged?.();
            }}
          />
        )}
        {tab === "status" && status && onRunInTerminal && (
          <PiInstallPanel
            hostId={hostId}
            status={status}
            onRunInTerminal={(command, title) => onRunInTerminal(hostId, command, title)}
          />
        )}
        {tab === "status" && status && <PiDataPanel hostId={hostId} status={status} onChanged={() => void reload(true)} />}
      </div>
    </div>
  );
}
