import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { PackageCreateParams, PackageCreateResult } from "@pi-desktop/host-protocol";
import { extensionSource } from "./extension-templates";
import { resourceDeleteTarget } from "./import-manage";
import { resourceNameProblem } from "./resource-files";

/**
 * 새 Pi 패키지 만들기 (리소스 창 패키지 탭, docs/packages.md의 관례 폴더 구조).
 *
 * <packagesRoot>/<이름>/
 *   package.json   keywords: pi-package (Marketplace 검색 대상), Pi가 넣어 주는 패키지는 peerDependencies "*"
 *   README.md      설치·게시 방법
 *   extensions/    고른 템플릿의 확장
 *   prompts/ skills/ extensions/  고른 기존 리소스의 복사본
 * pi-ai·pi-coding-agent 등은 Pi가 넣어 주므로 로컬 경로로 설치해도(`pi install <폴더>`) 따로 설치할 것이 없다.
 */

const KIND_DIR = { prompt: "prompts", skill: "skills", extension: "extensions" } as const;

/** package.json 내용 */
export function packageJson(name: string, description: string, hasExtension: boolean): string {
  const json: Record<string, unknown> = {
    name,
    version: "0.1.0",
    description: description || `${name} Pi 패키지`,
    keywords: ["pi-package"],
    license: "MIT",
    type: "module",
    files: ["extensions", "skills", "prompts", "themes", "README.md"],
  };
  // 확장이 import하는 Pi 제공 패키지는 직접 넣지 않고 peerDependencies "*"로 둔다 (docs/packages.md).
  if (hasExtension) {
    json.peerDependencies = { "@earendil-works/pi-coding-agent": "*", "@earendil-works/pi-ai": "*" };
  }
  return `${JSON.stringify(json, null, 2)}\n`;
}

export function packageReadme(name: string, description: string, dir: string): string {
  return `# ${name}

${description || `${name} Pi 패키지`}

## 이 PC에서 쓰기

\`\`\`bash
pi install ${dir}
\`\`\`

Pi Desktop의 리소스 창 → 패키지 탭에서 "이 호스트에 설치"를 눌러도 됩니다. 로컬 경로로 설치하면 복사하지 않고 이 폴더를 그대로 읽으므로, 고친 내용이 바로 쓰입니다(열려 있는 세션은 "지금 세션에 반영").

## 다른 사람과 나누기

- git 저장소에 올리면 \`pi install git:github.com/<계정>/${name}\`으로 설치할 수 있습니다.
- npm에 올리면(\`npm publish\`) \`pi install npm:${name}\`으로 설치하고, keywords의 \`pi-package\` 덕분에 Pi 패키지 목록과 Pi Desktop Marketplace에서 찾을 수 있습니다.

## 구성

- \`extensions/\`: 확장 (TypeScript, 빌드 없이 Pi가 바로 읽음)
- \`skills/\`: 스킬 (\`<이름>/SKILL.md\`)
- \`prompts/\`: 프롬프트 템플릿 (\`/이름\`)
`;
}

/** 패키지를 만든다. 같은 이름의 폴더가 있으면 거절한다 */
export async function createPackage(params: PackageCreateParams, agentDir: string, packagesRoot: string): Promise<PackageCreateResult> {
  const problem = resourceNameProblem(params.name);
  if (problem) throw new Error(problem);
  const dir = join(packagesRoot, params.name);
  if (await stat(dir).catch(() => undefined)) throw new Error(`이미 있는 폴더입니다: ${dir}`);
  // 복사할 리소스를 먼저 모두 확인한다 (중간에 실패해 반쯤 만든 패키지가 남지 않게).
  const copies = params.include.map((item) => {
    const from = resourceDeleteTarget(item.path, item.kind, agentDir);
    return { from, to: join(KIND_DIR[item.kind], basename(from)) };
  });
  const seen = new Set<string>();
  for (const c of copies) {
    if (seen.has(c.to)) throw new Error(`같은 이름의 리소스를 두 개 넣을 수 없습니다: ${c.to}`);
    seen.add(c.to);
  }
  const extension = params.extensionTemplate ? join("extensions", `${params.name}.ts`) : undefined;
  if (extension && seen.has(extension)) throw new Error(`같은 이름의 확장이 이미 들어 있습니다: ${extension}`);
  const description = params.description?.trim() ?? "";
  const hasExtension = Boolean(extension) || copies.some((c) => c.to.startsWith("extensions"));

  const files: string[] = [];
  await mkdir(dir, { recursive: true });
  const write = async (rel: string, content: string) => {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), content, "utf8");
    files.push(rel.split("\\").join("/"));
  };
  await write("package.json", packageJson(params.name, description, hasExtension));
  await write("README.md", packageReadme(params.name, description, dir));
  await write(".gitignore", "node_modules/\n");
  if (extension && params.extensionTemplate) await write(extension, extensionSource(params.name, params.extensionTemplate));
  for (const c of copies) {
    await mkdir(join(dir, c.to, ".."), { recursive: true });
    await cp(c.from, join(dir, c.to), { recursive: true, errorOnExist: true, force: false });
    files.push(c.to.split("\\").join("/"));
  }
  return { dir, files };
}
