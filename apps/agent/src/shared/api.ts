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
import type { PiSetupView } from "./pi-setup";

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
  piSetup: "agent:pi-setup",
  openPiDesktop: "agent:open-pi-desktop",
  installPiDesktop: "agent:install-pi-desktop",
  listSessions: "agent:list-sessions",
  closeSession: "agent:close-session",
  listMemories: "agent:list-memories",
  addMemory: "agent:add-memory",
  forgetMemory: "agent:forget-memory",
  listRules: "agent:list-rules",
  removeRule: "agent:remove-rule",
  listAudit: "agent:list-audit",
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
  installProgress: "agent:install-progress",
} as const;

export type { ConnectionState, PiSetupView, Schedule, TaskRecord };

/** attach 결과. attach 도중 알림으로 온 이벤트도 함께 담는다 (Pi Desktop의 AttachResult와 같음) */
export interface AttachResult extends SessionAttachResult {
  events: SessionEventNotification[];
}

/** 기억 하나 (agent-kit memory/store의 Memory와 같은 모양) */
export interface MemoryView {
  id: string;
  kind: "preference" | "fact" | "lesson";
  created: string;
  text: string;
}

/** 승인 규칙 (agent-kit permissions/rules의 Rule) */
export interface RuleView {
  toolName: string;
  pattern: string;
  action: "allow" | "deny";
}

/** 감사 기록 한 줄 (agent-kit permissions/store의 AuditRecord) */
export interface AuditView {
  at: string;
  toolName: string;
  target: string;
  decision: string;
  cwd: string;
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
  /** Pi 준비 상태 (Pi·Node·모델·Git Bash·Pi Desktop) */
  piSetup(): Promise<PiSetupView>;
  /** 설치된 Pi Desktop을 연다. 없으면 false */
  openPiDesktop(): Promise<boolean>;
  /** Pi Desktop 최신 설치 파일을 내려받아 연다 (확인 창을 띄움) */
  installPiDesktop(): Promise<{ status: "opened" | "cancelled" | "page" }>;
  /** 데몬에서 돌고 있는 대화 세션 (스케줄러 세션은 뺀다) */
  listSessions(): Promise<SessionSummary[]>;
  closeSession(sessionId: string): Promise<void>;
  listMemories(): Promise<MemoryView[]>;
  addMemory(kind: MemoryView["kind"], text: string): Promise<void>;
  forgetMemory(id: string): Promise<void>;
  listRules(): Promise<RuleView[]>;
  removeRule(rule: RuleView): Promise<void>;
  listAudit(): Promise<AuditView[]>;
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
  onInstallProgress(listener: (received: number, total: number) => void): () => void;
}
