/**
 * main ↔ renderer 사이의 IPC 계약.
 *
 * 렌더러는 Node·Electron API에 직접 접근하지 않는다(contextIsolation + sandbox).
 * preload가 이 인터페이스만 `window.piDesktop`으로 노출한다 (설계 §5.8).
 */
import type {
  HostInfo,
  PiLocation,
  PiResponse,
  SessionAttachResult,
  SessionEventNotification,
  SessionExitNotification,
  SessionSummary,
} from "@pi-desktop/host-protocol/messages";

export type ConnectionState =
  | { status: "connecting" }
  | { status: "connected"; host: HostInfo }
  | { status: "disconnected"; reason: string };

export interface OpenSessionRequest {
  cwd: string;
}

export interface PiDesktopApi {
  /** 현재 Host Agent 연결 상태 */
  getConnection(): Promise<ConnectionState>;
  locatePi(): Promise<PiLocation>;
  listSessions(): Promise<SessionSummary[]>;
  openSession(request: OpenSessionRequest): Promise<SessionSummary>;
  attachSession(sessionId: string, lastSeq: number): Promise<SessionAttachResult>;
  closeSession(sessionId: string): Promise<void>;
  /** Pi RPC 명령을 보내고 Pi의 응답을 받는다 */
  sendCommand(sessionId: string, command: Record<string, unknown>): Promise<PiResponse>;
  /** 폴더 선택 대화상자 */
  pickDirectory(): Promise<string | undefined>;

  onConnection(listener: (state: ConnectionState) => void): () => void;
  onSessionEvent(listener: (notification: SessionEventNotification) => void): () => void;
  onSessionExit(listener: (notification: SessionExitNotification) => void): () => void;
}

/** IPC 채널 이름. invoke(요청/응답)와 send(main → renderer 알림)를 구분한다. */
export const IpcChannels = {
  getConnection: "pi:get-connection",
  locatePi: "pi:locate",
  listSessions: "pi:list-sessions",
  openSession: "pi:open-session",
  attachSession: "pi:attach-session",
  closeSession: "pi:close-session",
  sendCommand: "pi:send-command",
  pickDirectory: "pi:pick-directory",
  connectionChanged: "pi:connection-changed",
  sessionEvent: "pi:session-event",
  sessionExit: "pi:session-exit",
} as const;
