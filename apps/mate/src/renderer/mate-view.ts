import type { DutyDraft, DutyView, InboxView, RunRecord, RunStatus } from "../shared/api";

type Trigger = DutyDraft["trigger"];

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export const PROFILE_LABELS: Record<DutyDraft["profile"], { name: string; hint: string }> = {
  observe: { name: "보고", hint: "읽기만 하고, 실행마다 결과 한 건을 인박스에 남깁니다" },
  propose: { name: "제안", hint: "읽기만 하고, 알릴 것이 있을 때만 골라 인박스에 남깁니다" },
  act: {
    name: "고치기",
    hint: "별도 작업 공간(git worktree)에서 고치고, 인박스에서 \"적용\"을 눌러야 내 폴더에 들어옵니다 (git 저장소만)",
  },
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
    case "git":
      return "새 커밋이 생기면";
    case "files":
      return "파일이 바뀌면";
    case "poll":
      return `"${trigger.command}" 결과가 바뀌면 (${trigger.minutes}분마다 확인)`;
  }
}

/** 임무 폼의 "언제" 선택지 */
export const TRIGGER_KINDS: Array<{ kind: Trigger["kind"]; label: string }> = [
  { kind: "manual", label: "직접 실행만" },
  { kind: "interval", label: "일정 간격" },
  { kind: "daily", label: "정한 시각" },
  { kind: "git", label: "저장소 변화 (새 커밋·브랜치)" },
  { kind: "files", label: "파일 변화 (저장 후 잠잠해지면)" },
  { kind: "poll", label: "명령 결과 변화" },
];

export const TRIGGER_HINTS: Record<Trigger["kind"], string> = {
  manual: "\"지금 실행\"을 누를 때만 돕니다.",
  interval: "앱을 닫아도 실행기가 돌며 간격을 지킵니다.",
  daily: "앱을 닫아도 실행기가 돌며 시간표를 지킵니다. PC가 꺼져 있던 동안 놓친 실행은 한 번만 따라잡습니다.",
  git: "30초마다 브랜치·커밋을 확인합니다. 임무를 만들 때의 커밋은 기준으로만 삼습니다.",
  files: "작업 폴더의 파일 저장을 지켜봅니다 (.git·node_modules·빌드 결과 제외). 저장이 몰리면 잠잠해진 뒤 한 번 돕니다.",
  poll: "읽기 명령 하나(|·&& 없이)를 정한 간격마다 돌려 출력이 바뀌면 돕니다. 시각처럼 매번 바뀌는 출력은 피하세요.",
};

/** 계기 종류를 바꿀 때의 기본값 */
export function defaultTrigger(kind: Trigger["kind"]): Trigger {
  switch (kind) {
    case "manual":
      return { kind };
    case "interval":
      return { kind, minutes: 60 };
    case "daily":
      return { kind, time: "09:00", weekdays: [1, 2, 3, 4, 5] };
    case "git":
      return { kind, cooldownMinutes: 15 };
    case "files":
      return { kind, quietSeconds: 60, cooldownMinutes: 15 };
    case "poll":
      return { kind, command: "gh run list --limit 5", minutes: 30 };
  }
}

export const STATUS_LABELS: Record<RunStatus, string> = {
  running: "실행 중",
  done: "완료",
  failed: "실패",
  timeout: "시간 초과",
  budget: "비용 상한",
};

export const REASON_LABELS: Record<RunRecord["reason"], string> = {
  manual: "지금 실행",
  schedule: "시간표",
  change: "변화 감지",
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
  if (paused) return duty.pendingChange ? `변화 감지됨 · 일시 정지됨` : "일시 정지됨";
  if (duty.pendingChange) {
    const when = duty.nextRunAt === undefined || duty.nextRunAt <= now ? "곧 실행" : `${relativeTime(duty.nextRunAt, now)} 실행`;
    return `${duty.pendingChange.cause} · ${when}`;
  }
  if (duty.trigger.kind === "git" || duty.trigger.kind === "files" || duty.trigger.kind === "poll") return "변화를 지켜보는 중";
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
