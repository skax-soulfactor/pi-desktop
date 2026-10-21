/**
 * 활동 패널 규칙 (설계 §3.3 "Activity"). 여러 호스트의 세션을 한눈에 보여준다. 화면과 분리한 순수 함수.
 */
import type { SessionSummary } from "@pi-desktop/host-protocol/messages";

export type ActivityState = "input" | "busy" | "idle" | "exited";

export interface ActivityEntry {
  hostId: string;
  hostLabel: string;
  session: SessionSummary;
  state: ActivityState;
}

export const ACTIVITY_LABELS: Record<ActivityState, string> = {
  input: "입력 필요",
  busy: "작업 중",
  idle: "대기",
  exited: "종료됨",
};

/**
 * 세션의 활동 상태. 사용자의 답을 기다리는 것(확장 다이얼로그, 다른 프로그램의 끼어들기)이 가장 먼저다.
 */
export function activityState(session: SessionSummary): ActivityState {
  if (session.state === "exited") return "exited";
  if (session.pendingUi > 0 || session.externalWriteAt !== undefined) return "input";
  return session.busy ? "busy" : "idle";
}

const ORDER: Record<ActivityState, number> = { input: 0, busy: 1, idle: 2, exited: 3 };

/** 호스트들의 세션을 모아 입력 필요 → 작업 중 → 대기 → 종료, 같으면 최근에 시작한 것부터 */
export function collectActivity(
  hosts: ReadonlyArray<{ hostId: string; hostLabel: string; sessions: readonly SessionSummary[] }>,
): ActivityEntry[] {
  const entries = hosts.flatMap((h) =>
    h.sessions.map((session) => ({ hostId: h.hostId, hostLabel: h.hostLabel, session, state: activityState(session) })),
  );
  return entries.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.session.startedAt - a.session.startedAt);
}

/** 탭 버튼 배지: 사용자가 신경 써야 할 세션 수 (입력 필요 + 작업 중) */
export function activityCounts(entries: readonly ActivityEntry[]): { input: number; busy: number } {
  return {
    input: entries.filter((e) => e.state === "input").length,
    busy: entries.filter((e) => e.state === "busy").length,
  };
}

/** 이 세션을 보고 있는 탭. 없으면 undefined */
export function tabShowing(
  statuses: Readonly<Record<string, { hostId: string; sessionId?: string } | undefined>>,
  hostId: string,
  sessionId: string,
): string | undefined {
  return Object.entries(statuses).find(([, s]) => s?.hostId === hostId && s.sessionId === sessionId)?.[0];
}

/** 항목에 보여줄 이름: 제목, 없으면 작업 폴더 이름 */
export function activityTitle(session: SessionSummary): string {
  if (session.title) return session.title;
  const parts = session.cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? session.cwd;
}
