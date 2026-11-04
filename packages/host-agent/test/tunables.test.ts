import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Methods } from "@pi-desktop/host-protocol";
import { definitionProblems, type TunableItem } from "@pi-desktop/agent-kit/tunables-core";
import { DAEMON_TUNABLES } from "../src/tunables";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

describe("데몬 정의", () => {
  it("정의가 스스로 맞다", () => {
    expect(definitionProblems(DAEMON_TUNABLES)).toEqual([]);
  });

  it("연결 약속과 보안 한도는 읽기 전용이다", () => {
    const locked = DAEMON_TUNABLES.filter((d) => d.locked).map((d) => d.id);
    expect(locked).toEqual(expect.arrayContaining(["daemon.helloWaitMs", "daemon.authLineMax", "daemon.importMaxFiles", "daemon.importMaxMb"]));
  });
});

describe("tunables.list·set (실제 데몬)", () => {
  let client: TestClient | undefined;
  afterEach(async () => {
    await client?.shutdownDaemon();
    client = undefined;
  });

  it("데몬 홈의 tunables.json에 바꾼 값만 쓰고, 잠긴 항목은 거부한다", async () => {
    const env = await isolatedEnv();
    client = new TestClient(env);
    const items = await client.request<TunableItem[]>(Methods.tunablesList);
    expect(items.find((i) => i.id === "daemon.sessionListLimit")).toMatchObject({ value: 200, overridden: false });
    const next = await client.request<TunableItem>(Methods.tunableSet, { id: "daemon.sessionListLimit", value: 500 });
    expect(next).toMatchObject({ value: 500, overridden: true });
    expect(JSON.parse(readFileSync(join(env.PI_DESKTOP_HOME!, "tunables.json"), "utf8"))).toEqual({ "daemon.sessionListLimit": 500 });
    await expect(client.request(Methods.tunableSet, { id: "daemon.importMaxMb", value: 100 })).rejects.toThrow("바꿀 수 없는");
    await expect(client.request(Methods.tunableSet, { id: "daemon.sessionListLimit", value: 1 })).rejects.toThrow("이상");
    await client.request(Methods.tunableSet, { id: "daemon.sessionListLimit", value: null });
    expect(JSON.parse(readFileSync(join(env.PI_DESKTOP_HOME!, "tunables.json"), "utf8"))).toEqual({});
  });
});
