// Pi Desktop 웹 빌드 (설계 §5.10). Electron 빌드(electron-vite)와 같은 소스로 웹 서버와 화면을 만든다.
//
//   node scripts/build-web.mjs   → out/web/  (바로 실행: node out/web/server.mjs)
//
// out/web/
//   server.mjs              웹 서버(src/server). ws까지 한 파일로 묶는다. node-pty만 밖에 둔다: 네이티브 모듈
//   public/                 화면 (vite.web.config.ts)
//   host-agent/             Host Agent 번들과 package.json (데스크톱 앱의 extraResources와 같다)
//   package.json            버전
//
// 세 앱을 담은 웹 묶음(pi-web.tar.gz)은 루트 scripts/build-web.mjs가 이 결과를 바탕으로 만든다.
// electron-builder.yml은 out/web을 설치 파일에서 뺀다.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

const at = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const app = at("..");
// 설치본의 extraResources(electron-builder.yml)와 같은 곳에서 가져온다
const agent = at("../../../packages/host-agent");
const out = join(app, "out", "web");
const version = process.env.PI_WEB_VERSION ?? JSON.parse(readFileSync(join(app, "package.json"), "utf8")).version;

rmSync(out, { recursive: true, force: true });

await viteBuild({ configFile: join(app, "vite.web.config.ts"), logLevel: "warn" });
copyFileSync(join(app, "build", "icon.png"), join(out, "public", "icon.png"));

await esbuild({
  entryPoints: [join(app, "src", "server", "index.ts")],
  outfile: join(out, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // ws의 선택 의존성(bufferutil 등)은 없어도 된다. node-pty는 설치 스크립트가 --terminal일 때 따로 깐다.
  external: ["node-pty", "bufferutil", "utf-8-validate"],
  // ws·web-push는 CommonJS라 묶은 ESM 안에서 require가 필요하다.
  banner: { js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);' },
  logLevel: "warning",
});

// Host Agent: 데몬과 연결기. 먼저 packages/host-agent에서 npm run build로 만들어 둔다.
mkdirSync(join(out, "host-agent"), { recursive: true });
copyFileSync(join(agent, "dist", "host-agent.mjs"), join(out, "host-agent", "host-agent.mjs"));
copyFileSync(join(agent, "package.json"), join(out, "host-agent", "package.json"));

writeFileSync(join(out, "package.json"), `${JSON.stringify({ name: "pi-web", version, private: true, type: "module" }, null, 2)}\n`);
console.log(`[desktop build-web] ${out} (버전 ${version})`);
