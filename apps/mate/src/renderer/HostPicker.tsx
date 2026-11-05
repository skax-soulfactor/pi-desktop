import { useCallback, useEffect, useState } from "react";
import type { CurrentHost, HostView } from "../shared/api";
import type { Act } from "./App";

/** 목록 끝의 "SSH 호스트 관리…" (고르면 호스트를 바꾸지 않고 Pi 작업 공간의 SSH 호스트 관리를 연다) */
const SSH_MANAGE = "__ssh-manage__";
const STOP_PREVIOUS_KEY = "mate:stop-previous-runner";

/** 호스트를 바꿀 때 앞 호스트의 실행기를 멈출지 (기본 멈춤, 설정에서 바꾼다) */
export function stopPreviousRunner(): boolean {
  try {
    return localStorage.getItem(STOP_PREVIOUS_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setStopPreviousRunner(on: boolean): void {
  try {
    localStorage.setItem(STOP_PREVIOUS_KEY, String(on));
  } catch {
    // 저장할 수 없으면 이번만 쓴다
  }
}

/**
 * 호스트 고르기 (설계 DESIGN-MATE-REMOTE.md §3.1). 머리 맨 앞, 무엇보다 먼저 고르는 자리다 (Pi 작업 공간의 호스트 선택과 같은 모양).
 * Mate는 한 번에 한 호스트(로컬·WSL·SSH)의 실행기에 붙는다. 원격을 고르면 그 호스트에 실행기와 mate-kit을 올리고,
 * 임무·인박스·대화·활동 관찰이 그 호스트에서 돈다 (앱을 닫거나 이 PC를 꺼도 계속 돈다).
 * SSH 호스트 목록은 Pi 작업 공간 것을 함께 쓰고, 더하기·고치기는 거기서 한다.
 */
export function HostPicker({ current, act }: { current: CurrentHost | undefined; act: Act }) {
  const [hosts, setHosts] = useState<HostView[]>();
  const [switching, setSwitching] = useState(false);

  // Pi 작업 공간에서 SSH 호스트를 더했을 수 있어 열 때마다 다시 읽는다
  const load = useCallback(() => void window.mate.listHosts().then(setHosts, () => undefined), []);
  useEffect(load, [load]);

  const choose = (next: string) => {
    if (next === SSH_MANAGE) {
      void act(() => window.mate.openSshHosts());
      return;
    }
    setSwitching(true);
    void act(() => window.mate.setHost(next, stopPreviousRunner())).then((ok) => {
      if (!ok) setSwitching(false);
    });
  };

  return (
    <label
      className="host-picker"
      title={`Mate 실행기를 어느 컴퓨터에서 돌릴지 고릅니다${current?.remote && current.home ? `\n그 호스트의 Mate 데이터: ${current.home}` : ""}`}
    >
      <span className="muted small-text">호스트</span>
      {!hosts || !current ? (
        <select disabled>
          <option>읽는 중…</option>
        </select>
      ) : (
        <select value={current.id} disabled={switching} onFocus={load} onChange={(e) => choose(e.target.value)}>
          {!hosts.some((h) => h.id === current.id) && <option value={current.id}>{current.id} (목록에 없음)</option>}
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
          <option value={SSH_MANAGE}>SSH 호스트 관리…</option>
        </select>
      )}
      {switching && <span className="muted small-text">다시 연결하는 중…</span>}
    </label>
  );
}
