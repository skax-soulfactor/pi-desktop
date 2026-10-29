import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readInbox } from "@pi-desktop/mate-kit";
import { PI_CLI, setupRealPi, type RealPiFixture } from "../../host-agent/test/helpers/real-pi";
import { isAlive, readPid } from "../src/daemon";
import { matePaths, type MatePaths } from "../src/paths";
import { addRequest, listRuns, saveConfig, saveDuty } from "../src/store";
import type { Duty, RunRecord } from "../src/types";

/**
 * 빌드된 실행기(dist/mate-runner.mjs)로 실제 Pi를 mock LLM과 함께 돌리는 계약 테스트.
 * 권한 단계가 실제 Pi에서 지켜지는지, 제안이 인박스에 쌓이는지 확인한다.
 */
const execFileAsync = promisify(execFile);
const RUNNER = fileURLToPath(new URL("../dist/mate-runner.mjs", import.meta.url));

describe("실행기 + 실제 Pi", () => {
  let fixture: RealPiFixture;
  let paths: MatePaths;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    fixture = await setupRealPi();
    paths = matePaths(await mkdtemp(join(tmpdir(), "mate-home-")));
    await saveConfig(paths, { model: "mock/mock-model" });
    env = { ...process.env, ...fixture.piEnv, MATE_HOME: paths.home, PI_DESKTOP_PI_CLI: PI_CLI };
  });

  afterAll(async () => {
    await execFileAsync(process.execPath, [RUNNER, "stop"], { env }).catch(() => {});
    await fixture?.llm.close();
    if (paths) await rm(paths.home, { recursive: true, force: true }).catch(() => {});
  });

  async function addDuty(id: string, profile: Duty["profile"], prompt: string): Promise<void> {
    await saveDuty(paths, { id, name: `임무 ${id}`, cwd: fixture.projectDir, prompt, profile, trigger: { kind: "manual" } });
  }

  async function run(id: string): Promise<RunRecord> {
    const { stdout } = await execFileAsync(process.execPath, [RUNNER, "run", id], { env, timeout: 60_000 });
    return JSON.parse(stdout) as RunRecord;
  }

  it("propose: mate_propose가 인박스에 쌓이고, 같은 제안은 다시 쌓이지 않는다", async () => {
    await addDuty("ci", "propose", 'tool:mate_propose {"title":"CI 실패","summary":"unit 테스트가 깨졌습니다","severity":"warn"}');
    const first = await run("ci");
    expect(first).toMatchObject({ status: "done", proposals: 1, model: "mock/mock-model" });
    expect(first.sessionId).toBeTruthy();
    expect(await run("ci")).toMatchObject({ status: "done", proposals: 0 });
    const inbox = await readInbox(paths.inbox);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ dutyId: "ci", runId: first.id, title: "CI 실패", severity: "warn" });
    // 실행 세션은 Mate 홈에 남는다 (Pi 세션 목록을 채우지 않음)
    expect(existsSync(paths.sessions)).toBe(true);
  });

  it("observe: 마지막 답변을 결과로 인박스에 남긴다", async () => {
    await addDuty("brief", "observe", "오늘 요약");
    expect(await run("brief")).toMatchObject({ status: "done", summary: "echo: 오늘 요약", proposals: 1 });
    expect((await readInbox(paths.inbox)).find((i) => i.dutyId === "brief")).toMatchObject({ title: "임무 brief 결과", summary: "echo: 오늘 요약" });
  });

  it("허용 목록에 없는 bash와 선언되지 않은 쓰기 도구는 실행되지 않는다", async () => {
    await addDuty("rm", "propose", "bash:rm -f hello.txt");
    await run("rm");
    expect(await readFile(join(fixture.projectDir, "hello.txt"), "utf8")).toBe("안녕 Pi\n");

    await addDuty("write", "observe", 'tool:write {"path":"new.txt","content":"x"}');
    await run("write");
    expect(existsSync(join(fixture.projectDir, "new.txt"))).toBe(false);
  });

  it("상주 실행기가 지금 실행 요청을 처리하고, 두 번 띄워도 하나만 돈다", async () => {
    const start = async () => JSON.parse((await execFileAsync(process.execPath, [RUNNER, "start"], { env })).stdout) as { status: string; pid: number };
    const first = await start();
    expect(first.status).toBe("started");
    expect(await start()).toMatchObject({ status: "running", pid: first.pid });

    await addDuty("echo", "observe", "상주 확인");
    await addRequest(paths, "echo");
    let done: RunRecord | undefined;
    for (let i = 0; i < 300 && !done; i++) {
      await new Promise((r) => setTimeout(r, 100));
      done = (await listRuns(paths)).find((r) => r.dutyId === "echo" && r.status === "done");
    }
    // 실패하면 실행기 로그·기록·상태를 함께 보여 준다 (분리된 프로세스라 출력이 테스트에 남지 않음)
    const diagnostics = async () =>
      [
        await readFile(paths.log, "utf8").catch(() => "(로그 없음)"),
        JSON.stringify(await listRuns(paths), null, 1),
        await readFile(paths.state, "utf8").catch(() => "(상태 없음)"),
      ].join("\n---\n");
    expect(done, done ? "" : await diagnostics()).toMatchObject({ reason: "manual", summary: "echo: 상주 확인" });

    await execFileAsync(process.execPath, [RUNNER, "stop"], { env });
    for (let i = 0; i < 50 && isAlive(first.pid); i++) await new Promise((r) => setTimeout(r, 100));
    expect(isAlive(first.pid)).toBe(false);
    // pid 파일이 남아도 죽은 pid라 다음 start가 새로 띄운다
    expect(isAlive(await readPid(paths))).toBe(false);
  });
});
