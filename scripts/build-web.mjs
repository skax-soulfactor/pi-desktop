// 휴대폰 웹 묶음(pi-web)을 만든다 (설계 §5.10, §5.11). 세 앱의 웹 빌드를 한 묶음으로 모은다.
//
//   npm run build:web   → out/pi-web/  (바로 실행: node out/pi-web/server.mjs)
//   npm run dist:web    → 위에 더해 release/web/pi-web.tar.gz, install-termux.sh
//
// 먼저 packages/host-agent·mate-runner를 빌드해 둔다 (npm 스크립트가 한다).
//
// out/pi-web/
//   server.mjs, public/, host-agent/, package.json   Pi Desktop 웹 빌드 (apps/desktop, npm run build:web)
//   bin/pi-web                                      실행 명령 (scripts/web/pi-web.sh)
//   agent/                                          Pi Desktop Agent 웹 빌드 (apps/agent)
//   mate/                                           Pi Desktop Mate 웹 빌드 (apps/mate)
//
// 버전은 Pi Desktop(apps/desktop/package.json)을 따른다. 묶음은 Pi Desktop 릴리스(v*)에 함께 올라간다.
// 설치 스크립트는 릴리스가 올라가는 저장소에서 묶음을 받는다. 저장소는 GITHUB_REPOSITORY(Actions),
// 없으면 git origin 주소에서 읽는다.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const at = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const root = at("..");
const apps = join(root, "apps");
const out = join(root, "out", "pi-web");
const pack = process.argv.includes("--pack");
const version = JSON.parse(readFileSync(join(apps, "desktop", "package.json"), "utf8")).version;

/** 앱의 웹 빌드(scripts/build-web.mjs)를 돌리고 그 결과 폴더를 돌려준다. 버전은 묶음과 같게 한다 */
function buildApp(name) {
  const dir = join(apps, name);
  execFileSync(process.execPath, [join(dir, "scripts", "build-web.mjs")], { cwd: dir, stdio: "inherit", env: { ...process.env, PI_WEB_VERSION: version } });
  return join(dir, "out", "web");
}

rmSync(out, { recursive: true, force: true });
cpSync(buildApp("desktop"), out, { recursive: true });
for (const name of ["agent", "mate"]) cpSync(buildApp(name), join(out, name), { recursive: true });

mkdirSync(join(out, "bin"), { recursive: true });
copyFileSync(join(root, "scripts", "web", "pi-web.sh"), join(out, "bin", "pi-web"));
chmodSync(join(out, "bin", "pi-web"), 0o755);

console.log(`[build-web] ${out} (버전 ${version})`);

if (pack) {
  const release = join(root, "release", "web");
  rmSync(release, { recursive: true, force: true });
  mkdirSync(release, { recursive: true });
  // 압축 파일 안의 폴더 이름은 pi-web. 경로는 상대 경로로 준다 (GNU tar는 "C:"를 원격 호스트로 읽는다)
  execFileSync("tar", ["-czf", "release/web/pi-web.tar.gz", "-C", "out", "pi-web"], { cwd: root, stdio: "inherit" });

  const repo = process.env.GITHUB_REPOSITORY || originRepo();
  const installer = readFileSync(join(root, "scripts", "web", "install-termux.sh"), "utf8").replaceAll("__PI_WEB_REPO__", repo);
  writeFileSync(join(release, "install-termux.sh"), installer, { mode: 0o755 });
  console.log(`[build-web] ${release}/pi-web.tar.gz, install-termux.sh (저장소 ${repo})`);
}

/** git origin 주소에서 owner/repo를 읽는다 */
function originRepo() {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).trim();
    const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
    if (match) return match[1];
  } catch {
    // 아래 오류
  }
  throw new Error("릴리스 저장소를 알 수 없습니다. GITHUB_REPOSITORY=owner/repo로 알려 주세요.");
}
