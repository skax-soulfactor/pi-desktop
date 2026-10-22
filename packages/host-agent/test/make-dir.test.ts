import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Methods } from "@pi-desktop/host-protocol";
import { folderNameProblem, makeDirectory } from "../src/dir-list";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

describe("folderNameProblem", () => {
  it("쓸 수 없는 이름을 가린다", () => {
    expect(folderNameProblem("my-project")).toBeUndefined();
    expect(folderNameProblem("새 프로젝트")).toBeUndefined();
    expect(folderNameProblem("  ")).toContain("넣으세요");
    expect(folderNameProblem("..")).toContain("쓸 수 없는");
    expect(folderNameProblem("a/b")).toContain("쓸 수 없습니다");
    expect(folderNameProblem("a\\b")).toContain("쓸 수 없습니다");
    expect(folderNameProblem("a:b")).toContain("쓸 수 없습니다");
    expect(folderNameProblem("name.")).toContain("끝날 수 없습니다");
  });
});

describe("makeDirectory", () => {
  it("상위 폴더 아래에 만들고, 이미 있거나 상위가 없으면 거부한다", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-mkdir-"));
    const made = await makeDirectory(base, " new-one ", base);
    expect(made).toBe(join(base, "new-one"));
    expect(statSync(made).isDirectory()).toBe(true);
    await expect(makeDirectory(base, "new-one", base)).rejects.toThrow("이미 있습니다");
    await expect(makeDirectory(join(base, "nope"), "x", base)).rejects.toThrow("상위 폴더가 없습니다");
    // 상위가 비었으면 홈 기준
    expect(await makeDirectory("", "in-home", base)).toBe(join(base, "in-home"));
  });
});

describe("데몬 fs.makeDir", () => {
  let client: TestClient | undefined;
  afterEach(async () => {
    await client?.shutdownDaemon();
    client = undefined;
  });

  it("폴더를 만들고 경로를 돌려준다", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-mkdir-d-"));
    client = new TestClient(await isolatedEnv());
    const result = await client.request<{ path: string }>(Methods.fsMakeDir, { parent: base, name: "proj" });
    expect(existsSync(result.path)).toBe(true);
    await expect(client.request(Methods.fsMakeDir, { parent: base, name: "a/b" })).rejects.toThrow("쓸 수 없습니다");
  });
});
