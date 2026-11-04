// API 키 없이 앱을 실행해 보는 개발용 스크립트.
//
// 1. OpenAI 호환 mock LLM 서버를 고정 포트로 띄운다 (host-agent 테스트 fixture 재사용)
// 2. 저장소의 Pi devDependency와, mock 프로바이더만 등록한 격리된 Pi 설정을 쓰도록 환경 변수를 정한다
// 3. 데몬 홈도 저장소의 .dev/ 아래로 격리해 실제 ~/.pi-desktop, ~/.pi 와 섞이지 않게 한다
// 4. electron-vite dev를 실행한다
//
// --demo-ext: Pi 패키지에 들어 있는 rpc-demo 확장을 함께 불러온다 (확장 UI 다이얼로그 확인용).
// --web: 앱 대신 웹 서버(pi-web)를 묶어서 띄운다. 브라우저로 출력된 주소를 연다 (데이터는 .dev/pi-web).
// --workspaces: Agent·Mate 작업 공간까지 함께 본다. 작업 공간 화면은 빌드한 파일(iframe)이라 개발 서버 대신
//   빌드해서 띄운다 (화면을 고치면 다시 실행). Agent·Mate의 dev:mock이 이것을 부른다. 웹이면 세 서버를 한 프로세스로.
//
// 앱을 껐다 켜도 같은 데몬·세션에 다시 붙는지 확인할 수 있도록 경로와 포트를 고정한다.
// mock-llm.ts는 Node 22.18+/24의 TypeScript 타입 제거 기능으로 바로 import한다.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const devDir = join(repo, ".dev");
const piAgentDir = join(devDir, "pi-agent");
const port = Number(process.env.MOCK_LLM_PORT ?? 18911);
const web = process.argv.includes("--web");
const withWorkspaces = process.argv.includes("--workspaces");
const demoExtension = process.argv.includes("--demo-ext")
  ? join(repo, "node_modules", "@earendil-works", "pi-coding-agent", "examples", "extensions", "rpc-demo.ts")
  : undefined;

const { startMockLlm } = await import(
  new URL("../../../packages/host-agent/test/fixtures/mock-llm.ts", import.meta.url).href
);
const llm = await startMockLlm(port);

mkdirSync(piAgentDir, { recursive: true });
writeFileSync(
  join(piAgentDir, "models.json"),
  JSON.stringify(
    {
      // 모델 선택기 확인용: 기본 모델 외에 추론 모델과, openrouter처럼 모델이 많은 프로바이더를 흉내 낸다.
      // 모두 같은 mock 서버로 간다.
      providers: {
        mock: {
          baseUrl: llm.baseUrl,
          api: "openai-completions",
          apiKey: "mock",
          models: [
            { id: "mock-model" },
            { id: "mock-reasoning", name: "Mock Reasoning", reasoning: true, contextWindow: 200000 },
            // 이미지 첨부 확인용 (나머지 모델은 이미지를 받지 않는다)
            { id: "mock-vision", name: "Mock Vision", input: ["text", "image"] },
          ],
        },
        "mock-router": {
          baseUrl: llm.baseUrl,
          api: "openai-completions",
          apiKey: "mock",
          models: Array.from({ length: 30 }, (_, i) => ({
            id: `vendor-${i % 5}/model-${i}`,
            name: `Vendor ${i % 5} Model ${i}`,
            contextWindow: 32000 * ((i % 4) + 1),
          })),
        },
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
  // 툴 카드를 모두 확인할 수 있게 기본(read·bash·edit·write)에 grep·find·ls도 켠다.
  PI_DESKTOP_PI_ARGS: [
    "--provider mock --model mock-model --tools read,bash,edit,write,grep,find,ls",
    demoExtension ? `-e ${demoExtension}` : "",
  ]
    .join(" ")
    .trim(),
  PI_CODING_AGENT_DIR: piAgentDir,
  PI_CODING_AGENT_SESSION_DIR: join(piAgentDir, "sessions"),
  // Agent·Mate 작업 공간의 홈도 .dev/ 아래로 (실제 ~/.pi-desktop-agent, ~/.pi-desktop-mate와 섞이지 않게)
  PI_DESKTOP_AGENT_DAEMON_HOME: join(devDir, "agent-home"),
  MATE_HOME: join(devDir, "mate-home"),
};

// Mate 처음 실행이면 기본 모델을 mock으로 (실제 기본값은 anthropic/claude-haiku-5-5)
mkdirSync(env.MATE_HOME, { recursive: true });
if (!existsSync(join(env.MATE_HOME, "config.json"))) {
  writeFileSync(join(env.MATE_HOME, "config.json"), JSON.stringify({ model: "mock/mock-model" }, null, 2));
}

console.log(`[dev-mock] mock LLM: ${llm.baseUrl}`);
console.log(`[dev-mock] 프롬프트 예: "안녕" → echo, "read:package.json" → read 툴 호출, "bash:<명령>" → bash 툴 호출`);
if (demoExtension) {
  console.log("[dev-mock] rpc-demo 확장 사용: /rpc-input, /rpc-editor, /rpc-prefill, \"bash:rm -rf ./x\"(위험 명령 확인)");
}

const appDir = fileURLToPath(new URL("..", import.meta.url));
const npm = (args, cwd = appDir) => {
  const built = spawnSync("npm", args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (built.status !== 0) process.exit(built.status ?? 1);
};
let child;
if (web && withWorkspaces) {
  // 웹, 세 작업 공간: 루트 묶음(out/pi-web)을 만들어 Pi Web 서버가 Agent·Mate 서버를 한 프로세스로 띄운다
  npm(["run", "build:web"], repo);
  child = spawn(process.execPath, [join(repo, "out", "pi-web", "server.mjs"), "--home", join(devDir, "pi-web", "data"), "--workspaces"], { env, stdio: "inherit" });
} else if (web) {
  npm(["run", "build:web"]);
  child = spawn(process.execPath, [join(appDir, "out", "web", "server.mjs"), "--home", join(devDir, "pi-web")], { env, stdio: "inherit" });
} else if (withWorkspaces) {
  // 작업 공간 화면은 빌드한 파일이라 빌드한 앱을 띄운다
  npm(["run", "build"]);
  const electron = (await import("electron")).default;
  child = spawn(electron, ["."], { cwd: appDir, env, stdio: "inherit" });
} else {
  child = spawn("npm", ["run", "dev"], { cwd: appDir, env, stdio: "inherit", shell: process.platform === "win32" });
}
child.on("exit", async (code) => {
  await llm.close();
  process.exit(code ?? 0);
});
