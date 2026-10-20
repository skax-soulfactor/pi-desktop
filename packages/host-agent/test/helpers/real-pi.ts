import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockLlm, type MockLlm } from "../fixtures/mock-llm";

/**
 * 실제 Pi(devDependency)를 mock LLM과 함께 돌리는 계약 테스트의 공용 준비 코드.
 */

// Pi의 exports는 import 조건만 열어 두어 require.resolve를 쓸 수 없다. node_modules를 위로 올라가며 찾는다.
export const PI_PACKAGE_DIR = findPackageDir("@earendil-works/pi-coding-agent");
export const PI_CLI = join(PI_PACKAGE_DIR, "dist", "bundle", "cli.js");

/** mock 프로바이더로 Pi를 실행하는 인자 */
export const MOCK_MODEL_ARGS = ["--provider", "mock", "--model", "mock-model"];

function findPackageDir(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "node_modules", ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${name}을 찾을 수 없습니다. npm install을 먼저 실행하세요`);
    dir = parent;
  }
}

export interface RealPiFixture {
  llm: MockLlm;
  /** 테스트용 작업 폴더 (hello.txt 포함) */
  projectDir: string;
  /** Pi 프로세스에 넘길 환경 변수. 사용자 ~/.pi를 건드리지 않도록 설정 디렉터리를 격리한다 */
  piEnv: Record<string, string>;
}

export async function setupRealPi(): Promise<RealPiFixture> {
  const llm = await startMockLlm();
  const piAgentDir = await mkdtemp(join(tmpdir(), "pi-agent-dir-"));
  await writeFile(
    join(piAgentDir, "models.json"),
    JSON.stringify({
      providers: {
        mock: { baseUrl: llm.baseUrl, api: "openai-completions", apiKey: "mock", models: [{ id: "mock-model" }] },
      },
    }),
  );
  const projectDir = await mkdtemp(join(tmpdir(), "pi-project-"));
  await writeFile(join(projectDir, "hello.txt"), "안녕 Pi\n");
  return {
    llm,
    projectDir,
    piEnv: { PI_CODING_AGENT_DIR: piAgentDir, PI_CODING_AGENT_SESSION_DIR: join(piAgentDir, "sessions") },
  };
}
