// 배포물에 함께 넣는 제3자 고지(THIRD_PARTY_NOTICES.txt)를 package-lock.json과 node_modules로 만든다.
//
//   node scripts/third-party-notices.mjs   → out/legal/THIRD_PARTY_NOTICES.txt (설치 파일이 싣는다)
//
// 화면과 웹 서버는 번들로 묶여 패키지의 라이선스 파일이 사라지므로, 고지를 따로 싣는다.
// 묶이지 않는 빌드 도구만 BUILD_ONLY에서 뺀다. 그래서 새 의존성은 따로 적지 않아도 고지에 들어간다.
// 세 앱과 웹 묶음이 같은 파일을 쓰므로, 어느 한 배포물에만 들어가는 패키지도 함께 적힌다.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUILD_ONLY = new Set([
  "@earendil-works/pi-coding-agent", // 테스트에만 쓴다. 앱은 사용자가 설치한 pi를 실행한다
  "@vitejs/plugin-react",
  "electron", // 실행 파일에 자체 라이선스 파일이 함께 들어간다
  "electron-builder",
  "electron-vite",
  "esbuild",
  "typescript",
  "vite",
  "vitest",
]);

/** 저장소의 package-lock.json에서 배포물에 들어가는 패키지의 고지문을 만든다. 라이선스 표기가 없는 패키지가 있으면 멈춘다 */
export function generateNotices(root) {
  const packages = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages;
  const entries = [...shippedPaths(packages)].sort().map((path) => describe(root, path, packages[path]));

  const undeclared = entries.filter((entry) => !entry.license);
  if (undeclared.length > 0) {
    throw new Error(`라이선스 표기가 없는 패키지가 있습니다: ${undeclared.map((entry) => entry.id).join(", ")}`);
  }

  const header = [
    "제3자 고지 (Third-Party Notices)",
    "",
    "이 소프트웨어의 설치 파일과 웹 묶음에는 아래 오픈 소스 패키지가 수정 없이 포함될 수 있습니다.",
    "각 패키지의 소스는 적힌 저장소에서 받을 수 있습니다.",
    "Electron·Chromium의 고지는 설치 폴더의 LICENSE.electron.txt와 LICENSES.chromium.html에 있습니다.",
    "",
  ];
  const body = entries.flatMap((entry) => [
    "-".repeat(78),
    entry.id,
    `License: ${entry.license}`,
    ...(entry.repository ? [`Source: ${entry.repository}`] : []),
    "",
    ...(entry.texts.length > 0 ? entry.texts : ["(패키지에 라이선스 전문 파일이 없습니다. 위 License 표기를 따릅니다.)"]),
    "",
  ]);
  return { text: `${[...header, ...body].join("\n")}\n`, count: entries.length, withoutText: entries.filter((entry) => entry.texts.length === 0).map((entry) => entry.id) };
}

/** 워크스페이스가 직접 쓰는 패키지에서 시작해, 그 패키지들이 의존하는 것까지 모은다 */
function shippedPaths(packages) {
  const seen = new Set();
  const stack = [];
  for (const [path, entry] of Object.entries(packages)) {
    if (!/^(apps|packages)\//.test(path) || path.includes("node_modules/")) continue;
    for (const name of Object.keys({ ...entry.dependencies, ...entry.devDependencies })) {
      if (BUILD_ONLY.has(name) || name.startsWith("@types/") || name.startsWith("@pi-desktop/")) continue;
      stack.push(resolveFrom(packages, path, name));
    }
  }
  while (stack.length > 0) {
    const path = stack.pop();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const entry = packages[path];
    for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) stack.push(resolveFrom(packages, path, name));
  }
  return seen;
}

/** Node의 모듈 찾기처럼 가까운 node_modules부터 위로 올라가며 찾는다 */
function resolveFrom(packages, from, name) {
  let dir = from;
  for (;;) {
    const candidate = `${dir ? `${dir}/` : ""}node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!dir) return undefined;
    const nested = dir.lastIndexOf("/node_modules/");
    dir = nested >= 0 ? dir.slice(0, nested) : "";
  }
}

function describe(root, path, entry) {
  const dir = join(root, path);
  const manifest = existsSync(join(dir, "package.json")) ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) : {};
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  return {
    id: `${name}@${entry.version}`,
    license: licenseName(entry.license ?? manifest.license ?? manifest.licenses),
    repository: repository?.replace(/^git\+/, ""),
    texts: legalTexts(dir),
  };
}

/** 옛 패키지는 license가 객체나 배열이다 */
function licenseName(value) {
  if (Array.isArray(value)) return value.map(licenseName).join(" OR ");
  return typeof value === "object" && value !== null ? value.type : value;
}

/** 패키지 최상위의 LICENSE·COPYING·NOTICE 파일 내용. 줄바꿈은 OS와 관계없이 LF로 맞춘다 */
function legalTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((file) => file.isFile() && /^(licen[cs]e|copying|notice)/i.test(file.name))
    .map((file) => file.name)
    .sort()
    .map((file) => readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n").trim());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const out = join(root, "out", "legal", "THIRD_PARTY_NOTICES.txt");
  const { text, count, withoutText } = generateNotices(root);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`[third-party-notices] ${out} (패키지 ${count}개, 전문 파일 없음 ${withoutText.length}개${withoutText.length ? `: ${withoutText.join(", ")}` : ""})`);
}
