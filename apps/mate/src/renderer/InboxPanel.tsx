import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { InboxView, Overview } from "../shared/api";
import type { Act } from "./App";
import { relativeTime, splitInbox } from "./mate-view";

const SEVERITY_LABELS: Record<InboxView["severity"], string> = { info: "참고", warn: "확인 필요", action: "할 일" };

/**
 * 인박스: 실행기가 돌며 남긴 제안·결과 (설계 DESIGN-MATE.md §5).
 * 앱이 꺼져 있던 동안 쌓인 것도 여기서 본다. M1의 "확인함"은 표시만 하고, 실제 적용은 M3(act)부터.
 */
export function InboxPanel({ overview, now, act }: { overview: Overview; now: number; act: Act }) {
  const [showHandled, setShowHandled] = useState(false);
  const { fresh, handled } = splitInbox(overview.inbox);
  const list = showHandled ? handled : fresh;

  return (
    <section>
      <div className="section-head">
        <div className="segmented">
          <button className={!showHandled ? "active" : ""} onClick={() => setShowHandled(false)}>
            새 제안 {fresh.length}
          </button>
          <button className={showHandled ? "active" : ""} onClick={() => setShowHandled(true)}>
            처리함 {handled.length}
          </button>
        </div>
        {!showHandled && fresh.length > 1 && (
          <button onClick={() => void act(() => window.mate.setInbox(fresh.map((i) => i.id), "accepted"))}>모두 확인함</button>
        )}
      </div>
      {list.length === 0 && (
        <div className="empty">
          {showHandled
            ? "처리한 제안이 없습니다."
            : overview.duties.length === 0
              ? "아직 임무가 없습니다. 임무 탭에서 만들면, Mate가 정한 때에 살펴보고 여기에 알려 줍니다."
              : "새 제안이 없습니다. 임무가 돌면서 알릴 것이 생기면 여기에 쌓입니다."}
        </div>
      )}
      <ul className="cards">
        {list.map((item) => (
          <InboxCard key={item.id} item={item} now={now} act={act} />
        ))}
      </ul>
    </section>
  );
}

function InboxCard({ item, now, act }: { item: InboxView; now: number; act: Act }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`card inbox-card sev-${item.severity}`}>
      <div className="card-head">
        <span className={`chip sev-${item.severity}`}>{SEVERITY_LABELS[item.severity]}</span>
        <strong className="title">{item.title}</strong>
        <span className="muted">
          {item.dutyName} · {relativeTime(item.createdAt, now)}
        </span>
      </div>
      <div className="summary markdown">
        <Markdown remarkPlugins={[remarkGfm]}>{item.summary}</Markdown>
      </div>
      {item.detail && (
        <>
          <button className="link" onClick={() => setOpen(!open)}>
            {open ? "근거 접기" : "근거 보기"}
          </button>
          {open && (
            <div className="detail markdown">
              <Markdown remarkPlugins={[remarkGfm]}>{item.detail}</Markdown>
            </div>
          )}
        </>
      )}
      <div className="card-actions">
        {item.status ? (
          <>
            <span className="muted">{item.status === "accepted" ? "확인함" : "버림"}</span>
            <button className="small" onClick={() => void act(() => window.mate.setInbox([item.id], undefined))}>
              새 제안으로 되돌리기
            </button>
          </>
        ) : (
          <>
            <button className="primary small" onClick={() => void act(() => window.mate.setInbox([item.id], "accepted"))}>
              확인함
            </button>
            <button className="small" onClick={() => void act(() => window.mate.setInbox([item.id], "dismissed"))}>
              버리기
            </button>
          </>
        )}
      </div>
    </li>
  );
}
