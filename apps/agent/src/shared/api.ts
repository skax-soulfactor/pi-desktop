import type {
  PiResponse,
  SessionAttachResult,
  SessionEventNotification,
  SessionExitNotification,
  SessionSummary,
  SessionUiResolvedNotification,
  StoredSession,
} from "@pi-desktop/host-protocol/messages";
import type { TaskRecord } from "@pi-desktop/agent-kit/task-types";
import type { UsageRange, UsageSummary } from "@pi-desktop/agent-kit/usage-types";

export type { UsageRange, UsageSource, UsageSummary, UsageTotals } from "@pi-desktop/agent-kit/usage-types";
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
  listTasks: "agent:list-tasks",
  listSchedules: "agent:list-schedules",
  setScheduleEnabled: "agent:set-schedule-enabled",
  removeSchedule: "agent:remove-schedule",
  piSetup: "agent:pi-setup",
  openPiDesktop: "agent:open-pi-desktop",
  installPiDesktop: "agent:install-pi-desktop",
  listSessions: "agent:list-sessions",
  closeSession: "agent:close-session",
  updateState: "agent:update-state",
  checkForUpdates: "agent:check-for-updates",
  confirmUpdate: "agent:confirm-update",
  listMemories: "agent:list-memories",
  addMemory: "agent:add-memory",
  forgetMemory: "agent:forget-memory",
  getAutoLearn: "agent:get-auto-learn",
  setAutoLearn: "agent:set-auto-learn",
  listRules: "agent:list-rules",
  removeRule: "agent:remove-rule",
  listAudit: "agent:list-audit",
  usageSummary: "agent:usage-summary",
  openSession: "agent:open-session",
  listHistory: "agent:list-history",
  searchHistory: "agent:search-history",
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
  updateStateChanged: "agent:update-state-changed",
  menuCommand: "agent:menu-command",
} as const;

export type { ConnectionState, PiSetupView, Schedule, TaskRecord };

/** attach 결과. attach 도중 알림으로 온 이벤트도 함께 담는다 (Pi Desktop의 AttachResult와 같음) */
export interface AttachResult extends SessionAttachResult {
  events: SessionEventNotification[];
}

/** 자동 업데이트 상태 (Pi Desktop Mate와 같은 모양) */
export interface UpdateState {
  /** disabled: 개발·로컬 빌드, idle, checking, none: 최신, available, downloading, downloaded: 다시 시작하면 설치, error */
  status: "disabled" | "idle" | "checking" | "none" | "available" | "downloading" | "downloaded" | "error";
  current: string;
  /** auto: 내려받아 설치(Windows·AppImage), notify: 알리기만(서명 없는 macOS·deb) */
  mode: "auto" | "notify";
  version?: string;
  percent?: number;
  error?: string;
  checkedAt?: number;
}

/** 사이드바의 대화 하나: 데몬 세션 요약 + Pi 세션 이름 (set_session_name) */
export type ChatSummary = SessionSummary & { name?: string };

/** Pi가 디스크에 남긴 지난 대화 하나 (데몬 session.history의 StoredSession) */
export type StoredChat = StoredSession;

/** 지난 대화 본문 검색 결과 */
export interface HistoryHit {
  path: string;
  snippet: string;
}

/** 새 세션 대신 이어 열 곳: 그 세션 파일을 그대로(sessionFile), 또는 거기서 분기해서(forkFrom) */
export type SessionSource = { sessionFile: string } | { forkFrom: string };

/** 기억 하나 (agent-kit memory/store의 Memory와 같은 모양) */
export interface MemoryView {
  id: string;
  kind: "preference" | "fact" | "lesson";
  created: string;
  text: string;
  /** 대화가 끝난 뒤 자동으로 뽑은 기억이면 "auto" */
  source?: "auto";
  updated?: string;
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
  /** 데몬에서 돌고 있는 대화 세션과 그 이름 (스케줄러 세션은 뺀다) */
  listSessions(): Promise<ChatSummary[]>;
  closeSession(sessionId: string): Promise<void>;
  updateState(): Promise<UpdateState>;
  /** interactive면 결과를 창으로 알리고, 새 버전이 있으면 업데이트할지 묻는다 */
  checkForUpdates(interactive?: boolean): Promise<UpdateState>;
  /** 찾은 새 버전을 받을지 묻는다 (사이드바 배지) */
  confirmUpdate(): Promise<void>;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  /** 앱 메뉴바에서 고른 명령 (app-menu.ts의 MenuCommand) */
  onMenuCommand(listener: (id: string) => void): () => void;
  listMemories(): Promise<MemoryView[]>;
  addMemory(kind: MemoryView["kind"], text: string): Promise<void>;
  forgetMemory(id: string): Promise<void>;
  /** 대화가 끝난 뒤 자동으로 기억을 뽑는가 */
  getAutoLearn(): Promise<boolean>;
  setAutoLearn(on: boolean): Promise<void>;
  listRules(): Promise<RuleView[]>;
  removeRule(rule: RuleView): Promise<void>;
  listAudit(): Promise<AuditView[]>;
  /** 기간의 사용량 (Pi 세션 파일 + 세션 밖 호출) */
  usageSummary(range: UsageRange): Promise<UsageSummary>;
  /** agent-kit 확장을 올린 새 Pi 세션을 연다 */
  /** 새 세션을 연다. forkFrom(세션 파일)을 주면 그 대화를 이어 가는 분기 세션으로 연다 */
  openSession(cwd: string, from?: SessionSource): Promise<SessionSummary>;
  /** 지난 대화 (최근 순, 스케줄러 세션 제외) */
  listHistory(): Promise<StoredChat[]>;
  /** 지난 대화의 본문까지 찾는다 */
  searchHistory(query: string): Promise<HistoryHit[]>;
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
