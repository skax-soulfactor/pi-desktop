/**
 * 앱 ↔ Host Agent 데몬 사이에서 쓰는 메서드 이름과 파라미터·결과 타입.
 * 설계 문서 §3.2(프로토콜), §3.4(상주 세션) 참고.
 *
 * Pi가 보내는 RPC 이벤트 자체는 여기서 타입을 정하지 않는다(`unknown`).
 * Pi 업데이트로 새 이벤트가 생겨도 데몬은 그대로 중계·저장하고, 해석은 앱이 관대하게 한다.
 */

/** 프로토콜 버전. 호환되지 않게 바뀔 때만 올린다. */
export const HOST_PROTOCOL_VERSION = 1;

export const Methods = {
  hostInfo: "host.info",
  piLocate: "pi.locate",
  sessionOpen: "session.open",
  sessionList: "session.list",
  sessionAttach: "session.attach",
  sessionDetach: "session.detach",
  sessionSend: "session.send",
  sessionClose: "session.close",
  /** 다른 프로그램이 쓴 것으로 감지된 표시를 지운다 (사용자가 "무시하고 계속"을 고름) */
  sessionClearExternalWrite: "session.clearExternalWrite",
  sessionHistory: "session.history",
  storedInspect: "stored.inspect",
  storedRead: "stored.read",
  storedWatch: "stored.watch",
  storedUnwatch: "stored.unwatch",
  /** 작업 폴더에서 파일을 찾는다 (입력창 @ 파일 피커) */
  fsSearch: "fs.search",
  daemonStatus: "daemon.status",
  daemonShutdown: "daemon.shutdown",
} as const;

/**
 * 데몬이 Pi 이벤트 사이에 끼워 저널에 남기는 이벤트 (Pi에는 없는 것).
 *
 * Pi는 RPC `bash`(`!` 셸 명령)를 실행할 때 출력 조각(`bash_execution_update`)만 보내고 시작·끝 이벤트가 없다.
 * 그러면 명령을 보낸 화면 말고는(다른 탭, 다시 연결한 앱) 무슨 명령인지 알 수 없어서 데몬이 대신 남긴다.
 * `id`는 같은 명령의 `bash_execution_update.id`와 같다.
 */
export const DaemonEvents = {
  /** `{ type, id, command, excludeFromContext }` */
  bashStart: "pi_desktop_bash_start",
  /** `{ type, id, exitCode, cancelled, truncated, fullOutputPath?, error? }` */
  bashEnd: "pi_desktop_bash_end",
} as const;

/** 데몬 → 앱 알림 */
export const Notifications = {
  /** 세션에서 Pi 이벤트가 나왔다 (저널 순번 포함) */
  sessionEvent: "session.event",
  /** 세션의 Pi 프로세스가 끝났다 */
  sessionExit: "session.exit",
  /** 확장 다이얼로그가 처리되었다 */
  sessionUiResolved: "session.uiResolved",
  /** 이 데몬의 Pi가 쓰는 세션 파일에 다른 프로그램(TUI 등)이 쓴 것을 감지했다 */
  sessionExternalWrite: "session.externalWrite",
  /** 감시 중인 저장 세션 파일이 바뀌었다 (다른 프로그램이 쓰는 중) */
  storedChanged: "stored.changed",
} as const;

export interface HostInfo {
  protocolVersion: number;
  agentVersion: string;
  /** Node의 process.platform 값 (win32, linux, darwin 등) */
  platform: string;
  arch: string;
  nodeVersion: string;
  pid: number;
  homeDir: string;
}

