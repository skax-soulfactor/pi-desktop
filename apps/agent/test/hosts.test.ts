import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectKit, deployKit, remoteExtensionEntries, unpackScript, type KitBundle } from "../src/main/hosts";

const repo = resolve(__dirname, "../../..");
const kitDir = join(repo, "packages/agent-kit");
const isolationDir = join(repo, "packages/pi-isolation");

/** 이 PC의 sh로 원격 셸을 흉내 낸다 (sh -c <스크립트>, 표준 입력) */
function localRun(script: string, input?: Buffer): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn("sh", ["-c", script], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("exit", (code) => (code === 0 ? done(out) : fail(new Error(err))));
    child.stdin.end(input);
  });
}

describe("원격 호스트에 kit 올리기", () => {
  it("agent-kit·pi-isolation의 설치본 범위만 모으고, 내용이 같으면 해시도 같다", async () => {
    const a = await collectKit(kitDir, isolationDir);
    const b = await collectKit(kitDir, isolationDir);
    expect(a.hash).toBe(b.hash);
    const rels = a.files.map((f) => f.rel);
    expect(rels).toContain("agent-kit/package.json");
    expect(rels).toContain("agent-kit/extensions/permissions/index.ts");
    expect(rels).toContain("pi-isolation/extensions/mcp.ts");
    expect(rels.some((r) => r.includes("/test/") || r.includes("node_modules"))).toBe(false);
  });

  it("원격 확장 경로는 로컬 package.json의 목록을 그 호스트 경로로 바꾼다", async () => {
    const entries = await remoteExtensionEntries(kitDir, "/home/u/.pi-desktop-agent/kits/h/agent-kit");
    expect(entries[0]).toBe("/home/u/.pi-desktop-agent/kits/h/agent-kit/extensions/agent-core/index.ts");
    expect(entries.every((e) => e.startsWith("/home/u/"))).toBe(true);
  });

  it.skipIf(process.platform === "win32")("올린 kit은 원본과 같고, 이미 있으면 다시 올리지 않는다", async () => {
    const home = mkdtempSync(join(tmpdir(), "agent-kit-remote-"));
    const bundle: KitBundle = {
      hash: "abc123",
      files: [
        { rel: "agent-kit/package.json", data: Buffer.from('{"name":"x"}') },
        { rel: "agent-kit/extensions/a b/index.ts", data: Buffer.from("export default 1;\n// '따옴표' \"와\" $HOME\n") },
        { rel: "pi-isolation/src/big.ts", data: Buffer.alloc(5000, 0x41) },
      ],
    };
    expect(unpackScript(`${home}/kits/abc123`, bundle)).toContain("PI_KIT_EOF");
    const calls: string[] = [];
    const run = (script: string, input?: Buffer) => (calls.push(script), localRun(script, input));
    const base = await deployKit(run, home, bundle);
    expect(base).toBe(`${home}/kits/abc123`);
    for (const file of bundle.files) expect(readFileSync(join(base, file.rel))).toEqual(file.data);
    expect(existsSync(join(base, ".complete"))).toBe(true);
    const uploads = calls.length;
    await deployKit(run, home, bundle);
    // 두 번째는 확인만 한다
    expect(calls.length).toBe(uploads + 1);
  });
});
