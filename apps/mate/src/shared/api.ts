import type { InboxItem } from "@pi-desktop/mate-kit/shared";
import type { Duty, InboxStatus, MateConfig, RunnerState, RunRecord, RunStatus } from "@pi-desktop/mate-runner/types";

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
  changed: "mate:changed",
} as const;

export interface DutyView extends Duty {
  lastRunAt?: number;
  lastStatus?: RunStatus;
  nextRunAt?: number;
  /** "지금 실행"을 눌러 실행기를 기다리는 중 */
  queued: boolean;
}

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
  /** Mate 홈의 파일이 바뀌면 불린다. 해제 함수를 돌려준다 */
  onChanged(listener: () => void): () => void;
}
