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
  daemonStatus: "daemon.status",
  daemonShutdown: "daemon.shutdown",
} as const;

/** 데몬 → 앱 알림 */
export const Notifications = {
  /** 세션에서 Pi 이벤트가 나왔다 (저널 순번 포함) */
  sessionEvent: "session.event",
  /** 세션의 Pi 프로세스가 끝났다 */
  sessionExit: "session.exit",
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

export interface SessionExitNotification {
  sessionId: string;
  exitCode: number | null;
  signal: string | null;
  /** 마지막 stderr 일부. 시작 실패 원인을 보여줄 때 쓴다 */
  stderrTail: string;
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
