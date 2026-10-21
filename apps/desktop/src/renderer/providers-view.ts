/**
 * 프로바이더 화면 규칙 (설계 §4.7). 화면과 분리한 순수 함수.
 */
import type { AuthCheckResult, ProviderInfo } from "@pi-desktop/host-protocol/messages";
import { matchesQuery } from "./session-search";

/** 자격 증명이 저장된 것을 먼저, 그다음 이름순. 검색어로 이름·ID를 거른다 */
export function visibleProviders(list: readonly ProviderInfo[], query: string): ProviderInfo[] {
  return list
    .filter((p) => matchesQuery(query, [p.name, p.id]))
    .sort((a, b) => Number(Boolean(b.stored)) - Number(Boolean(a.stored)) || a.name.localeCompare(b.name));
}

export const STORED_LABELS: Record<NonNullable<ProviderInfo["stored"]>, string> = {
  api_key: "API 키 저장됨",
  oauth: "OAuth 로그인됨",
  other: "자격 증명 저장됨",
};

/** pi auth check 결과를 화면 문구와 수준으로 */
export function checkLabel(result: AuthCheckResult | undefined): { text: string; level: "ok" | "warn" | "bad" | "info" } | undefined {
  if (!result) return undefined;
  switch (result.status) {
    case "ready":
      return { text: "사용 가능", level: "ok" };
    case "not_ready":
      return { text: result.reason === "credentials_not_configured" ? "자격 증명 없음" : "준비 안 됨", level: "info" };
    case "invalid":
      return { text: `자격 증명이 잘못됨${result.reason ? ` (${result.reason})` : ""}`, level: "bad" };
    default:
      return { text: "확인하지 못함", level: "warn" };
  }
}

/** 저장 전에 키 입력값을 확인한다. 문제가 있으면 이유 */
export function keyProblem(key: string): string | undefined {
  const trimmed = key.trim();
  if (!trimmed) return "키를 입력하세요";
  if (/[\r\n]/.test(trimmed)) return "키에 줄바꿈이 있습니다";
  if (/\s/.test(trimmed) && !trimmed.startsWith("!")) return "키에 공백이 있습니다 (명령을 쓰려면 !로 시작하세요)";
  return undefined;
}