export interface PiLocation {
  /** Pi CLI 진입 파일(`dist/bundle/cli.js`)의 절대 경로 */
  cliPath: string;
  /** Pi 패키지 루트 */
  packageDir: string;
  version: string;
  /** 어떤 경로로 찾았는지 (설정값, 환경 변수, npm 전역 등) */
  source: "param" | "env" | "managed" | "npm-global";
  /**
   * Pi를 실행할 node. 관리형 설치기가 자체 Node(`pi-node`)를 깔았으면 그 경로이고,
   * 없으면 생략되어 데몬의 node를 그대로 쓴다.
   */
  nodePath?: string;
  /** Pi 프로세스에 추가로 줄 환경 변수 (예: 관리형 설치의 PI_MANAGED_INSTALL_ROOT, PATH) */
  env?: Record<string, string>;
}

export interface PiLocateParams {
  /** 지정하면 이 경로를 먼저 시도한다 */
  piCliPath?: string;
}

export interface SessionOpenParams {
  cwd: string;
  /** 이어서 열 Pi 세션 파일. 없으면 새 세션 */
  sessionFile?: string;
  /**
   * 이 세션 파일에서 분기한 새 세션으로 연다 (pi --fork). 다른 프로그램이 쓰고 있는 세션을
   * 같은 파일에 함께 쓰지 않고 이어 갈 때 쓴다. sessionFile과 함께 줄 수 없다.
   */
  forkFrom?: string;
  /** Pi CLI 경로를 직접 지정할 때 */
  piCliPath?: string;
  /** `pi --mode rpc` 뒤에 붙일 추가 인자 (예: `--provider`, `--model`) */
  piArgs?: string[];
  /** Pi 프로세스에만 추가로 줄 환경 변수 */
  env?: Record<string, string>;
}

export type SessionState = "running" | "exited";

export interface SessionSummary {
  sessionId: string;
  cwd: string;
  state: SessionState;
  /** 지금까지 저널에 쌓인 마지막 순번 (이벤트가 없으면 0) */
  lastSeq: number;
  /** Pi가 알려준 세션 파일 경로 (아직 모르면 없음) */
  sessionFile?: string;
  piVersion: string;
  startedAt: number;
  exitCode?: number | null;
  /** 답을 기다리는 확장 다이얼로그 수 (세션 목록에서 "입력 필요" 표시용) */
  pendingUi: number;
  /**
   * 다른 프로그램이 이 세션 파일에 쓴 것을 감지한 시각 (ms). 감지되지 않았으면 없음.
   * 같은 파일에 두 프로그램이 함께 쓰면 기록이 꼬이므로 앱은 입력을 잠그고 선택을 묻는다 (설계 §5.4)
   */
  externalWriteAt?: number;
}

export interface SessionOpenResult {
  session: SessionSummary;
}

export interface SessionAttachParams {
  sessionId: string;
  /** 앱이 마지막으로 받은 순번. 처음 붙을 때는 0 */
  lastSeq: number;
}

export interface SessionAttachResult {
  session: SessionSummary;
  /**
   * 저널 앞부분이 잘려서 `lastSeq` 바로 다음부터 재생할 수 없었으면 true.
   * 이때 앱은 `get_messages` 같은 Pi 명령으로 현재 상태를 다시 받아야 한다.
   */
  truncated: boolean;
  /** 이 응답 직전에 재생(알림으로 전송)한 이벤트 범위. 재생할 것이 없으면 null */
  replayed: { fromSeq: number; toSeq: number } | null;
  /** 아직 아무도 답하지 않은 확장 다이얼로그(select·confirm·input·editor)의 요청 id */
  pendingUi: string[];
}

export interface SessionRef {
  sessionId: string;
}

export interface SessionSendParams {
  sessionId: string;
  /** Pi RPC 명령 객체 그대로 (예: `{ type: "prompt", message: "..." }`). `id`는 데몬이 붙인다 */
  command: Record<string, unknown>;
  /** Pi 응답을 기다리지 않는 명령 (예: `extension_ui_response`) */
  noResponse?: boolean;
}

/** Pi의 `type: "response"` 레코드 그대로 */
export type PiResponse = Record<string, unknown>;

export interface SessionEventNotification {
  sessionId: string;
  seq: number;
  /** 데몬이 이벤트를 받은 시각 (ms) */
  at: number;
  event: unknown;
}

