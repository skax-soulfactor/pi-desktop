import { useMemo } from "react";
import { formatCost, formatPercent, formatTokens, modelKey, parseModelKey } from "./format";
import type { ModelInfo, SessionInfo } from "./use-session-info";

const THINKING_LABELS: Record<string, string> = {
  off: "끔",
  minimal: "최소",
  low: "낮음",
  medium: "보통",
  high: "높음",
  xhigh: "매우 높음",
  max: "최대",
};

interface Props {
  info: SessionInfo;
  running: boolean;
  disabled: boolean;
  onModel: (provider: string, id: string) => void;
  onThinking: (level: string) => void;
  onCompact: () => void;
}

/** 모델·thinking 수준·컨텍스트 사용량·비용·Compact (설계 §4.1 상단 바) */
export function SessionBar({ info, running, disabled, onModel, onThinking, onCompact }: Props) {
  const groups = useMemo(() => groupByProvider(info.models, info.model), [info.models, info.model]);
  const usage = info.stats?.contextUsage;
  const percent = usage?.percent ?? null;
  const level = percent === null ? "unknown" : percent >= 85 ? "high" : percent >= 60 ? "mid" : "low";

  return (
    <section className="session-bar">
      <label className="field">
        <span>모델</span>
        <select
          value={info.model ? modelKey(info.model) : ""}
          disabled={disabled || running || groups.length === 0}
          onChange={(e) => {
            const parsed = parseModelKey(e.target.value);
            if (parsed) onModel(parsed.provider, parsed.id);
          }}
        >
          {!info.model && <option value="">불러오는 중…</option>}
          {groups.map(([provider, models]) => (
            <optgroup key={provider} label={provider}>
              {models.map((m) => (
                <option key={modelKey(m)} value={modelKey(m)}>
                  {m.name ?? m.id}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Thinking</span>
        <select
          value={info.thinkingLevel ?? ""}
          disabled={disabled || running || info.thinkingLevels.length <= 1}
          onChange={(e) => onThinking(e.target.value)}
        >
          {info.thinkingLevels.length === 0 && <option value="">–</option>}
          {info.thinkingLevels.map((l) => (
            <option key={l} value={l}>
              {THINKING_LABELS[l] ?? l}
            </option>
          ))}
        </select>
      </label>

      <div
        className={`usage ${level}`}
        title={
          usage
            ? `컨텍스트 ${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)} 토큰` +
              (percent === null ? " (컴팩션 직후라 다음 응답 뒤에 갱신됩니다)" : "")
            : "사용량 정보 없음"
        }
      >
        <span className="usage-label">컨텍스트</span>
        <span className="usage-track">
          <span className="usage-fill" style={{ width: `${Math.min(100, percent ?? 0)}%` }} />
        </span>
        <span className="usage-value">{formatPercent(percent)}</span>
      </div>

      <span
        className="cost"
        title={
          info.stats?.tokens
            ? `입력 ${formatTokens(info.stats.tokens.input)} · 출력 ${formatTokens(info.stats.tokens.output)} · ` +
              `캐시 읽기 ${formatTokens(info.stats.tokens.cacheRead)} · 캐시 쓰기 ${formatTokens(info.stats.tokens.cacheWrite)}`
            : undefined
        }
      >
        {formatTokens(info.stats?.tokens?.total)} 토큰 · {formatCost(info.stats?.cost)}
      </span>

      <div className="spacer" />
      <button
        type="button"
        disabled={disabled || running}
        onClick={onCompact}
        title="지금까지의 대화를 요약해 컨텍스트를 줄입니다"
      >
        Compact
      </button>
    </section>
  );
}

/** 프로바이더별로 묶는다. 목록에 없는 현재 모델(예: 확장이 바꾼 모델)도 보이게 넣는다. */
function groupByProvider(models: ModelInfo[], current: ModelInfo | undefined): Array<[string, ModelInfo[]]> {
  const all = current && !models.some((m) => modelKey(m) === modelKey(current)) ? [current, ...models] : models;
  const map = new Map<string, ModelInfo[]>();
  for (const model of all) {
    const list = map.get(model.provider) ?? [];
    list.push(model);
    map.set(model.provider, list);
  }
  return [...map.entries()];
}
