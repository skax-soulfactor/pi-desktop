import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Methods, Notifications, type PiUpdateOutputNotification, type PiUpdateResult } from "@pi-desktop/host-protocol";
import { isUpdateTarget, runPiUpdate } from "../src/pi-update";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

/**
 * 업데이트를 흉내 내는 가짜 Pi 패키지. `update --self`를 받으면 package.json 버전을 1.3.0으로 올린다.
 * 받은 인자와 PI_MANAGED_INSTALL_ROOT를 출력한다.
 */
function fakePiPackage(): { dir: string; cliPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "fake-pi-update-"));
  mkdirSync(join(dir, "dist"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.2.0", bin: { pi: "dist/cli.js" } }),
  );
  const cliPath = join(dir, "dist", "cli.js");
  writeFileSync(
    cliPath,
    `const fs = require("fs"); const path = require("path");
const args = process.argv.slice(2);
console.log("args:" + args.join(" "));
console.log("root:" + (process.env.PI_MANAGED_INSTALL_ROOT || "-"));
if (args.includes("--self")) {
  const pkg = path.join(__dirname, "..", "package.json");
  const json = JSON.parse(fs.readFileSync(pkg, "utf8"));
  json.version = "1.3.0";
  fs.writeFileSync(pkg, JSON.stringify(json));
  console.error("updated to 1.3.0");
}
`,
  );
  // 같은 폴더에 package.json이 type:module이 아니어도 .js가 CommonJS로 돌도록 둔다.
  return { dir, cliPath };
}

describe("runPiUpdate", () => {
  it("대상별 인자로 실행하고 Pi 위치의 환경 변수를 넘기며 출력을 흘린다", async () => {
    const { dir, cliPath } = fakePiPackage();
    const chunks: string[] = [];
    const run = await runPiUpdate(
      { cliPath, packageDir: dir, version: "1.2.0", source: "managed", env: { PI_MANAGED_INSTALL_ROOT: "/managed" } },
      "models",
      { force: true, onOutput: (c) => chunks.push(c) },
    );
    expect(run.exitCode).toBe(0);
    // models에는 --force를 붙이지 않는다
    expect(run.output).toContain("args:update --models\n");
    expect(run.output).toContain("root:/managed");
    expect(chunks.join("")).toBe(run.output);
  });

  it("대상은 정해진 것만 받는다", () => {
    expect(["self", "extensions", "all", "models"].every(isUpdateTarget)).toBe(true);
    expect(isUpdateTarget("--version")).toBe(false);
    expect(isUpdateTarget("constructor")).toBe(false);
  });

  it("너무 오래 걸리면 멈춘다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fake-pi-slow-"));
    const cliPath = join(dir, "cli.js");
    writeFileSync(cliPath, "setTimeout(() => {}, 60000);");
    const run = await runPiUpdate({ cliPath, packageDir: dir, version: "x", source: "env" }, "self", { timeoutMs: 300 });
    expect(run.timedOut).toBe(true);
  });
});

describe("데몬 pi.update", () => {
  it("실행 전·후 버전을 돌려주고, 진행 출력을 요청한 앱에 알린다", async () => {
    const { dir, cliPath } = fakePiPackage();
    const client = new TestClient(await isolatedEnv({ PI_DESKTOP_PI_CLI: cliPath }));
    const outputs: PiUpdateOutputNotification[] = [];
    client.onNotification(Notifications.piUpdateOutput, (p) => outputs.push(p as PiUpdateOutputNotification));
    try {
      const result = await client.request<PiUpdateResult>(Methods.piUpdate, { target: "self", taskId: "t1" });
      expect(result).toMatchObject({ exitCode: 0, versionBefore: "1.2.0", versionAfter: "1.3.0", timedOut: false });
      expect(result.output).toContain("args:update --self");
      expect(outputs.every((o) => o.taskId === "t1")).toBe(true);
      expect(outputs.map((o) => o.chunk).join("")).toContain("updated to 1.3.0");
      expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version).toBe("1.3.0");

      await expect(client.request(Methods.piUpdate, { target: "rm -rf", taskId: "t2" })).rejects.toMatchObject({ code: -32602 });
    } finally {
      await client.shutdownDaemon();
    }
  });
});
