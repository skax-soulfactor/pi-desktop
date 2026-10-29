import type { DutyDraft, DutyView, InboxView, RunRecord, RunStatus } from "../shared/api";

type Trigger = DutyDraft["trigger"];

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export const PROFILE_LABELS: Record<DutyDraft["profile"], { name: string; hint: string }> = {
  observe: { name: "보고", hint: "읽기만 하고, 실행마다 결과 한 건을 인박스에 남깁니다" },
  propose: { name: "제안", hint: "읽기만 하고, 알릴 것이 있을 때만 골라 인박스에 남깁니다" },
};

export function triggerLabel(trigger: Trigger): string {
  switch (trigger.kind) {
    case "manual":
      return "직접 실행";
    case "interval":
      return trigger.minutes % 60 === 0 ? `${trigger.minutes / 60}시간마다` : `${trigger.minutes}분마다`;
    case "daily": {
      const days = trigger.weekdays?.length ? trigger.weekdays.map((d) => WEEKDAY_LABELS[d]).join("·") : "매일";
      return `${days} ${trigger.time}`;
    }
  }
}

export const STATUS_LABELS: Record<RunStatus, string> = {
  running: "실행 중",
  done: "완료",
  failed: "실패",
  timeout: "시간 초과",
};

/** "3분 전", "어제 09:00" 처럼 짧게 */
export function relativeTime(ms: number, now: number): string {
  const diff = now - ms;
  const abs = Math.abs(diff);
  const future = diff < 0;
  if (abs < 60_000) return future ? "곧" : "방금";
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}분 ${future ? "뒤" : "전"}`;
  const d = new Date(ms);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const dayDiff = Math.round((startOfDay(ms) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return `오늘 ${time}`;
  if (dayDiff === -1) return `어제 ${time}`;
  if (dayDiff === 1) return `내일 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function durationLabel(run: RunRecord): string {
  if (!run.endedAt) return "";
  const sec = Math.max(0, Math.round((run.endedAt - run.startedAt) / 1000));
  return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

export function costLabel(usd: number | undefined): string {
  if (!usd) return "";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** 새 제안 / 처리한 제안으로 나눈다 (각각 새것부터) */
export function splitInbox(items: InboxView[]): { fresh: InboxView[]; handled: InboxView[] } {
  return { fresh: items.filter((i) => !i.status), handled: items.filter((i) => !!i.status) };
}

/** 다음 실행 안내 */
export function nextRunLabel(duty: DutyView, now: number, paused: boolean): string {
  if (!duty.enabled) return "꺼짐";
  if (duty.queued) return "실행 대기 중";
  if (duty.trigger.kind === "manual") return "직접 실행만";
  if (paused) return "일시 정지됨";
  if (duty.nextRunAt === undefined) return "";
  return duty.nextRunAt <= now ? "곧 실행" : `다음: ${relativeTime(duty.nextRunAt, now)}`;
}

/** 새 임무 폼의 빈 값과 템플릿 (설계 DESIGN-MATE.md §1의 쓰임 예) */
export function emptyDraft(cwd = ""): DutyDraft {
  return { name: "", enabled: true, cwd, prompt: "", profile: "propose", trigger: { kind: "manual" } };
}

export const DUTY_TEMPLATES: Array<{ label: string; draft: Omit<DutyDraft, "cwd"> }> = [
  {
    label: "아침 브리핑",
    draft: {
      name: "아침 브리핑",
      enabled: true,
      profile: "observe",
      trigger: { kind: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] },
      prompt:
        "이 저장소의 상태를 살펴 오늘 할 일을 정리하라. git status·최근 커밋, 열린 PR과 CI 상태(gh pr list, gh run list)를 확인하고 " +
        "주의할 것과 이어서 할 일을 세 줄 이내로 요약하라.",
    },
  },
  {
    label: "CI 확인",
    draft: {
      name: "CI 확인",
      enabled: true,
      profile: "propose",
      trigger: { kind: "interval", minutes: 60 },
      prompt:
        "gh run list --limit 5와 gh pr checks로 최근 CI를 확인하라. 실패한 것이 있으면 gh run view --log-failed로 원인을 찾아 " +
        "고칠 방법을 제안하라. 모두 통과했으면 아무것도 남기지 마라.",
    },
  },
  {
    label: "의존성 점검",
    draft: {
      name: "의존성 점검",
      enabled: true,
      profile: "propose",
      trigger: { kind: "daily", time: "10:00", weekdays: [1] },
      prompt: "npm outdated와 npm audit로 오래되었거나 취약한 의존성을 확인하고, 올릴 만한 것과 이유를 제안하라.",
    },
  },
];
