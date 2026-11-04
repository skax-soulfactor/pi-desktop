import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { definitionProblems } from "@pi-desktop/agent-kit/tunables-core";
import { createAppTunables } from "@pi-desktop/tunables-ui/app-tunables";
import { APP_TUNABLES } from "../../src/shared/app-tunables";
import { appNum, initAppTunables } from "../../src/main/app-tunables";
import { retryDelay } from "../../src/main/reconnect-policy";
import { DAEMON_TUNABLES } from "../../../../packages/host-agent/src/tunables";

describe("Pi Desktop 앱 수치", () => {
  it("정의가 스스로 맞고, 데몬 항목과 id가 겹치지 않는다", () => {
    expect(definitionProblems(APP_TUNABLES)).toEqual([]);
    const daemonIds = new Set(DAEMON_TUNABLES.map((d) => d.id));
    expect(APP_TUNABLES.filter((d) => daemonIds.has(d.id))).toEqual([]);
    expect(APP_TUNABLES.every((d) => d.id.startsWith("app."))).toBe(true);
    expect(DAEMON_TUNABLES.every((d) => d.id.startsWith("daemon."))).toBe(true);
  });

  it("메인은 데이터 폴더의 app-tunables.json을 쓸 때마다 읽는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "app-tunables-"));
    expect(appNum("app.reconnectMaxRetries")).toBe(6);
    const store = initAppTunables(dir);
    store.set("app.reconnectMaxRetries", 2);
    expect(retryDelay(1)).toBe(500);
    expect(retryDelay(2)).toBeUndefined();
    writeFileSync(join(dir, "app-tunables.json"), JSON.stringify({ "app.reconnectFirstDelayMs": 1000 }));
    expect(retryDelay(1)).toBe(1000);
    initAppTunables(mkdtempSync(join(tmpdir(), "app-tunables-")));
  });

  it("화면은 받아 둔 값을 쓰고, 되돌리면 기본값으로", () => {
    const t = createAppTunables(APP_TUNABLES);
    expect(t.num("app.maxAttachments")).toBe(10);
    t.apply([{ id: "app.maxAttachments", value: 3, overridden: true }]);
    expect(t.num("app.maxAttachments")).toBe(3);
    t.apply([{ id: "app.maxAttachments", value: 10, overridden: false }]);
    expect(t.num("app.maxAttachments")).toBe(10);
  });
});
