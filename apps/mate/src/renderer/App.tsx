import { useCallback, useEffect, useState } from "react";
import type { Overview } from "../shared/api";
import { DutiesView } from "./DutiesView";
import { InboxPanel } from "./InboxPanel";
import { splitInbox, STATUS_LABELS } from "./mate-view";
import { RunsView } from "./RunsView";
import { SettingsView } from "./SettingsView";

type Tab = "inbox" | "duties" | "runs" | "settings";

/** 화면 전체. Mate 홈의 파일이 바뀔 때마다(실행기·확장이 쓴 것 포함) 다시 읽는다 */
export function App() {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("inbox");
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      setOverview(await window.mate.overview());
      // 실행기가 방금 쓴 시각이 화면의 "지금"보다 뒤로 보이지 않게 함께 갱신한다
      setNow(Date.now());
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.mate.onChanged(() => void refresh());
    // 실행기 생존·남은 시간 표시를 위해 가끔 다시 읽는다
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 10_000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [refresh]);

  /** 화면 동작 뒤 바로 다시 읽고, 실패하면 위에 보인다 */
  const act = useCallback(
    async (job: () => Promise<unknown>) => {
      try {
        await job();
        setError(undefined);
      } catch (e) {
        setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
      }
      await refresh();
    },
    [refresh],
  );

  if (!overview) return <div className="loading">{error ?? "불러오는 중…"}</div>;
  const freshCount = splitInbox(overview.inbox).fresh.length;
  const { runner } = overview;
  const current = runner.current ? overview.duties.find((d) => d.id === runner.current!.dutyId) : undefined;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">Pi Desktop Mate</div>
        <nav className="tabs">
          <button className={tab === "inbox" ? "active" : ""} onClick={() => setTab("inbox")}>
            인박스{freshCount > 0 && <span className="badge">{freshCount}</span>}
          </button>
          <button className={tab === "duties" ? "active" : ""} onClick={() => setTab("duties")}>
            임무 <span className="count">{overview.duties.length}</span>
          </button>
          <button className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}>
            실행 기록
          </button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
            설정
          </button>
        </nav>
        <div className="runner-status" title={runner.pid ? `실행기 pid ${runner.pid}` : undefined}>
          {overview.config.paused && <span className="chip warn">일시 정지</span>}
          {runner.alive ? (
            <span className="chip ok">{current ? `${current.name} ${STATUS_LABELS.running}` : "실행기 대기 중"}</span>
          ) : (
            <>
              <span className="chip bad">실행기 꺼짐</span>
              <button className="small" onClick={() => void act(() => window.mate.restartRunner())}>
                다시 시작
              </button>
            </>
          )}
        </div>
      </header>
      {(error ?? runner.error) && <div className="banner bad">{error ?? runner.error}</div>}
      <main className="content">
        {tab === "inbox" && <InboxPanel overview={overview} now={now} act={act} />}
        {tab === "duties" && <DutiesView overview={overview} now={now} act={act} />}
        {tab === "runs" && <RunsView overview={overview} now={now} />}
        {tab === "settings" && <SettingsView overview={overview} act={act} />}
      </main>
    </div>
  );
}

export type Act = (job: () => Promise<unknown>) => Promise<void>;
