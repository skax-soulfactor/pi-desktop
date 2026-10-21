/**
 * main ↔ renderer 사이의 IPC 계약.
 *
 * 렌더러는 Node·Electron API에 직접 접근하지 않는다(contextIsolation + sandbox).
 * preload가 이 인터페이스만 `window.piDesktop`으로 노출한다 (설계 §5.8).
 */
import type {
  FsSearchResult,
  HostInfo,
  PiLocation,
  PiResponse,
  SessionAttachResult,
  SessionEventNotification,
  SessionExitNotification,
  SessionExternalWriteNotification,
  SessionSummary,
  SessionUiResolvedNotification,
  StoredChangedNotification,
  StoredInspectResult,
  StoredReadResult,
  StoredSession,
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

/** 재생 이벤트를 함께 담은 attach 결과 */
export interface AttachResult extends SessionAttachResult {
  events: SessionEventNotification[];
}

export interface OpenSessionRequest {
  cwd: string;
  /** 이어서 열 Pi 세션 파일. 없으면 새 세션 */
  sessionFile?: string;
  /** 이 세션 파일에서 분기한 새 세션으로 연다 (다른 프로그램이 쓰는 세션을 이어 갈 때) */
  forkFrom?: string;
}

export interface PiDesktopApi {
  /** 이 PC에서 쓸 수 있는 호스트 목록 */
  listHosts(): Promise<HostDescriptor[]>;
  /** 호스트 연결을 시작하고 현재 상태를 돌려준다 (이미 연결 중이면 그대로) */
  connectHost(hostId: string): Promise<ConnectionState>;
  locatePi(hostId: string): Promise<PiLocation>;
  listSessions(hostId: string): Promise<SessionSummary[]>;
  /** Pi가 디스크에 저장한 세션 기록. cwd를 주면 그 폴더의 세션만 */
  listHistory(hostId: string, cwd?: string): Promise<StoredSession[]>;
  /** 세션 파일 상태 (다른 프로그램이 쓰고 있는지 판단용) */
  inspectStored(hostId: string, path: string): Promise<StoredInspectResult>;
  /** 세션 파일을 읽기만 해서 현재 대화를 받는다 (팔로우 모드) */
  readStored(hostId: string, path: string): Promise<StoredReadResult>;
  /** 세션 파일 변경 감시 시작·해제 (팔로우 모드) */
  watchStored(hostId: string, path: string): Promise<void>;
  unwatchStored(hostId: string, path: string): Promise<void>;
  openSession(hostId: string, request: OpenSessionRequest): Promise<SessionSummary>;
  /**
   * 세션에 붙는다. 재생된 이벤트는 알림이 아니라 결과의 events로 함께 돌려준다.
   * (IPC 알림과 invoke 응답은 렌더러에 도착하는 순서가 보장되지 않기 때문)
   */
  attachSession(hostId: string, sessionId: string, lastSeq: number): Promise<AttachResult>;
  closeSession(hostId: string, sessionId: string): Promise<void>;
  /** 다른 프로그램의 끼어들기 표시를 지운다 ("무시하고 계속") */
  clearExternalWrite(hostId: string, sessionId: string): Promise<void>;
  /** Pi RPC 명령을 보내고 Pi의 응답을 받는다 */
  sendCommand(hostId: string, sessionId: string, command: Record<string, unknown>): Promise<PiResponse>;
  /** 응답이 없는 레코드를 Pi에 보낸다 (예: 확장 다이얼로그 응답 extension_ui_response) */
  sendRecord(hostId: string, sessionId: string, record: Record<string, unknown>): Promise<void>;
  /** 폴더 선택 대화상자 (로컬 호스트 전용) */
  pickDirectory(): Promise<string | undefined>;
  /**
   * 툴이 다룬 파일을 탐색기에서 보여준다 (파일을 실행하지 않도록 열지는 않고 위치만 보여준다).
   * 이 PC에서 열 수 없는 호스트면 false.
   */
  revealFile(hostId: string, cwd: string, path: string): Promise<boolean>;
  /** 작업 폴더에서 파일을 찾는다 (입력창 @ 파일 피커). 경로는 작업 폴더 기준, 구분자 "/" */
  searchFiles(hostId: string, cwd: string, query: string): Promise<FsSearchResult>;

  onConnection(listener: (hostId: string, state: ConnectionState) => void): () => void;
  onSessionEvent(listener: (hostId: string, notification: SessionEventNotification) => void): () => void;
  onSessionExit(listener: (hostId: string, notification: SessionExitNotification) => void): () => void;
  /** 확장 다이얼로그가 처리되었다 (다른 창에서 답했거나 제한 시간이 지남) */
  onUiResolved(listener: (hostId: string, notification: SessionUiResolvedNotification) => void): () => void;
  /** 감시 중인 세션 파일이 바뀌었다 */
  onStoredChanged(listener: (hostId: string, notification: StoredChangedNotification) => void): () => void;
  /** 이 앱의 Pi가 쓰는 세션 파일에 다른 프로그램이 쓴 것이 감지되었다 */
  onExternalWrite(listener: (hostId: string, notification: SessionExternalWriteNotification) => void): () => void;
}

/** IPC 채널 이름. invoke(요청/응답)와 send(main → renderer 알림)를 구분한다. */
export const IpcChannels = {
  listHosts: "pi:list-hosts",
  connectHost: "pi:connect-host",
  locatePi: "pi:locate",
  listSessions: "pi:list-sessions",
  openSession: "pi:open-session",
  listHistory: "pi:list-history",
  inspectStored: "pi:inspect-stored",
  readStored: "pi:read-stored",
  watchStored: "pi:watch-stored",
  unwatchStored: "pi:unwatch-stored",
  attachSession: "pi:attach-session",
  closeSession: "pi:close-session",
  clearExternalWrite: "pi:clear-external-write",
  sendCommand: "pi:send-command",
  sendRecord: "pi:send-record",
  pickDirectory: "pi:pick-directory",
  revealFile: "pi:reveal-file",
  searchFiles: "pi:search-files",
  connectionChanged: "pi:connection-changed",
  sessionEvent: "pi:session-event",
  sessionExit: "pi:session-exit",
  uiResolved: "pi:ui-resolved",
  storedChanged: "pi:stored-changed",
  externalWrite: "pi:external-write",
} as const;