/** 확장 다이얼로그가 처리되었다 (어느 앱이 답했거나 Pi가 제한 시간으로 자동 처리함) */
export interface SessionUiResolvedNotification {
  sessionId: string;
  /** extension_ui_request의 id */
  id: string;
}

export interface SessionExitNotification {
  sessionId: string;
  exitCode: number | null;
  signal: string | null;
  /** 마지막 stderr 일부. 시작 실패 원인을 보여줄 때 쓴다 */
  stderrTail: string;
}

/** session.history 요청. cwd를 주면 그 폴더의 세션만, 없으면 모든 폴더의 세션 */
export interface SessionHistoryParams {
  cwd?: string;
  /** Pi 세션 저장 위치를 직접 지정할 때 (기본: Pi 설정을 따름) */
  sessionDir?: string;
  piCliPath?: string;
  /** 최대 개수 (최근 수정 순). 기본 200 */
  limit?: number;
}

/** Pi가 디스크에 저장한 세션 하나 (Pi SDK SessionManager.list의 SessionInfo에서 필요한 부분) */
export interface StoredSession {
  /** 세션 파일 경로 */
  path: string;
  id: string;
  cwd: string;
  name?: string;
  /** fork로 만들어졌으면 원래 세션 파일 */
  parentSessionPath?: string;
  /** ms */
  created: number;
  /** ms */
  modified: number;
  messageCount: number;
  /** 첫 사용자 메시지 (목록 표시용, 최대 200자) */
  firstMessage: string;
}

export interface DaemonStatus {
  pid: number;
  agentVersion: string;
  startedAt: number;
  clients: number;
  sessions: SessionSummary[];
  /** 세션·클라이언트가 모두 없을 때 스스로 종료하기까지의 대기 시간 (ms) */
  idleShutdownMs: number;
}

/** 답을 보내야 하는 확장 UI 메서드 (rpc-extension-ui.md). 나머지(notify, setStatus 등)는 알림만 한다. */
export const DIALOG_METHODS: readonly string[] = ["select", "confirm", "input", "editor"];

/** stored.inspect / stored.read / stored.watch 요청 */
export interface FsSearchParams {
  /** 검색할 작업 폴더 (호스트 기준 경로) */
  cwd: string;
  /** 검색어. 비면 얕은 경로부터 */
  query: string;
  /** 최대 결과 수 (기본 50) */
  limit?: number;
}

export interface FsSearchResult {
  /** 작업 폴더 기준 상대 경로. 구분자는 "/", 폴더는 끝에 "/" */
  files: string[];
  /** 파일이 너무 많아 일부만 검색했다 */
  truncated: boolean;
}

export interface StoredPathParams {
  /** 세션 파일 경로 */
  path: string;
  piCliPath?: string;
}

/** 저장된 세션 파일의 상태. 다른 프로그램이 쓰고 있는지 판단하는 데 쓴다 */
export interface StoredInspectResult {
  path: string;
  exists: boolean;
  size: number;
  /** 마지막 수정 시각 (ms) */
  modified: number;
  /** 이 데몬의 실행 중인 세션이 이 파일을 쓰고 있으면 그 세션 id */
  ownedBy?: string;
}

/** 저장된 세션 파일을 읽어 만든 현재 갈래의 대화 (파일은 읽기만 한다) */
export interface StoredReadResult {
  path: string;
  /** Pi AgentMessage 목록 (현재 갈래, 컴팩션 반영) */
  messages: unknown[];
  leafId: string | null;
  model: { provider: string; modelId: string } | null;
  size: number;
  modified: number;
}

/** stored.changed 알림 */
export interface StoredChangedNotification {
  path: string;
  size: number;
  modified: number;
}

/** session.externalWrite 알림 */
export interface SessionExternalWriteNotification {
  sessionId: string;
  /** 감지한 시각 (ms) */
  at: number;
  /** 바뀐 세션 파일 */
  path: string;
}
