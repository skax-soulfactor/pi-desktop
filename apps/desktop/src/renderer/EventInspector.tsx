import { useEffect, useMemo, useState } from "react";
import { eventSummary, eventTime, filterEvents, HANDLED_TYPES, sharedEventLog, typeCounts, type LoggedEvent } from "./event-log";

interface Props {
  hostId: string;
  hostLabel: string;
  sessionId: string;
  /** 세션 이름 등 보일 제목 */
  title: string;
  onClose: () => void;
}

/** 한 번에 그리는 줄 수 (보관은 세션마다 2000개) */
const SHOW = 500;

/**
 * Event Inspector (설계 §4.11): 지금 세션에서 Pi가 보낸 RPC 이벤트를 원본 그대로 본다.
 * 종류별로 거르고 검색하고, 펼쳐 JSON을 보거나 복사한다. 앱이 화면에 쓰지 않는 종류는 표시해 둔다
 * (Pi가 새 이벤트를 더했을 때 바로 보이게, 설계 §1 "모르는 이벤트는 raw로").
 */
export function EventInspector({ hostId, hostLabel, sessionId, title, onClose }: Props) {
  const log = sharedEventLog();
  const [events, setEvents] = useState<LoggedEvent[]>(() => log.list(hostId, sessionId));
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState<number | undefined>();

  useEffect(() => {
    if (paused) return;
    setEvents(log.list(hostId, sessionId));
    return log.subscribe(() => setEvents(log.list(hostId, sessionId)));
  }, [hostId, sessionId, paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const counts = useMemo(() => typeCounts(events), [events]);
  const shown = useMemo(() => filterEvents(events, hidden, query).slice(-SHOW).reverse(), [events, hidden, query]);

  function toggleType(type: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function copy(e: LoggedEvent) {
    await navigator.clipboard.writeText(JSON.stringify(e.event, null, 2));
    setCopied(e.seq);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal event-inspector" role="dialog" aria-label="Event Inspector" onMouseDown={(e) => e.stopPropagation()}>
        <header className="pi-manager-head">
          <h2>Event Inspector</h2>
          <span className="muted event-inspector-title" title={sessionId}>
            {hostLabel} · {title}
          </span>
          <div className="spacer" />
          <button type="button" onClick={() => setPaused(!paused)} title="멈추면 새 이벤트를 목록에 더하지 않습니다 (보관은 계속)">
            {paused ? "다시 받기" : "멈춤"}
          </button>
          <button type="button" onClick={() => log.clear(hostId, sessionId)} title="이 세션의 보관한 이벤트를 비웁니다">
            비우기
          </button>
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="event-inspector-filters">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="찾기 (종류·원본 JSON)" spellCheck={false} />
          <div className="event-types">
            {counts.map(({ type, count }) => (
              <button
                key={type}
                type="button"
                className={`event-type${hidden.has(type) ? " off" : ""}${HANDLED_TYPES.has(type) ? "" : " unhandled"}`}
                onClick={() => toggleType(type)}
                title={`${HANDLED_TYPES.has(type) ? "" : "앱이 화면에 쓰지 않는 종류입니다. "}눌러서 ${hidden.has(type) ? "보이기" : "숨기기"}`}
              >
                {type} {count}
              </button>
            ))}
          </div>
        </div>
        <p className="muted">
          이 세션에서 받은 이벤트 {events.length}개(최근 2000개까지 보관){shown.length < events.length ? ` 중 ${shown.length}개` : ""}. 최근 것이 위에 옵니다.
          {paused ? " 멈춘 동안 온 이벤트는 다시 받으면 보입니다." : ""}
        </p>
        {events.length === 0 && <p className="muted">아직 받은 이벤트가 없습니다. 메시지를 보내면 여기에 나타납니다.</p>}
        <ul className="event-list">
          {shown.map((e) => {
            const expanded = open.has(e.seq);
            return (
              <li key={e.seq} className={HANDLED_TYPES.has(e.type) ? undefined : "unhandled"}>
                <button
                  type="button"
                  className="event-row"
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(e.seq)) next.delete(e.seq);
                      else next.add(e.seq);
                      return next;
                    })
                  }
                >
                  <span className="event-seq">#{e.seq}</span>
                  <span className="event-time">{eventTime(e.at)}</span>
                  <span className="event-name">{e.type}</span>
                  <span className="event-summary">{eventSummary(e.event)}</span>
                </button>
                {expanded && (
                  <div className="event-detail">
                    <button type="button" className="small" onClick={() => void copy(e)}>
                      {copied === e.seq ? "복사함" : "JSON 복사"}
                    </button>
                    <pre>{JSON.stringify(e.event, null, 2)}</pre>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
