// Pi Desktop Mate 웹 빌드 (설계 DESIGN.md §5.11). Electron 빌드(electron-vite)와 같은 소스로 웹 서버와 화면을 만든다.
//
//   node scripts/build-web.mjs   → out/web/  (바로 실행: node out/web/server.mjs)
//
// out/web/
//   server.mjs        웹 서버(src/server) + Mate main (electron은 web-shell 대체 모듈)
//   public/           화면 (vite.web.config.ts)
//   resources/        mate-runner, mate-kit, pi-isolation (Mate 설치본의 extraResources와 같다)
//   package.json      버전
//
// 웹 묶음(루트 scripts/build-web.mjs)이 이 결과를 mate/로 넣는다.
// electron-builder.yml은 out/web을 설치 파일에서 뺀다.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import { bundleServer, copyPackage, shellStubs } from "@pi-desktop/web-shell/build";

const at = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const app = at("..");
// 설치본의 extraResources(electron-builder.yml)와 같은 곳에서 가져온다
const packages = at("../../../packages");
const out = join(app, "out", "web");
const version = process.env.PI_WEB_VERSION ?? JSON.parse(readFileSync(join(app, "package.json"), "utf8")).version;

rmSync(out, { recursive: true, force: true });

await viteBuild({ configFile: join(app, "vite.web.config.ts"), logLevel: "warn" });
copyFileSync(join(app, "build", "icon.png"), join(out, "public", "icon.png"));

await bundleServer({
  entry: join(app, "src", "server", "index.ts"),
  outfile: join(out, "server.mjs"),
  replace: [
    { module: join(app, "src", "main", "autostart"), with: shellStubs.autostart },
  ],
});

// Mate 설치본의 extraResources (electron-builder.yml). pi-isolation은 mate-kit 옆에 있어야 실행기가 찾는다
const resources = join(out, "resources");
mkdirSync(join(resources, "mate-runner"), { recursive: true });
copyFileSync(join(packages, "mate-runner", "dist", "mate-runner.mjs"), join(resources, "mate-runner", "mate-runner.mjs"));
copyPackage(join(packages, "mate-kit"), join(resources, "mate-kit"), ["package.json", "extensions", "src"]);
copyPackage(join(packages, "pi-isolation"), join(resources, "pi-isolation"), ["package.json", "extensions", "src"]);

writeFileSync(join(out, "package.json"), `${JSON.stringify({ name: "pi-mate-web", version, private: true, type: "module" }, null, 2)}\n`);
console.log(`[mate build-web] ${out} (버전 ${version})`);
