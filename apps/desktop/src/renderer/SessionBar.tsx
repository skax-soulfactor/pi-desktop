import { formatCost, formatPercent, formatTokens } from "./format";
import { ModelPicker } from "./ModelPicker";
import type { SessionInfo } from "./use-session-info";

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
  onAutoCompaction: (enabled: boolean) => void;
  treeOpen: boolean;
  onToggleTree: () => void;
}

/** 모델·thinking 수준·컨텍스트 사용량·비용·Compact (설계 §4.1 상단 바) */
export function SessionBar(props: Props) {
  const { info, running, disabled, onModel, onThinking, onCompact, onAutoCompaction, treeOpen, onToggleTree } = props;
  const usage = info.stats?.contextUsage;
  const percent = usage?.percent ?? null;
  const level = percent === null ? "unknown" : percent >= 85 ? "high" : percent >= 60 ? "mid" : "low";

  return (
    <section className="session-bar">
      <div className="field">
        <span>모델</span>
        <ModelPicker
          models={info.models}
          current={info.model}
          disabled={disabled || running}
          onPick={(model) => onModel(model.provider, model.id)}
        />
      </div>

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
        className={treeOpen ? "toggled" : ""}
        aria-pressed={treeOpen}
        onClick={onToggleTree}
        title="대화의 분기 구조를 보고, 질문에서 분기하거나 현재 위치를 복제합니다"
      >
        트리
      </button>
      <button
        type="button"
        disabled={disabled || running}
        onClick={onCompact}
        title="지금까지의 대화를 요약해 컨텍스트를 줄입니다"
      >
        Compact
      </button>
      <label className="auto-compact" title="컨텍스트가 거의 차면 Pi가 자동으로 대화를 요약합니다">
        <input
          type="checkbox"
          checked={info.autoCompaction ?? false}
          disabled={disabled || info.autoCompaction === undefined}
          onChange={(e) => onAutoCompaction(e.target.checked)}
        />
        자동
      </label>
    </section>
  );
}
