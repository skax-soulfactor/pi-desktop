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
} as const;

export const PROPOSE_TOOL = "mate_propose";

/** observe: 읽기만, propose: 읽기 + 제안 (act는 M3) */
export type MateProfile = "observe" | "propose";

export const PROFILES: readonly MateProfile[] = ["observe", "propose"];

export function isProfile(value: unknown): value is MateProfile {
  return typeof value === "string" && (PROFILES as readonly string[]).includes(value);
}

/** 권한 단계마다 모델에 선언하는 도구. 실행기는 이 목록으로 `--tools`를 만든다 */
export function profileTools(profile: MateProfile): string[] {
  const read = ["read", "grep", "find", "ls", "bash"];
  return profile === "propose" ? [...read, PROPOSE_TOOL] : read;
}

export type Severity = "info" | "warn" | "action";

/** inbox.jsonl 한 줄. 한 번 쓰면 바꾸지 않는다 (상태는 inbox-state.json) */
export interface InboxItem {
  id: string;
  /** 중복 제거용: 임무 + 제목 + 요약 */
  hash: string;
  dutyId: string;
  runId: string;
  title: string;
  summary: string;
  /** 근거·파일·명령 출력 (Markdown) */
  detail?: string;
  severity: Severity;
  createdAt: number;
}
