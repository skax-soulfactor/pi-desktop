import { useCallback, useEffect, useState } from "react";
import type { CurrentHost, HostView } from "../shared/api";

/** 목록 끝의 "SSH 호스트 관리…" (고르면 호스트를 바꾸지 않고 Pi 작업 공간의 SSH 호스트 관리를 연다) */
const SSH_MANAGE = "__ssh-manage__";

/**
 * 호스트 고르기 (설계 DESIGN-APPS.md §6 D3). 사이드바 맨 위, 무엇보다 먼저 고르는 자리다 (Pi 작업 공간의 호스트 선택과 같은 모양).
 * Agent는 한 번에 한 호스트(로컬·WSL·SSH)에 붙는다. 원격을 고르면 그 호스트에 Host Agent와 agent-kit을 올리고
 * 그 호스트의 ~/.pi-desktop-agent로 대화한다. 대화·기억·작업·스킬·승인·사용량·웹 검색·네트워크 화면 모두 그 호스트의 것을 쓴다.
 * SSH 호스트 목록은 Pi 작업 공간 것을 함께 쓰고, 더하기·고치기는 거기서 한다 (키 인증만, 앱은 비밀번호를 묻거나 저장하지 않는다).
 */
export function HostPicker({ current, onError }: { current: CurrentHost | undefined; onError: (message: string) => void }) {
  const [hosts, setHosts] = useState<HostView[]>();
  const [switching, setSwitching] = useState(false);

  const fail = useCallback(
    (error: unknown) => onError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error)),
    [onError],
  );
  // Pi 작업 공간에서 SSH 호스트를 더했을 수 있어 열 때마다 다시 읽는다
  const load = useCallback(() => void window.piAgent.listHosts().then(setHosts, fail), [fail]);
  useEffect(load, [load]);

  const choose = (hostId: string) => {
    if (hostId === SSH_MANAGE) {
      window.piAgent.openSshHosts().catch(fail);
      return;
    }
    setSwitching(true);
    // 바꾸면 메인이 다시 연결하고 화면을 새로 읽는다
    window.piAgent.setHost(hostId).catch((error: unknown) => {
      setSwitching(false);
      fail(error);
    });
  };

  return (
    <label className="host-picker" title="대화를 어느 컴퓨터에서 돌릴지 고릅니다. 바꾸면 그 호스트의 대화·기억·작업·스킬을 씁니다">
      <span className="host-picker-label">호스트</span>
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
