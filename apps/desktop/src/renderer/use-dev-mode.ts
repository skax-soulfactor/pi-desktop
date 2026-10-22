import { useEffect, useRef, useState } from "react";
import { changedText, devModeRoots } from "./dev-mode";
import { errorText } from "./folder-browser";

/** 저장이 몰려 들어오는 동안 기다리는 시간 (여러 파일을 한 번에 저장할 때 한 번만 반영) */
const SETTLE_MS = 400;

export interface DevModeStatus {
  /** 마지막으로 반영한 시각과 파일, 또는 실패 이유 */
  text: string;
  error?: boolean;
}

/**
 * Extension Dev Mode (설계 §4.5): 켜면 이 세션이 불러오는 확장 파일·폴더를 데몬이 감시하고,
 * 바뀌면 /desktop:reload로 세션에 바로 반영한다. 작업 중이면 끝난 뒤에 반영한다.
 * 세션이 바뀌거나 연결이 끊기면 감시를 멈춘다(다시 켜져 있으면 새 세션으로 다시 건다).
 */
export function useExtensionDevMode(options: {
  tabId: string;
  hostId: string;
  sessionId: string | undefined;
  cwd: string | undefined;
  connected: boolean;
  running: boolean;
  reload: () => Promise<void>;
}) {
  const { tabId, hostId, sessionId, cwd, connected, running, reload } = options;
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState<DevModeStatus | undefined>();
  /** 반영을 기다리는 바뀐 파일 (작업 중이었거나 모으는 중) */
  const [pending, setPending] = useState<string[]>([]);
  /** 반영한 뒤 감시할 뿌리를 다시 계산하게 한다 (새 확장 파일이 생겼을 수 있음) */
  const [generation, setGeneration] = useState(0);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const watchId = `dev:${tabId}`;

  // 감시를 건다: 리소스 목록에서 확장 경로를 얻어 뿌리를 정한다.
  useEffect(() => {
    if (!on || !sessionId || !cwd || !connected) return;
    let alive = true;
    void (async () => {
      try {
        const view = await window.piDesktop.listResources(hostId, cwd);
        if (!alive) return;
        await window.piDesktop.watchTree(hostId, watchId, devModeRoots(view));
      } catch (e) {
        if (alive) setStatus({ text: `감시를 시작하지 못했습니다: ${errorText(e)}`, error: true });
      }
    })();
    const off = window.piDesktop.onFilesChanged((id, n) => {
      if (id !== hostId || n.watchId !== watchId) return;
      setPending((prev) => [...new Set([...prev, ...n.paths])]);
    });
    return () => {
      alive = false;
      off();
      void window.piDesktop.unwatchTree(hostId, watchId).catch(() => {});
    };
  }, [on, hostId, sessionId, cwd, connected, generation]);

  // 바뀐 파일이 있으면 잠시 모은 뒤, 작업 중이 아니면 반영한다.
  useEffect(() => {
    if (!on || pending.length === 0 || running) return;
    const timer = setTimeout(() => {
      const paths = pending;
      setPending([]);
      void reloadRef
        .current()
        .then(() => {
          setStatus({ text: `${new Date().toLocaleTimeString()} 반영: ${changedText(paths)}` });
          setGeneration((g) => g + 1);
        })
        .catch((e: unknown) => setStatus({ text: `반영하지 못했습니다: ${errorText(e)}`, error: true }));
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [on, pending, running]);

  function toggle() {
    setOn((prev) => !prev);
    setPending([]);
    setStatus(undefined);
  }

  return { on, toggle, status, waiting: pending.length > 0 };
}
