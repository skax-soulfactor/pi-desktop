/** 토큰 수를 짧게 표시한다: 950 → "950", 12_300 → "12.3k", 1_500_000 → "1.5M" */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${trim(value / 1000)}k`;
  return `${trim(value / 1_000_000)}M`;
}

/** 비용(USD)을 표시한다. 1센트 미만은 소수 넷째 자리까지 보여준다. */
export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  if (value === 0) return "$0";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

/** 모델 선택 목록의 값. 프로바이더마다 같은 ID가 있을 수 있어 함께 묶는다. */
export function modelKey(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

/** "provider/id"를 나눈다. ID에 '/'가 들어 있을 수 있어(예: openrouter) 첫 번째 '/'에서만 자른다. */
export function parseModelKey(key: string): { provider: string; id: string } | undefined {
  const index = key.indexOf("/");
  if (index <= 0 || index === key.length - 1) return undefined;
  return { provider: key.slice(0, index), id: key.slice(index + 1) };
}

function trim(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

/** 사용률(%)을 표시한다. 10% 미만은 소수 한 자리까지 보여줘 큰 컨텍스트 창에서도 0%로 뭉개지지 않게 한다. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  if (value > 0 && value < 10) return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(value)}%`;
}
