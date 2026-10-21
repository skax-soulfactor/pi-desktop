import { useEffect, useRef, useState } from "react";
import type { PiLatest, PiStatus, PiUpdateTarget } from "@pi-desktop/host-protocol/messages";
import { updateState } from "./pi-manager-view";
import { changesPi, UPDATE_LABELS, updateOutcome, type UpdateOutcome } from "./pi-update-view";

/**
 * Pi 관리 창의 업데이트 영역 (설계 §4.9 "업데이트"). Pi의 pi update를 실행하고 출력을 보여준다.
 * Pi 자체를 바꾸는 업데이트는 실행 중인 세션이 있으면 먼저 알리고 확인을 받는다.
 */
export function PiUpdatePanel({
  hostId,
  status,
  latest,
  onFinished,
}: {
  hostId: string;
  status: PiStatus;
  latest: PiLatest | undefined;
  /** 끝나면 상태를 다시 읽게 한다 */
  onFinished: () => void;
}) {
  const [running, setRunning] = useState<PiUpdateTarget | undefined>();
  const [confirm, setConfirm] = useState<{ target: PiUpdateTarget; sessions: number } | undefined>();
  const [output, setOutput] = useState("");
  const [outcome, setOutcome] = useState<UpdateOutcome | undefined>();
  const outputRef = useRef<HTMLPreElement>(null);
  const available = updateState(status.pi?.version, latest) === "available";

  // 호스트를 바꾸면 지난 결과를 지운다.
  useEffect(() => {
    setOutput("");
    setOutcome(undefined);
    setConfirm(undefined);
  }, [hostId]);

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  async function ask(target: PiUpdateTarget) {
    if (!changesPi(target)) return void run(target);
    const sessions = (await window.piDesktop.listSessions(hostId).catch(() => [])).filter((s) => s.state === "running");
    if (sessions.length === 0) return void run(target);
    setConfirm({ target, sessions: sessions.length });
  }

  async function run(target: PiUpdateTarget) {
    setConfirm(undefined);
    setRunning(target);
    setOutcome(undefined);
    setOutput("");
    const taskId = crypto.randomUUID();
    const off = window.piDesktop.onPiUpdateOutput((id, n) => {
      if (id === hostId && n.taskId === taskId) setOutput((prev) => prev + n.chunk);
    });
    try {
      const result = await window.piDesktop.piUpdate(hostId, target, taskId);
      // 알림보다 응답이 먼저 올 수 있어 응답의 출력으로 맞춘다.
      setOutput(result.output);
      setOutcome(updateOutcome(target, result));
    } catch (e) {
      setOutcome({ level: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      off();
      setRunning(undefined);
      onFinished();
    }
  }

  const button = (target: PiUpdateTarget, primary = false, disabled = false) => (
    <button
      type="button"
      className={primary ? "primary" : undefined}
      disabled={running !== undefined || disabled}
      onClick={() => void ask(target)}
    >
      {running === target ? "진행 중…" : UPDATE_LABELS[target]}
      {target === "self" && available && running !== target ? ` (${latest?.version})` : ""}
    </button>
  );

  return (
    <section className="pi-update">
      <div className="pi-update-actions">
        {button("self", available, !status.pi)}
        {button("extensions", false, !status.pi)}
        {button("models", false, !status.pi)}
      </div>
      {confirm && (
        <div className="banner warn">
          <span>
            실행 중인 세션 {confirm.sessions}개는 업데이트 뒤에도 지금 버전으로 계속 돕니다. 새 버전을 쓰려면 그 세션을 닫고
            다시 열어야 합니다.
          </span>
          <button type="button" className="primary" onClick={() => void run(confirm.target)}>
            {UPDATE_LABELS[confirm.target]}
          </button>
          <button type="button" onClick={() => setConfirm(undefined)}>
            취소
          </button>
        </div>
      )}
      {outcome && <div className={`banner ${outcome.level === "error" ? "error" : outcome.level === "ok" ? "ok" : "info"}`}>{outcome.message}</div>}
      {(output || running) && (
        <pre className="pi-update-output" ref={outputRef}>
          {output || "실행 중…"}
        </pre>
      )}
    </section>
  );
}
