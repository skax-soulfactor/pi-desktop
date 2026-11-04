// 작업 공간 화면을 Pi Desktop 빌드에 넣는다 (설계 DESIGN-ONE-APP.md).
// 플러그인 앱의 화면 빌드(apps/<id>/out/renderer)를 out/renderer/<id>/로 복사한다. main/workspaces.ts가 iframe으로 연다.
// 플러그인 화면은 먼저 빌드되어 있어야 한다 (package.json의 build·dist가 순서대로 부른다).
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const id of ["agent"]) {
  const from = join(desktop, "..", id, "out", "renderer");
  const to = join(desktop, "out", "renderer", id);
  if (!existsSync(join(from, "index.html"))) throw new Error(`${id} 화면 빌드가 없습니다: ${from} (npm run build -w @pi-desktop/${id})`);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`작업 공간 화면 ${id} → ${to}`);
}
