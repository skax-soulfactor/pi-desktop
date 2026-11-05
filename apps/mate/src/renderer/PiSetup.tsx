import { useState } from "react";
import type { PiSetupView } from "../shared/api";
import type { Act } from "./App";
import { piSetupIssues } from "./mate-view";

/**
 * Pi 준비 안내 (설계 DESIGN-MATE.md §9). 문제가 없으면 아무것도 그리지 않는다.
 * Pi 설치·로그인·모델 관리는 Pi 작업 공간의 Pi 관리에서만 한다 (설계 DESIGN-ONE-APP.md §7). 여기서는 그리로 보낸다.
 */
export function PiSetupBanner({
  setup,
  model,
  act,
  onRefresh,
  onUsePiDefault,
}: {
  setup: PiSetupView;
  model: string;
  act: Act;
  onRefresh: () => void;
  onUsePiDefault: () => void;
}) {
  const issues = piSetupIssues(setup, model);
  if (issues.length === 0) return null;

  return (
    <div className="setup-banner">
      {issues.map((issue) => (
        <div key={issue.kind} className={`setup-issue ${issue.level}`}>
          <strong>{issue.title}</strong>
          <span className="muted">{issue.detail}</span>
          <div className="row">
            {(issue.kind === "no-pi" || issue.kind === "no-models") && (
              <button className="small primary" onClick={() => void act(() => window.mate.openPiManager())}>
                Pi 관리 열기
              </button>
            )}
            {issue.kind === "git-bash" && (
              <a className="small-link" href="https://git-scm.com/download/win" target="_blank" rel="noreferrer">
                Git for Windows 내려받기
              </a>
            )}
            {issue.kind === "model" && setup.piDefaultModel && (
              <button className="small" onClick={onUsePiDefault}>
                Pi 기본 모델({setup.piDefaultModel})로 바꾸기
              </button>
            )}
          </div>
        </div>
      ))}
      <div className="row">
        <button className="small" onClick={onRefresh}>
          다시 확인
        </button>
      </div>
    </div>
  );
}

const INHERIT = "__inherit__";
const CUSTOM = "__custom__";

/**
 * 모델 고르기: 첫 항목은 "따르기"(value가 비어 있음), 그 아래 Pi에서 쓸 수 있는 모델(프로바이더별), 마지막에 직접 입력.
 * 목록에 없는 값이 들어 있으면 직접 입력 칸을 보인다.
 */
export function ModelSelect({
  value,
  onChange,
  setup,
  inheritLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  setup: PiSetupView | undefined;
  inheritLabel: string;
}) {
  const models = setup?.models ?? [];
  const known = models.some((m) => `${m.provider}/${m.id}` === value);
  const [custom, setCustom] = useState(!!value && !known && models.length > 0);
  // 직접 입력을 골랐으면 값이 비어 있어도 입력 칸을 보인다
  const selected = custom ? CUSTOM : !value ? INHERIT : known ? value : CUSTOM;
  const providers = [...new Set(models.map((m) => m.provider))];
  return (
    <div className="row">
      <select
        value={selected}
        onChange={(e) => {
          const next = e.target.value;
          if (next === CUSTOM) return setCustom(true);
          setCustom(false);
          onChange(next === INHERIT ? "" : next);
        }}
      >
        <option value={INHERIT}>{inheritLabel}</option>
        {providers.map((provider) => (
          <optgroup key={provider} label={provider}>
            {models
              .filter((m) => m.provider === provider)
              .map((m) => (
                <option key={m.id} value={`${m.provider}/${m.id}`}>
                  {m.id}
                </option>
              ))}
          </optgroup>
        ))}
        <option value={CUSTOM}>직접 입력…</option>
      </select>
      {selected === CUSTOM && (
        <input className="grow" value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="provider/model-id" autoFocus={custom} />
      )}
      {!setup && <span className="muted small-text">모델 목록을 불러오는 중…</span>}
    </div>
  );
}
