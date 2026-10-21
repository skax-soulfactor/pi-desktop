import { useEffect, useState } from "react";
import type { PendingQueue, RetryState } from "./chat-state";
import { secondsLeft } from "./run-status";

/** Steer·Follow-up으로 보내 두고 Pi가 아직 처리하지 않은 메시지. 입력창 바로 위에 보인다 */
export function QueuePanel({ queue, onClear }: { queue: PendingQueue; onClear: () => void }) {
  const entries = [
    ...queue.steering.map((text) => ({ kind: "Steer", text })),
    ...queue.followUp.map((text) => ({ kind: "Follow-up", text })),
  ];
  if (entries.length === 0) return null;
  return (
    <div className="queue-panel" aria-label="대기 중인 메시지">
      <div className="queue-head">
        <span>대기 중 {entries.length}개</span>
        <button type="button" className="small" onClick={onClear} title="대기 중인 메시지를 취소하고 입력창으로 되돌립니다">
          비우고 입력창으로
        </button>
      </div>
      <ul>
        {entries.map((entry, i) => (
          <li key={i}>
            <span className={`queue-kind ${entry.kind === "Steer" ? "steer" : "follow"}`}>{entry.kind}</span>
            <span className="queue-text">{entry.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 응답 오류로 자동 재시도를 기다리는 중. 남은 시간은 이 화면이 재시도 소식을 받은 때부터 센다
 * (다시 연결해 저널로 받은 경우 실제보다 길게 보일 수 있어 "약"을 붙인다).
 */
export function RetryBanner({ retry, onCancel }: { retry: RetryState; onCancel: () => void }) {
  const [deadline, setDeadline] = useState(() => Date.now() + retry.delayMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setDeadline(Date.now() + retry.delayMs);
  }, [retry.attempt, retry.delayMs]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const left = secondsLeft(deadline, now);
  return (
    <div className="banner warn">
      <span>
        응답 오류로 다시 시도하는 중입니다 ({retry.attempt}/{retry.maxAttempts}
        {left > 0 ? `, 약 ${left}초 뒤` : ""}): {retry.errorMessage}
      </span>
      <button type="button" onClick={onCancel} title="재시도를 멈춥니다 (abort_retry)">
        재시도 취소
      </button>
    </div>
  );
}
