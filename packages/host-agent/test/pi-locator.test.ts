import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ErrorCodes } from "@pi-desktop/host-protocol";
import { locatePi, PI_PACKAGE_NAME } from "../src/pi-locator";

/** 가짜 Pi 패키지 디렉터리를 만든다. */
async function fakePi(root: string, version: string): Promise<{ packageDir: string; cliPath: string }> {
  const packageDir = join(root, "node_modules", ...PI_PACKAGE_NAME.split("/"));
  await mkdir(join(packageDir, "dist", "bundle"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: PI_PACKAGE_NAME, version, bin: { pi: "dist/bundle/cli.js" } }),
  );
  const cliPath = join(packageDir, "dist", "bundle", "cli.js");
  await writeFile(cliPath, "");
  return { packageDir, cliPath };
}

describe("locatePi", () => {
  let root: string;
  let pi: { packageDir: string; cliPath: string };
  const noGlobal = async () => undefined;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pi-locator-"));
    pi = await fakePi(root, "1.3.0");
  });

  it("파라미터로 준 cli 경로를 가장 먼저 쓰고, package.json에서 버전을 읽는다", async () => {
    const found = await locatePi({ piCliPath: pi.cliPath, env: {}, npmGlobalRoot: noGlobal });
    expect(found).toMatchObject({ cliPath: pi.cliPath, packageDir: pi.packageDir, version: "1.3.0", source: "param" });
  });

  it("PI_DESKTOP_PI_CLI 환경 변수를 쓴다", async () => {
    const found = await locatePi({ env: { PI_DESKTOP_PI_CLI: pi.cliPath }, npmGlobalRoot: noGlobal });
    expect(found.source).toBe("env");
  });

  it("npm 전역 설치 위치에서 bin 경로를 찾는다", async () => {
    const found = await locatePi({ env: {}, npmGlobalRoot: async () => join(root, "node_modules") });
    expect(found).toMatchObject({ cliPath: pi.cliPath, version: "1.3.0", source: "npm-global" });
  });

  it("존재하지 않는 경로는 건너뛰고 다음 후보를 시도한다", async () => {
    const found = await locatePi({
      piCliPath: join(root, "missing.js"),
      env: {},
      npmGlobalRoot: async () => join(root, "node_modules"),
    });
    expect(found.source).toBe("npm-global");
  });

  it("아무 데서도 못 찾으면 PiNotFound 오류와 시도한 경로를 준다", async () => {
    await expect(
      locatePi({ piCliPath: join(root, "missing.js"), env: {}, npmGlobalRoot: noGlobal }),
    ).rejects.toMatchObject({ code: ErrorCodes.PiNotFound, data: { tried: [join(root, "missing.js")] } });
  });
});
