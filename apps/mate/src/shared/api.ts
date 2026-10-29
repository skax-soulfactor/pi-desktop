import type { InboxItem } from "@pi-desktop/mate-kit/shared";
import type {
  ActivityRecord,
  Duty,
  InboxStatus,
  MateConfig,
  ProjectSnapshot,
  RunnerState,
  RunRecord,
  RunStatus,
} from "@pi-desktop/mate-runner/types";
import type { PiReadiness } from "@pi-desktop/mate-runner/pi-readiness";

export type { PiReadiness };

/** Pi 준비 상태 + 설치된 Pi Desktop 위치 */
export interface PiSetupView extends PiReadiness {
  piDesktopPath?: string;
  checkedAt: number;
}

export type { ActivityRecord, Duty, InboxItem, InboxStatus, MateConfig, ProjectSnapshot, RunRecord, RunStatus };

export const IpcChannels = {
  overview: "mate:overview",
  saveDuty: "mate:save-duty",
  deleteDuty: "mate:delete-duty",
  runNow: "mate:run-now",
  setInbox: "mate:set-inbox",
  saveConfig: "mate:save-config",
  pickDirectory: "mate:pick-directory",
  restartRunner: "mate:restart-runner",
  revealHome: "mate:reveal-home",
  readSession: "mate:read-session",
  applyChange: "mate:apply-change",
  delegate: "mate:delegate",
  discardChange: "mate:discard-change",
  getAutostart: "mate:get-autostart",
  setAutostart: "mate:set-autostart",
  piReadiness: "mate:pi-readiness",
  installPiDesktop: "mate:install-pi-desktop",
  openPiDesktop: "mate:open-pi-desktop",
  installProgress: "mate:install-progress",
  updateState: "mate:update-state",
  updateStateChanged: "mate:update-state-changed",
  checkForUpdates: "mate:check-for-updates",
  confirmUpdate: "mate:confirm-update",
  changed: "mate:changed",
} as const;

export interface DutyView extends Duty {
  lastRunAt?: number;
  lastStatus?: RunStatus;
  nextRunAt?: number;
  /** "지금 실행"을 눌러 실행기를 기다리는 중 */
  queued: boolean;
  /** 변화 계기: 감지해서 실행을 기다리는 변화 */
  pendingChange?: { cause: string; since: number };
}

/** Mate 자동 업데이트 상태 (Pi Desktop과 같은 모양) */
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

export interface AutostartView {
  supported: boolean;
  enabled: boolean;
  reason?: string;
}

/** 실행 세션을 읽기 전용으로 보여 줄 때의 한 줄 */
export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; args: string; result?: string; isError?: boolean }
  | { kind: "note"; text: string };

export interface InboxView extends InboxItem {
  /** 없으면 새 제안 */
  status?: InboxStatus;
  dutyName: string;
}

export interface RunnerView {
  alive: boolean;
  pid?: number;
  heartbeatAt?: number;
  current?: RunnerState["current"];
  today: RunnerState["today"];
  /** 실행기를 띄우지 못했을 때 이유 */
  error?: string;
}

export interface Overview {
  home: string;
  config: MateConfig;
  duties: DutyView[];
  inbox: InboxView[];
  runs: RunRecord[];
  runner: RunnerView;
  observe: ObserveView;
}

/** 활동 관찰 화면 (M4) */
export interface ObserveView {
  /** 최근 활동 기록 (새것부터) */
  activity: ActivityRecord[];
  /** 관찰자가 살펴보길 기다리는 후보 수 */
  queue: number;
  today: { date: string; count: number };
  projects: ProjectSnapshot[];
  /** 주제별 사용자 반응 (보여 줌·받아들임·버림) */
  feedback: Record<string, { shown: number; accepted: number; dismissed: number }>;
  since?: number;
}

/** 화면에서 만들거나 고친 임무. id가 없으면 새 임무 */
export type DutyDraft = Omit<Duty, "id" | "createdAt" | "updatedAt"> & { id?: string };

export interface MateApi {
  overview(): Promise<Overview>;
  saveDuty(draft: DutyDraft): Promise<Duty>;
  deleteDuty(id: string): Promise<void>;
  runNow(id: string): Promise<void>;
  setInbox(ids: string[], status: InboxStatus | undefined): Promise<void>;
  saveConfig(patch: Partial<Omit<MateConfig, "observe">> & { observe?: Partial<MateConfig["observe"]> }): Promise<MateConfig>;
  pickDirectory(): Promise<string | undefined>;
  restartRunner(): Promise<RunnerView>;
  revealHome(): Promise<void>;
  /** 실행 기록의 Pi 세션을 대화 형태로 읽는다 */
  readSession(runId: string): Promise<TranscriptItem[]>;
  /** act 변경을 내 작업 폴더에 적용한다 (커밋하지 않은 변경으로) */
  applyChange(itemId: string): Promise<void>;
  /** act 변경과 그 작업 공간을 버린다 */
  discardChange(itemId: string): Promise<void>;
  /** 제안의 맡길 일을 그 폴더에서 바로 실행한다 (git 저장소면 고치기) */
  delegate(itemId: string): Promise<void>;
  /** 로그인할 때 실행기 시작 (설치본만) */
  getAutostart(): Promise<AutostartView>;
  setAutostart(enabled: boolean): Promise<AutostartView>;
  /** Pi 준비 상태 (설치·로그인·모델). refresh면 캐시를 버리고 다시 확인 */
  piReadiness(refresh?: boolean): Promise<PiSetupView>;
  /** Pi Desktop을 내려받아 설치 프로그램을 연다 */
  installPiDesktop(): Promise<{ status: "opened" | "cancelled" | "page"; path?: string }>;
  /** 설치된 Pi Desktop을 연다. 없으면 false */
  openPiDesktop(): Promise<boolean>;
  onInstallProgress(listener: (received: number, total: number) => void): () => void;
  /** 자동 업데이트 */
  updateState(): Promise<UpdateState>;
  /** interactive면 결과를 창으로 알리고, 새 버전이 있으면 업데이트할지 묻는다 */
  checkForUpdates(interactive?: boolean): Promise<UpdateState>;
  /** 찾은 새 버전을 받을지 묻는다 (상단 배지) */
  confirmUpdate(): Promise<void>;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  /** Mate 홈의 파일이 바뀌면 불린다. 해제 함수를 돌려준다 */
  onChanged(listener: () => void): () => void;
}
