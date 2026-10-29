/**
 * mate-kit 확장·실행기·앱이 함께 쓰는 이름과 형식 (설계 DESIGN-MATE.md §2.2, §5).
 * 실행기는 이 환경 변수로 실행마다의 권한 단계와 인박스 위치를 확장에 넘긴다.
 */
export const MATE_ENV = {
  /** 권한 단계. 없으면 확장은 아무것도 막지 않는다 (터미널 pi에 설치한 경우) */
  profile: "PI_DESKTOP_MATE_PROFILE",
  /** 제안을 쌓을 inbox.jsonl 경로 */
  inbox: "PI_DESKTOP_MATE_INBOX",
  dutyId: "PI_DESKTOP_MATE_DUTY",
  runId: "PI_DESKTOP_MATE_RUN",
  /** act: write·edit를 허용하는 작업 공간(git worktree) 루트 */
  writeRoot: "PI_DESKTOP_MATE_WRITE_ROOT",
  /** 관찰자 실행: 제안에 붙일 주제 */
  topic: "PI_DESKTOP_MATE_TOPIC",
} as const;

export const PROPOSE_TOOL = "mate_propose";

/** observe: 읽기만, propose: 읽기 + 제안, act: 별도 작업 공간에서 고치고 승인을 기다림 (M3) */
export type MateProfile = "observe" | "propose" | "act";

export const PROFILES: readonly MateProfile[] = ["observe", "propose", "act"];

export function isProfile(value: unknown): value is MateProfile {
  return typeof value === "string" && (PROFILES as readonly string[]).includes(value);
}

/** 권한 단계마다 모델에 선언하는 도구. 실행기는 이 목록으로 `--tools`를 만든다 */
export function profileTools(profile: MateProfile): string[] {
  const read = ["read", "grep", "find", "ls", "bash"];
  switch (profile) {
    case "observe":
      return read;
    case "propose":
      return [...read, PROPOSE_TOOL];
    case "act":
      return [...read, "edit", "write", PROPOSE_TOOL];
  }
}

export type Severity = "info" | "warn" | "action";

/** act 실행이 작업 공간에 남긴 변경 (인박스에서 적용·버리기) */
export interface ChangeInfo {
  /** 사용자 저장소 루트 */
  repo: string;
  /** git worktree 폴더 (Mate 홈 worktrees/ 안, 브랜치 없이 분리된 HEAD). 변경은 커밋하지 않고 여기 남는다 */
  worktree: string;
  /** 작업 공간을 만든 커밋 */
  base: string;
  /** 바뀐 파일 (저장소 기준 경로) */
  files: string[];
}

/** inbox.jsonl 한 줄. 한 번 쓰면 바꾸지 않는다 (상태는 inbox-state.json) */
export interface InboxItem {
  id: string;
  /** 중복 제거용: 임무 + 제목 + 요약 (act 변경은 임무 + 패치) */
  hash: string;
  dutyId: string;
  runId: string;
  title: string;
  summary: string;
  /** 근거·파일·명령 출력 (Markdown) */
  detail?: string;
  severity: Severity;
  createdAt: number;
  /** act 실행의 변경. 있으면 인박스에서 "적용"할 수 있다 */
  change?: ChangeInfo;
  /** 활동 관찰이 남긴 제안의 주제 (사용자가 계속 버리는 주제는 덜 알린다) */
  topic?: string;
  /** 사용자가 "Mate에게 맡기기"를 누르면 이 지시로 고치기를 실행한다 (cwd 폴더에서) */
  followUp?: { prompt: string; cwd: string };
}
