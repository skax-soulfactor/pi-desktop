// API 키 없이 앱을 실행해 보는 개발용 스크립트.
//
// 1. OpenAI 호환 mock LLM 서버를 고정 포트로 띄운다 (host-agent 테스트 fixture 재사용)
// 2. 저장소의 Pi devDependency와, mock 프로바이더만 등록한 격리된 Pi 설정을 쓰도록 환경 변수를 정한다
// 3. 데몬 홈도 저장소의 .dev/ 아래로 격리해 실제 ~/.pi-desktop, ~/.pi 와 섞이지 않게 한다
// 4. electron-vite dev를 실행한다
//
// 앱을 껐다 켜도 같은 데몬·세션에 다시 붙는지 확인할 수 있도록 경로와 포트를 고정한다.
// mock-llm.ts는 Node 22.18+/24의 TypeScript 타입 제거 기능으로 바로 import한다.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const devDir = join(repo, ".dev");
const piAgentDir = join(devDir, "pi-agent");
const port = Number(process.env.MOCK_LLM_PORT ?? 18911);

const { startMockLlm } = await import(
  new URL("../../../packages/host-agent/test/fixtures/mock-llm.ts", import.meta.url).href
);
const llm = await startMockLlm(port);

mkdirSync(piAgentDir, { recursive: true });
writeFileSync(
  join(piAgentDir, "models.json"),
  JSON.stringify(
    {
      providers: {
        mock: { baseUrl: llm.baseUrl, api: "openai-completions", apiKey: "mock", models: [{ id: "mock-model" }] },
      },
    },
    null,
    2,
  ),
);

const env = {
  ...process.env,
  PI_DESKTOP_HOME: join(devDir, "pi-desktop-home"),
  PI_DESKTOP_PI_CLI: join(repo, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"),
  PI_DESKTOP_PI_ARGS: "--provider mock --model mock-model",
  PI_CODING_AGENT_DIR: piAgentDir,
  PI_CODING_AGENT_SESSION_DIR: join(piAgentDir, "sessions"),
};

console.log(`[dev-mock] mock LLM: ${llm.baseUrl}`);
console.log(`[dev-mock] 프롬프트 예: "안녕" → echo, "read:package.json" → read 툴 호출`);

const child = spawn("npm", ["run", "dev"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
child.on("exit", async (code) => {
  await llm.close();
  process.exit(code ?? 0);
});
