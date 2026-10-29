import type { InboxItem } from "@pi-desktop/mate-kit/shared";
import type { Duty, InboxStatus, MateConfig, RunnerState, RunRecord, RunStatus } from "@pi-desktop/mate-runner/types";
import type { PiReadiness } from "@pi-desktop/mate-runner/pi-readiness";

export type { PiReadiness };

/** Pi 준비 상태 + 설치된 Pi Desktop 위치 */
export interface PiSetupView extends PiReadiness {
  piDesktopPath?: string;
  checkedAt: number;
}

export type { Duty, InboxItem, InboxStatus, MateConfig, RunRecord, RunStatus };

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
  discardChange: "mate:discard-change",
  getAutostart: "mate:get-autostart",
  setAutostart: "mate:set-autostart",
  piReadiness: "mate:pi-readiness",
  installPiDesktop: "mate:install-pi-desktop",
  openPiDesktop: "mate:open-pi-desktop",
  installProgress: "mate:install-progress",
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
}

/** 화면에서 만들거나 고친 임무. id가 없으면 새 임무 */
export type DutyDraft = Omit<Duty, "id" | "createdAt" | "updatedAt"> & { id?: string };

export interface MateApi {
  overview(): Promise<Overview>;
  saveDuty(draft: DutyDraft): Promise<Duty>;
  deleteDuty(id: string): Promise<void>;
  runNow(id: string): Promise<void>;
  setInbox(ids: string[], status: InboxStatus | undefined): Promise<void>;
  saveConfig(patch: Partial<MateConfig>): Promise<MateConfig>;
  pickDirectory(): Promise<string | undefined>;
  restartRunner(): Promise<RunnerView>;
  revealHome(): Promise<void>;
  /** 실행 기록의 Pi 세션을 대화 형태로 읽는다 */
  readSession(runId: string): Promise<TranscriptItem[]>;
  /** act 변경을 내 작업 폴더에 적용한다 (커밋하지 않은 변경으로) */
  applyChange(itemId: string): Promise<void>;
  /** act 변경과 그 작업 공간을 버린다 */
  discardChange(itemId: string): Promise<void>;
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
  /** Mate 홈의 파일이 바뀌면 불린다. 해제 함수를 돌려준다 */
  onChanged(listener: () => void): () => void;
}
