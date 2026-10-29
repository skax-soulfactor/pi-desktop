import { describe, expect, it } from "vitest";
import type { DutyView, InboxView } from "../src/shared/api";
import { costLabel, nextRunLabel, relativeTime, splitInbox, triggerLabel } from "../src/renderer/mate-view";

const at = (d: number, h: number, mi = 0) => new Date(2026, 9, d, h, mi).getTime();

describe("mate-view", () => {
  it("실행 시점을 사람이 읽는 말로", () => {
    expect(triggerLabel({ kind: "manual" })).toBe("직접 실행");
    expect(triggerLabel({ kind: "interval", minutes: 120 })).toBe("2시간마다");
    expect(triggerLabel({ kind: "interval", minutes: 45 })).toBe("45분마다");
    expect(triggerLabel({ kind: "daily", time: "09:00", weekdays: [1, 3, 5] })).toBe("월·수·금 09:00");
    expect(triggerLabel({ kind: "daily", time: "09:00" })).toBe("매일 09:00");
  });

  it("상대 시각", () => {
    const now = at(29, 12);
    expect(relativeTime(now - 30_000, now)).toBe("방금");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5분 전");
    expect(relativeTime(now + 10 * 60_000, now)).toBe("10분 뒤");
    expect(relativeTime(at(28, 9), now)).toBe("어제 09:00");
    expect(relativeTime(at(30, 9), now)).toBe("내일 09:00");
    expect(relativeTime(at(20, 9, 5), now)).toBe("10/20 09:05");
  });

  it("다음 실행 안내는 꺼짐·대기·일시 정지를 먼저 보인다", () => {
    const now = at(29, 12);
    const duty = {
      id: "d", name: "d", enabled: true, cwd: ".", prompt: "p", profile: "observe", createdAt: 0,
      trigger: { kind: "daily", time: "09:00" }, nextRunAt: at(30, 9), queued: false,
    } as DutyView;
    expect(nextRunLabel(duty, now, false)).toBe("다음: 내일 09:00");
    expect(nextRunLabel(duty, now, true)).toBe("일시 정지됨");
    expect(nextRunLabel({ ...duty, queued: true }, now, true)).toBe("실행 대기 중");
    expect(nextRunLabel({ ...duty, enabled: false }, now, false)).toBe("꺼짐");
  });

  it("새 제안과 처리한 제안을 나누고 비용을 짧게", () => {
    const item = (id: string, status?: InboxView["status"]) => ({ id, status }) as InboxView;
    const { fresh, handled } = splitInbox([item("a"), item("b", "accepted"), item("c", "dismissed")]);
    expect(fresh.map((i) => i.id)).toEqual(["a"]);
    expect(handled.map((i) => i.id)).toEqual(["b", "c"]);
    expect(costLabel(0.0031)).toBe("$0.0031");
    expect(costLabel(0.42)).toBe("$0.42");
    expect(costLabel(0)).toBe("");
  });
});
