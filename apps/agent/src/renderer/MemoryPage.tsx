import { useEffect, useState } from "react";
import type { MemoryView } from "../shared/api";

const KIND_LABEL: Record<MemoryView["kind"], string> = { preference: "선호", fact: "사실", lesson: "교훈" };

/**
 * 기억 (설계 DESIGN-AGENT.md §4 "지식베이스"). 에이전트가 대화마다 관련된 것을 골라 참고한다.
 * 선호는 늘, 사실·교훈은 요청과 관련 있을 때만 쓰인다. 지우면 forgotten/으로 옮겨진다.
 * 대화가 끝나면 에이전트가 남길 것을 스스로 뽑아 저장하고("자동" 표시), 여기서 끌 수 있다.
 */
export function MemoryPage({ onError }: { onError: (message: string) => void }) {
  const [memories, setMemories] = useState<MemoryView[]>([]);
  const [kind, setKind] = useState<MemoryView["kind"]>("preference");
  const [text, setText] = useState("");
  const [autoLearn, setAutoLearn] = useState<boolean>();

  const run = (action: () => Promise<void>) =>
    action().catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
  const refresh = async () => setMemories(await window.piAgent.listMemories());

  useEffect(() => void run(async () => (await refresh(), setAutoLearn(await window.piAgent.getAutoLearn()))), []);

  return (
    <div className="page">
      <header className="page-head">
        <h2>기억</h2>
        <span className="muted">선호는 모든 대화에, 사실·교훈은 관련 있는 요청에만 실립니다. 대화에서 "기억해"라고 해도 저장됩니다.</span>
      </header>
      <div className="page-body">
        <label className="check-row" title="대화가 끝날 때마다 지금 모델을 한 번 더 불러 남길 선호·사실·교훈을 뽑습니다. 실패한 도구·거부한 승인은 교훈 후보가 됩니다">
          <input
            type="checkbox"
            checked={autoLearn ?? true}
            disabled={autoLearn === undefined}
            onChange={(e) => {
              const on = e.target.checked;
              run(async () => (await window.piAgent.setAutoLearn(on), setAutoLearn(on)));
            }}
          />
          <span>대화가 끝나면 자동으로 기억하기</span>
          <span className="muted small-text">(모델을 한 번 더 부릅니다. 저장할 때마다 대화에 알림이 뜹니다)</span>
        </label>
        <div className="form-row">
          <select value={kind} onChange={(e) => setKind(e.target.value as MemoryView["kind"])}>
            <option value="preference">선호</option>
            <option value="fact">사실</option>
            <option value="lesson">교훈</option>
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 커밋 메시지는 한글로 쓴다" />
          <button
            className="primary"
            disabled={!text.trim()}
            onClick={() =>
              run(async () => {
                await window.piAgent.addMemory(kind, text);
                setText("");
                await refresh();
              })
            }
          >
            기억하기
          </button>
        </div>
        {memories.length === 0 ? (
          <p className="muted">아직 기억한 것이 없습니다.</p>
        ) : (
          <ul className="list">
            {memories.map((m) => (
              <li key={m.id}>
                <span className={`tag ${m.kind}`}>{KIND_LABEL[m.kind]}</span>
                <span className="grow">{m.text}</span>
                {m.source === "auto" && (
                  <span className="tag auto" title="대화가 끝난 뒤 자동으로 뽑은 기억">
                    자동
                  </span>
                )}
                <span className="muted small-text" title={m.updated ? `고친 때 ${new Date(m.updated).toLocaleString()}` : undefined}>
                  {m.created ? new Date(m.created).toLocaleDateString() : ""}
                </span>
                <button className="small" onClick={() => run(async () => (await window.piAgent.forgetMemory(m.id), await refresh()))}>
                  잊기
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
