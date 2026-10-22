import { useEffect, useRef, useState } from "react";
import {
  ACTIVITY_LABELS,
  activityCounts,
  activityTitle,
  collectActivity,
  type ActivityEntry,
} from "./activity-view";
import type { ActionLogEntry } from "../shared/api";
import { baseName, formatRelative } from "./format";

/** 세션 목록을 다시 읽는 주기. 데몬은 붙어 있지 않은 세션의 이벤트를 보내지 않으므로 주기적으로 읽는다 */
const POLL_MS = 3000;
/** 이 이벤트가 오면 기다리지 않고 바로 다시 읽는다 */
const REFRESH_ON = new Set(["agent_start", "agent_settled"]);

interface HostRef {
  hostId: string;
  hostLabel: string;
}

/**
 * 여러 호스트의 세션 활동을 모은다. hosts는 탭들이 연결해 쓰는 호스트다
 * (연결되지 않은 호스트에 일부러 연결하지 않는다).
 */
export function useActivity(hosts: readonly HostRef[]): ActivityEntry[] {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const hostsKey = hosts.map((h) => `${h.hostId}=${h.hostLabel}`).join("|");
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const results = await Promise.all(
        hostsRef.current.map(async (h) => ({
          ...h,
          sessions: await window.piDesktop.listSessions(h.hostId).catch(() => []),
        })),
      );
      if (!cancelled) setEntries(collectActivity(results));
    };
    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        await load();
        if (!cancelled) schedule(POLL_MS);
      }, delay);
    };
    schedule(0);
    const offEvent = window.piDesktop.onSessionEvent((_id, n) => {
      const type = (n.event as { type?: string } | null)?.type;
      if (type && REFRESH_ON.has(type)) schedule(200);
    });
    const offUi = window.piDesktop.onUiResolved(() => schedule(200));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      offEvent();
      offUi();
    };
  }, [hostsKey]);

  return entries;
}

/** 탭 바 오른쪽 "활동" 버튼과 펼침 패널 */
export function ActivityButton({
  entries,
  onOpen,
}: {
  entries: ActivityEntry[];
  /** 세션을 보여준다 (보는 탭으로 가거나 새 탭을 연다) */
  onOpen: (entry: ActivityEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"sessions" | "log">("sessions");
  const root = useRef<HTMLDivElement>(null);
  const { input, busy } = activityCounts(entries);
  const multiHost = new Set(entries.map((e) => e.hostId)).size > 1;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="activity" ref={root}>
      <button
        type="button"
        className={`activity-button${input > 0 ? " needs-input" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        title="모든 탭·호스트의 세션 활동과 작업 기록"
      >
        활동
        {input + busy > 0 && <span className="activity-count">{input > 0 ? `입력 ${input}` : busy}</span>}
      </button>
      {open && (
        <div className="activity-panel" role="dialog" aria-label="세션 활동">
          <div className="segmented activity-tabs" role="tablist">
            <button type="button" className={view === "sessions" ? "on" : ""} onClick={() => setView("sessions")}>
              세션
            </button>
            <button type="button" className={view === "log" ? "on" : ""} onClick={() => setView("log")}>
              작업 기록
            </button>
          </div>
          {view === "log" && <ActionLogList />}
          {view === "sessions" && entries.length === 0 && <p className="activity-empty">실행 중인 세션이 없습니다.</p>}
          <ul hidden={view !== "sessions"}>
            {entries.map((entry) => (
              <li key={`${entry.hostId}:${entry.session.sessionId}`}>
                <button
                  type="button"
                  className={`activity-item ${entry.state}`}
                  onClick={() => {
                    setOpen(false);
                    onOpen(entry);
                  }}
                  title={entry.session.sessionFile ?? entry.session.cwd}
                >
                  <span className={`activity-dot ${entry.state}`} />
                  <span className="activity-title">{activityTitle(entry.session)}</span>
                  <span className="activity-state">{ACTIVITY_LABELS[entry.state]}</span>
                  <span className="activity-meta">
                    {multiHost && `${entry.hostLabel} · `}
                    {baseName(entry.session.cwd)} · {formatRelative(entry.session.startedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * 작업 기록 (설계 §4.5 보안 원칙): 설치·제거·업데이트, 복사·가져오기, 설정·신뢰 변경 등을 최근 것부터 보인다.
 * 터미널에서 실행한 명령은 실행했다는 것만 남으므로 결과는 그 터미널 출력에서 본다.
 */
function ActionLogList() {
  const [log, setLog] = useState<ActionLogEntry[] | undefined>();
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  async function load() {
    const [entries, hosts] = await Promise.all([window.piDesktop.listActionLog(200), window.piDesktop.listHosts().catch(() => [])]);
    setLog(entries);
    setLabels(new Map(hosts.map((h) => [h.id, h.label])));
  }

  useEffect(() => {
    void load();
  }, []);

  if (!log) return <p className="activity-empty">기록을 읽는 중…</p>;
  if (log.length === 0) return <p className="activity-empty">아직 남긴 작업이 없습니다.</p>;
  const hostText = (id: string) => (id === "app" ? "앱" : labels.get(id) ?? id);
  return (
    <>
      <ul className="action-log">
        {log.map((entry, i) => (
          <li key={`${entry.time}-${i}`} className={entry.ok ? undefined : "failed"} title={new Date(entry.time).toLocaleString()}>
            <span className="action-log-summary">
              {entry.ok ? "" : "실패 · "}
              {entry.summary}
            </span>
            <span className="activity-meta">
              {hostText(entry.hostId)} · {formatRelative(entry.time)}
            </span>
            {entry.detail && <code className="action-log-detail">{entry.detail}</code>}
            {entry.error && <span className="action-log-error">{entry.error}</span>}
          </li>
        ))}
      </ul>
      <p className="activity-empty">최근 {log.length}개. 앱 데이터 폴더의 activity-log.jsonl에 남습니다.</p>
    </>
  );
}
