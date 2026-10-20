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
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "connected"; host: HostInfo }
  | { status: "disconnected"; reason: string };

/** Pi가 도는 곳 하나. 로컬 PC 또는 WSL 배포판 (SSH는 M3). */
export interface HostDescriptor {
  /** "local" 또는 "wsl:<배포판 이름>" */
  id: string;
  kind: "local" | "wsl";
  /** 화면 표시용 이름 */
  label: string;
}

export interface OpenSessionRequest {
  cwd: string;
}

export interface PiDesktopApi {
  /** 이 PC에서 쓸 수 있는 호스트 목록 */
  listHosts(): Promise<HostDescriptor[]>;
  /** 호스트 연결을 시작하고 현재 상태를 돌려준다 (이미 연결 중이면 그대로) */
  connectHost(hostId: string): Promise<ConnectionState>;
  locatePi(hostId: string): Promise<PiLocation>;
  listSessions(hostId: string): Promise<SessionSummary[]>;
  openSession(hostId: string, request: OpenSessionRequest): Promise<SessionSummary>;
  attachSession(hostId: string, sessionId: string, lastSeq: number): Promise<SessionAttachResult>;
  closeSession(hostId: string, sessionId: string): Promise<void>;
  /** Pi RPC 명령을 보내고 Pi의 응답을 받는다 */
  sendCommand(hostId: string, sessionId: string, command: Record<string, unknown>): Promise<PiResponse>;
  /** 폴더 선택 대화상자 (로컬 호스트 전용) */
  pickDirectory(): Promise<string | undefined>;

  onConnection(listener: (hostId: string, state: ConnectionState) => void): () => void;
  onSessionEvent(listener: (hostId: string, notification: SessionEventNotification) => void): () => void;
  onSessionExit(listener: (hostId: string, notification: SessionExitNotification) => void): () => void;
}

/** IPC 채널 이름. invoke(요청/응답)와 send(main → renderer 알림)를 구분한다. */
export const IpcChannels = {
  listHosts: "pi:list-hosts",
  connectHost: "pi:connect-host",
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
