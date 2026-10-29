import type { MateProfile } from "@pi-desktop/mate-kit";

/** 언제 돌릴지 (설계 DESIGN-MATE.md §3). 파일·git·폴링 계기는 M2 */
export type Trigger =
  | { kind: "manual" }
  | { kind: "interval"; minutes: number }
  /** time: "HH:MM"(로컬 시각), weekdays: 0(일)~6(토), 없으면 매일 */
  | { kind: "daily"; time: string; weekdays?: number[] };

export interface Duty {
  id: string;
  name: string;
  enabled: boolean;
  /** 작업 폴더 */
  cwd: string;
  /** 모델에 주는 지시 */
  prompt: string;
  profile: MateProfile;
  trigger: Trigger;
  /** 없으면 Mate 설정의 기본 모델 */
  model?: string;
  timeoutSec?: number;
  createdAt: number;
  updatedAt?: number;
}

export interface MateConfig {
  /** provider/id 형식 */
  model: string;
  /** 켜면 시간표 실행을 하지 않는다 ("지금 실행"은 함) */
  paused: boolean;
  /** 하루 시간표 실행 상한 (모든 임무 합계) */
  dailyRunLimit: number;
}

export const DEFAULT_CONFIG: MateConfig = {
  model: "anthropic/claude-haiku-5-5",
  paused: false,
  dailyRunLimit: 20,
};

export const DEFAULT_TIMEOUT_SEC = 300;
/** interval 계기의 최소 간격 (비용·소음 방지) */
export const MIN_INTERVAL_MINUTES = 15;

export type RunStatus = "running" | "done" | "failed" | "timeout";

export interface RunRecord {
  id: string;
  dutyId: string;
  dutyName: string;
  reason: "schedule" | "manual";
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  model: string;
  profile: MateProfile;
  /** 마지막 답변 (길면 자름) */
  summary?: string;
  error?: string;
  costUsd?: number;
  tokens?: number;
  /** 이 실행에서 인박스에 새로 남긴 제안 수 */
  proposals?: number;
  sessionId?: string;
}

export interface RunnerState {
  pid?: number;
  /** 실행기 번들의 해시. 앱이 자기 번들과 다르면 실행기를 바꾼다 */
  build?: string;
  startedAt?: number;
  heartbeatAt?: number;
  duties: Record<string, { lastRunAt?: number; lastStatus?: RunStatus }>;
  /** 오늘(로컬 날짜) 시간표 실행 수 */
  today: { date: string; count: number };
  current?: { runId: string; dutyId: string; startedAt: number };
}

/** "지금 실행" 요청 (requests/<시각>-<id>.json) */
export interface RunRequest {
  dutyId: string;
  requestedAt: number;
}

export type InboxStatus = "accepted" | "dismissed";

/** inbox-state.json: 제안별 사용자 처리 상태. 없으면 "새 제안" */
export type InboxState = Record<string, { status: InboxStatus; at: number }>;
