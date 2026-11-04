import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { definitionProblems } from "@pi-desktop/agent-kit/tunables-core";
import { APP_TUNABLES } from "../../src/shared/app-tunables";
import { initAppTunables } from "../../src/main/app-tunables";
import { newNotes } from "../../src/main/notifier";
import type { Overview } from "../../src/shared/api";

describe("Mate 앱 수치", () => {
  it("정의가 스스로 맞다", () => {
    expect(definitionProblems(APP_TUNABLES)).toEqual([]);
    expect(APP_TUNABLES.every((d) => d.id.startsWith("app."))).toBe(true);
  });

  it("바꾼 알림 수로 묶는다", () => {
    const overview = (runs: unknown[]) => ({ chat: { lines: [], pending: 0 }, runs, inbox: [] }) as unknown as Overview;
    const run = (id: string) => ({ id, dutyId: "d", dutyName: "임무", status: "done", startedAt: 1, summary: id });
    const base = newNotes(undefined, overview([])).state;
    const runs = [run("r1"), run("r2"), run("r3")];
    expect(newNotes(base, overview(runs)).notes).toHaveLength(3);
    const store = initAppTunables(mkdtempSync(join(tmpdir(), "mate-app-")));
    store.set("app.notifyMaxNotes", 2);
    const { notes } = newNotes(base, overview(runs));
    expect(notes).toHaveLength(2);
    expect(notes[1]!.title).toBe("Mate 알림 2건 더");
  });
});
