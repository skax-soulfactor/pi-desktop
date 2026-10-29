import type {
  PiResponse,
  SessionAttachResult,
  SessionEventNotification,
  SessionExitNotification,
  SessionSummary,
  SessionUiResolvedNotification,
} from "@pi-desktop/host-protocol/messages";
import type { TaskRecord } from "@pi-desktop/agent-kit/task-types";
import type { Schedule } from "@pi-desktop/agent-kit/schedule-plan";
import type { ConnectionState } from "../vendor/shared/api";

/**
 * 에이전트 앱의 main ↔ renderer IPC.
 *
 * Pi Desktop과 달리 호스트는 로컬 하나뿐이라 hostId를 주고받지 않는다 (원격은 Pi Desktop의 몫).
 */
export const IpcChannels = {
  connectionState: "agent:connection-state",
  defaultCwd: "agent:default-cwd",
  pickDirectory: "agent:pick-directory",
  pickFiles: "agent:pick-files",
  listKeys: "agent:list-keys",
  setKey: "agent:set-key",
  removeKey: "agent:remove-key",
  listTasks: "agent:list-tasks",
  listSchedules: "agent:list-schedules",
  setScheduleEnabled: "agent:set-schedule-enabled",
  removeSchedule: "agent:remove-schedule",
  openSession: "agent:open-session",
  attachSession: "agent:attach-session",
  sendCommand: "agent:send-command",
  sendRecord: "agent:send-record",
  // main → renderer 알림
  connectionChanged: "agent:connection-changed",
  sessionEvent: "agent:session-event",
  sessionExit: "agent:session-exit",
  uiResolved: "agent:ui-resolved",
  tasksChanged: "agent:tasks-changed",
} as const;

export type { ConnectionState, Schedule, TaskRecord };

/** attach 결과. attach 도중 알림으로 온 이벤트도 함께 담는다 (Pi Desktop의 AttachResult와 같음) */
export interface AttachResult extends SessionAttachResult {
  events: SessionEventNotification[];
}

export interface AgentApi {
  connectionState(): Promise<ConnectionState>;
  /** 처음 열 작업 폴더 (사용자 홈) */
  defaultCwd(): Promise<string>;
  pickDirectory(): Promise<string | undefined>;
  /** 첨부할 파일을 고른다 (여러 개). 취소하면 빈 배열 */
  pickFiles(): Promise<string[]>;
  /** OS 키체인에 저장한 API 키 이름들 (값은 돌려주지 않는다) */
  listKeys(): Promise<string[]>;
  setKey(name: string, value: string): Promise<void>;
  removeKey(name: string): Promise<void>;
  /** 최근 작업 (대화에서 맡긴 것·예약 실행). 최근 것부터 */
  listTasks(): Promise<TaskRecord[]>;
  listSchedules(): Promise<Schedule[]>;
  setScheduleEnabled(id: string, enabled: boolean): Promise<void>;
  removeSchedule(id: string): Promise<void>;
  /** agent-kit 확장을 올린 새 Pi 세션을 연다 */
  openSession(cwd: string): Promise<SessionSummary>;
  attachSession(sessionId: string, lastSeq: number): Promise<AttachResult>;
  /** 응답을 기다리는 Pi RPC 명령 (prompt, abort, get_commands …) */
  sendCommand(sessionId: string, command: Record<string, unknown>): Promise<PiResponse>;
  /** 응답이 없는 레코드 (extension_ui_response) */
  sendRecord(sessionId: string, record: Record<string, unknown>): Promise<void>;
  onConnection(listener: (state: ConnectionState) => void): () => void;
  onSessionEvent(listener: (notification: SessionEventNotification) => void): () => void;
  onSessionExit(listener: (notification: SessionExitNotification) => void): () => void;
  onUiResolved(listener: (notification: SessionUiResolvedNotification) => void): () => void;
  /** 작업 기록이 바뀌었다 (새 작업·끝난 작업) */
  onTasksChanged(listener: () => void): () => void;
}
