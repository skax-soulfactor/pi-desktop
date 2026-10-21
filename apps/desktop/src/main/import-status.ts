import type { GithubCatalog, ImportRecord, ImportStatus } from "../shared/api";

/**
 * 가져온 스킬·프롬프트의 상태 판단 (설계 §4.6). 순수 함수라 테스트한다.
 *
 * - 로컬: 가져올 때 기록한 파일별 git blob SHA와 지금 그 호스트의 SHA를 비교한다.
 * - 원본: 저장소의 최신 커밋에서 같은 경로의 파일 SHA와 비교한다.
 */

export function compareLocal(
  record: ImportRecord,
  inspected: { exists: boolean; files: Record<string, string> },
): Pick<ImportStatus, "local" | "localChanged"> {
  if (!inspected.exists) return { local: "missing", localChanged: [] };
  if (record.kind === "prompt") {
    // 프롬프트는 파일 하나라 이름이 아니라 값만 비교한다 (기록은 저장소 경로, 조사는 파일 이름).
    const [before] = Object.values(record.files);
    const [now] = Object.values(inspected.files);
    return before === now ? { local: "same", localChanged: [] } : { local: "modified", localChanged: [record.name] };
  }
  const changed = new Set<string>();
  for (const [path, sha] of Object.entries(record.files)) if (inspected.files[path] !== sha) changed.add(path);
  for (const path of Object.keys(inspected.files)) if (!(path in record.files)) changed.add(path);
  return changed.size === 0 ? { local: "same", localChanged: [] } : { local: "modified", localChanged: [...changed].sort() };
}

export function compareUpstream(record: ImportRecord, latest: GithubCatalog): Pick<ImportStatus, "upstream" | "upstreamSha" | "upstreamChanged"> {
  const upstreamSha = latest.sha;
  if (record.kind === "prompt") {
    const prompt = latest.prompts.find((p) => p.path === record.source.path);
    if (!prompt) return { upstream: "gone", upstreamSha, upstreamChanged: [] };
    const [before] = Object.values(record.files);
    return prompt.sha === before
      ? { upstream: "same", upstreamSha, upstreamChanged: [] }
      : { upstream: "changed", upstreamSha, upstreamChanged: [record.name] };
  }
  const skill = latest.skills.find((s) => s.dir === record.source.path);
  if (!skill) return { upstream: "gone", upstreamSha, upstreamChanged: [] };
  const next = Object.fromEntries(skill.files.map((f) => [f.path, f.sha]));
  const changed = new Set<string>();
  for (const [path, sha] of Object.entries(next)) if (record.files[path] !== sha) changed.add(path);
  for (const path of Object.keys(record.files)) if (!(path in next)) changed.add(path);
  return changed.size === 0
    ? { upstream: "same", upstreamSha, upstreamChanged: [] }
    : { upstream: "changed", upstreamSha, upstreamChanged: [...changed].sort() };
}

/**
 * 프로젝트 범위 항목의 작업 폴더: <폴더>/.pi/skills/<이름> 또는 <폴더>/.pi/prompts/<이름>.md.
 * 호스트 경로 형식(/, \)을 그대로 둔다.
 */
export function projectCwdOf(target: string): string {
  const parts = target.split(/([\\/])/);
  // [... , 폴더, sep, ".pi", sep, "skills", sep, 이름] → 뒤에서 세 조각(구분자 포함 6개)을 뗀다
  return parts.slice(0, -6).join("");
}
