import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Methods, Notifications, type FilesChangedNotification } from "@pi-desktop/host-protocol";
import { changedPaths, snapshot, watchTree } from "../src/tree-watcher";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

function extensionTree() {
  const base = mkdtempSync(join(tmpdir(), "pi-tree-"));
  mkdirSync(join(base, "ext", "lib"), { recursive: true });
  mkdirSync(join(base, "ext", "node_modules", "dep"), { recursive: true });
  writeFileSync(join(base, "ext", "index.ts"), "export default () => {};\n");
  writeFileSync(join(base, "ext", "lib", "a.ts"), "export {};\n");
  writeFileSync(join(base, "ext", "node_modules", "dep", "index.js"), "1\n");
  writeFileSync(join(base, "solo.ts"), "1\n");
  return base;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("snapshot·changedPaths", () => {
  it("폴더 아래를 모두 보되 node_modules는 건너뛰고, 없는 뿌리는 비어 있다", async () => {
    const base = extensionTree();
    const snap = await snapshot([join(base, "ext"), join(base, "solo.ts"), join(base, "nope")]);
    expect([...snap.keys()].map((p) => p.slice(base.length + 1).replace(/\\/g, "/")).sort()).toEqual(["ext/index.ts", "ext/lib/a.ts", "solo.ts"]);
  });

  it("생기거나 바뀌거나 사라진 파일을 가린다", () => {
    const before = new Map([
      ["a", "1:1"],
      ["b", "1:1"],
    ]);
    const after = new Map([
      ["a", "2:1"],
      ["c", "1:1"],
    ]);
    expect(changedPaths(before, after)).toEqual(["a", "b", "c"]);
    expect(changedPaths(before, new Map(before))).toEqual([]);
  });
});

describe("watchTree", () => {
  it("저장하면 바뀐 파일을 알리고, 멈춘 뒤에는 알리지 않는다", async () => {
    const base = extensionTree();
    const seen: string[][] = [];
    const stop = watchTree([join(base, "ext")], (paths) => seen.push(paths), 50);
    await wait(150);
    writeFileSync(join(base, "ext", "lib", "a.ts"), "export const x = 1;\n");
    writeFileSync(join(base, "ext", "node_modules", "dep", "index.js"), "2\n");
    await wait(250);
    expect(seen.flat().map((p) => p.slice(base.length + 1).replace(/\\/g, "/"))).toEqual(["ext/lib/a.ts"]);
    stop();
    rmSync(join(base, "ext", "index.ts"));
    await wait(200);
    expect(seen).toHaveLength(1);
  });
});

describe("데몬 files.watchTree", () => {
  let client: TestClient | undefined;
  afterEach(async () => {
    await client?.shutdownDaemon();
    client = undefined;
  });

  it("감시한 폴더의 파일이 바뀌면 files.changed로 알린다", async () => {
    const base = extensionTree();
    client = new TestClient(await isolatedEnv());
    const changes: FilesChangedNotification[] = [];
    client.onNotification(Notifications.filesChanged, (p) => changes.push(p as FilesChangedNotification));
    await client.request(Methods.filesWatchTree, { watchId: "w1", roots: [join(base, "ext")] });
    await wait(1500);
    writeFileSync(join(base, "ext", "index.ts"), "export default () => { /* changed */ };\n");
    for (let i = 0; i < 30 && changes.length === 0; i += 1) await wait(200);
    expect(changes[0]).toMatchObject({ watchId: "w1" });
    expect(changes[0]!.paths.map((p) => p.replace(/\\/g, "/"))).toEqual([join(base, "ext", "index.ts").replace(/\\/g, "/")]);
    await client.request(Methods.filesUnwatchTree, { watchId: "w1" });
    await expect(client.request(Methods.filesWatchTree, { watchId: "w2" })).rejects.toThrow("roots");
  });
});
