import { useState } from "react";
import type { DutyDraft, DutyView, Overview } from "../shared/api";
import type { Act } from "./App";
import {
  DUTY_TEMPLATES,
  emptyDraft,
  nextRunLabel,
  PROFILE_LABELS,
  relativeTime,
  STATUS_LABELS,
  triggerLabel,
  WEEKDAY_LABELS,
} from "./mate-view";

/** 임무 목록과 만들기·고치기 폼 */
export function DutiesView({ overview, now, act }: { overview: Overview; now: number; act: Act }) {
  const [editing, setEditing] = useState<DutyDraft>();

  if (editing) {
    return (
      <DutyForm
        initial={editing}
        defaultModel={overview.config.model}
        onCancel={() => setEditing(undefined)}
        onSave={async (draft) => {
          await act(() => window.mate.saveDuty(draft));
          setEditing(undefined);
        }}
      />
    );
  }

  const lastCwd = overview.duties.at(-1)?.cwd ?? "";
  return (
    <section>
      <div className="section-head">
        <span className="muted">정한 때에 Pi가 작업 폴더를 읽기만 하며 살펴보고, 결과·제안을 인박스에 남깁니다.</span>
        <button className="primary" onClick={() => setEditing(emptyDraft(lastCwd))}>
          새 임무
        </button>
      </div>
      {overview.duties.length === 0 && (
        <div className="empty">
          <p>아직 임무가 없습니다. 템플릿으로 시작해 보세요.</p>
          <div className="row">
            {DUTY_TEMPLATES.map((t) => (
              <button key={t.label} onClick={() => setEditing({ ...t.draft, cwd: lastCwd })}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <ul className="cards">
        {overview.duties.map((duty) => (
          <DutyCard key={duty.id} duty={duty} now={now} paused={overview.config.paused} act={act} onEdit={() => setEditing(duty)} />
        ))}
      </ul>
    </section>
  );
}

function DutyCard({ duty, now, paused, act, onEdit }: { duty: DutyView; now: number; paused: boolean; act: Act; onEdit: () => void }) {
  const toggle = () => void act(() => window.mate.saveDuty({ ...duty, enabled: !duty.enabled }));
  return (
    <li className={`card duty-card${duty.enabled ? "" : " disabled"}`}>
      <div className="card-head">
        <label className="switch" title={duty.enabled ? "끄기" : "켜기"}>
          <input type="checkbox" checked={duty.enabled} onChange={toggle} />
        </label>
        <strong className="title">{duty.name}</strong>
        <span className="chip">{PROFILE_LABELS[duty.profile].name}</span>
        <span className="muted">{triggerLabel(duty.trigger)}</span>
      </div>
      <div className="muted path" title={duty.cwd}>
        {duty.cwd}
      </div>
      <div className="duty-meta">
        <span>{nextRunLabel(duty, now, paused)}</span>
        {duty.lastRunAt && (
          <span className={duty.lastStatus === "done" ? "" : "bad-text"}>
            마지막: {relativeTime(duty.lastRunAt, now)} {duty.lastStatus ? STATUS_LABELS[duty.lastStatus] : ""}
          </span>
        )}
      </div>
      <div className="card-actions">
        <button className="small primary" disabled={duty.queued} onClick={() => void act(() => window.mate.runNow(duty.id))}>
          지금 실행
        </button>
        <button className="small" onClick={onEdit}>
          고치기
        </button>
        <button
          className="small danger"
          onClick={() => {
            if (confirm(`"${duty.name}" 임무를 지울까요? 이미 쌓인 제안과 실행 기록은 남습니다.`)) void act(() => window.mate.deleteDuty(duty.id));
          }}
        >
          지우기
        </button>
      </div>
    </li>
  );
}

function DutyForm({
  initial,
  defaultModel,
  onSave,
  onCancel,
}: {
  initial: DutyDraft;
  defaultModel: string;
  onSave: (draft: DutyDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<DutyDraft>(initial);
  const set = (patch: Partial<DutyDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const t = draft.trigger;
  const valid = draft.name.trim() && draft.cwd.trim() && draft.prompt.trim();

  const setKind = (kind: DutyDraft["trigger"]["kind"]) =>
    set({
      trigger: kind === "manual" ? { kind } : kind === "interval" ? { kind, minutes: 60 } : { kind, time: "09:00", weekdays: [1, 2, 3, 4, 5] },
    });
  const toggleDay = (day: number) => {
    if (t.kind !== "daily") return;
    const days = new Set(t.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
    if (days.has(day)) days.delete(day);
    else days.add(day);
    set({ trigger: { ...t, weekdays: [...days].sort() } });
  };

  return (
    <section className="form">
      <h2>{initial.id ? "임무 고치기" : "새 임무"}</h2>
      {!initial.id && (
        <div className="row">
          <span className="muted">템플릿:</span>
          {DUTY_TEMPLATES.map((tpl) => (
            <button key={tpl.label} className="small" onClick={() => setDraft({ ...tpl.draft, cwd: draft.cwd })}>
              {tpl.label}
            </button>
          ))}
        </div>
      )}
      <label>
        이름
        <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 아침 브리핑" />
      </label>
      <label>
        작업 폴더
        <div className="row">
          <input className="grow" value={draft.cwd} onChange={(e) => set({ cwd: e.target.value })} placeholder="Pi가 살펴볼 저장소 폴더" />
          <button
            onClick={async () => {
              const dir = await window.mate.pickDirectory();
              if (dir) set({ cwd: dir });
            }}
          >
            찾아보기
          </button>
        </div>
      </label>
      <label>
        지시
        <textarea rows={5} value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="무엇을 살펴보고 무엇을 알려 줄지" />
      </label>
      <fieldset>
        <legend>하는 일</legend>
        {(Object.keys(PROFILE_LABELS) as Array<DutyDraft["profile"]>).map((p) => (
          <label key={p} className="radio">
            <input type="radio" checked={draft.profile === p} onChange={() => set({ profile: p })} />
            <strong>{PROFILE_LABELS[p].name}</strong> <span className="muted">{PROFILE_LABELS[p].hint}</span>
          </label>
        ))}
        <div className="muted small-text">어느 쪽이든 파일을 바꾸거나 쓰기 명령을 실행하지 않습니다 (bash는 읽기 명령만 통과).</div>
      </fieldset>
      <fieldset>
        <legend>언제</legend>
        <div className="row">
          <select value={t.kind} onChange={(e) => setKind(e.target.value as DutyDraft["trigger"]["kind"])}>
            <option value="manual">직접 실행만</option>
            <option value="interval">일정 간격</option>
            <option value="daily">정한 시각</option>
          </select>
          {t.kind === "interval" && (
            <>
              <input
                type="number"
                min={15}
                step={15}
                value={t.minutes}
                onChange={(e) => set({ trigger: { kind: "interval", minutes: Number(e.target.value) } })}
              />
              <span className="muted">분마다 (최소 15분)</span>
            </>
          )}
          {t.kind === "daily" && (
            <>
              <input type="time" value={t.time} onChange={(e) => set({ trigger: { ...t, time: e.target.value } })} />
              {WEEKDAY_LABELS.map((label, day) => (
                <label key={day} className="day">
                  <input type="checkbox" checked={!t.weekdays?.length || t.weekdays.includes(day)} onChange={() => toggleDay(day)} />
                  {label}
                </label>
              ))}
            </>
          )}
        </div>
        <div className="muted small-text">앱을 닫아도 실행기가 돌며 시간표를 지킵니다. PC가 꺼져 있던 동안 놓친 실행은 한 번만 따라잡습니다.</div>
      </fieldset>
      <details>
        <summary>고급</summary>
        <label>
          모델
          <input value={draft.model ?? ""} onChange={(e) => set({ model: e.target.value || undefined })} placeholder={`기본: ${defaultModel}`} />
        </label>
        <label>
          시간 제한(초)
          <input
            type="number"
            min={30}
            max={3600}
            value={draft.timeoutSec ?? ""}
            onChange={(e) => set({ timeoutSec: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="기본: 300"
          />
        </label>
      </details>
      <div className="row end">
        <button onClick={onCancel}>취소</button>
        <button className="primary" disabled={!valid} onClick={() => void onSave(draft)}>
          저장
        </button>
      </div>
    </section>
  );
}
