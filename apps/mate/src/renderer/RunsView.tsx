import { useState } from "react";
import type { Overview, RunRecord } from "../shared/api";
import { costLabel, durationLabel, PROFILE_LABELS, relativeTime, STATUS_LABELS } from "./mate-view";

/** 최근 실행 기록 (새것부터) */
export function RunsView({ overview, now }: { overview: Overview; now: number }) {
  const { runs, runner } = overview;
  return (
    <section>
      <div className="section-head">
        <span className="muted">
          오늘 시간표 실행 {runner.today.count}회 / 하루 상한 {overview.config.dailyRunLimit}회 · "지금 실행"은 상한에 세지 않습니다
        </span>
      </div>
      {runs.length === 0 && <div className="empty">아직 실행 기록이 없습니다.</div>}
      <ul className="cards">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} now={now} />
        ))}
      </ul>
    </section>
  );
}

function RunRow({ run, now }: { run: RunRecord; now: number }) {
  const [open, setOpen] = useState(false);
  const text = run.error ?? run.summary;
  return (
    <li className={`card run-row status-${run.status}`}>
      <div className="card-head">
        <span className={`chip status-${run.status}`}>{STATUS_LABELS[run.status]}</span>
        <strong className="title">{run.dutyName}</strong>
        <span className="muted">
          {relativeTime(run.startedAt, now)} · {run.reason === "manual" ? "지금 실행" : "시간표"} · {PROFILE_LABELS[run.profile].name}
        </span>
        <span className="muted right">
          {[durationLabel(run), costLabel(run.costUsd), run.proposals ? `제안 ${run.proposals}건` : "", run.model].filter(Boolean).join(" · ")}
        </span>
      </div>
      {text && (
        <div className={`run-text${open ? " open" : ""}${run.error ? " bad-text" : ""}`} onClick={() => setOpen(!open)}>
          {text}
        </div>
      )}
    </li>
  );
}
