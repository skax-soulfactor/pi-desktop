import { useEffect, useState } from "react";
import type { GithubCatalog, GithubPrompt, GithubSkill, ImportRecord } from "../shared/api";
import { errorText } from "./folder-browser";
import { formatSize } from "./resources-view";
import { importName, scriptFiles, splitFrontmatter, type PackageScope } from "./market-view";
import { Markdown } from "./markdown/Markdown";

/** 처음 보여 줄 저장소 (설계 §4.6 기본 예시) */
const SUGGESTED = ["anthropics/skills", "badlogic/pi-skills"];

type Selected = { kind: "skill"; skill: GithubSkill } | { kind: "prompt"; prompt: GithubPrompt };

interface Props {
  hostId: string;
  /** 프로젝트 범위의 기준 폴더. 없으면 사용자 범위만 */
  cwd?: string;
}

/**
 * Marketplace의 GitHub 탭 (설계 §4.6 "개별 스킬·프롬프트 가져오기").
 * 패키지 매니저를 거치지 않고 저장소의 스킬 폴더나 프롬프트 파일 하나만 가져온다.
 * 저장소는 커밋에 고정해 읽어, 본 내용과 가져오는 내용이 같다.
 */
export function GithubImport({ hostId, cwd }: Props) {
  const [spec, setSpec] = useState("");
  const [catalog, setCatalog] = useState<GithubCatalog | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [selected, setSelected] = useState<Selected | undefined>();
  const [imported, setImported] = useState<ImportRecord[]>([]);

  useEffect(() => {
    void window.piDesktop.listImports(hostId).then(setImported, () => setImported([]));
  }, [hostId]);

  async function browse(text: string) {
    setLoading(true);
    setError(undefined);
    setSelected(undefined);
    try {
      setCatalog(await window.piDesktop.githubBrowse(text));
      setSpec(text);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  /** 이 저장소에서 가져온 적이 있는 항목 (출처 경로로 맞춘다) */
  const importedFrom = (path: string) =>
    imported.find((r) => catalog && r.source.owner === catalog.owner && r.source.repo === catalog.repo && r.source.path === path);

  if (selected && catalog) {
    return (
      <ImportDetail
        hostId={hostId}
        {...(cwd ? { cwd } : {})}
        catalog={catalog}
        selected={selected}
        onBack={() => setSelected(undefined)}
        onImported={(record) => setImported((prev) => [...prev.filter((r) => r.target !== record.target), record])}
      />
    );
  }

  return (
    <div className="github-import">
      <form
        className="market-search"
        onSubmit={(e) => {
          e.preventDefault();
          if (spec.trim()) void browse(spec.trim());
        }}
      >
        <input
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          placeholder="GitHub 저장소 (owner/repo, owner/repo@브랜치, 또는 주소)"
          aria-label="GitHub 저장소"
          spellCheck={false}
        />
        <button type="submit" disabled={loading || !spec.trim()}>
          {loading ? "읽는 중…" : "열기"}
        </button>
      </form>
      <div className="market-suggest">
        {SUGGESTED.map((s) => (
          <button key={s} type="button" className="small" disabled={loading} onClick={() => void browse(s)}>
            {s}
          </button>
        ))}
      </div>
      {error && <div className="banner error">{error}</div>}
      {catalog && (
        <>
          <div className="muted market-total">
            {catalog.owner}/{catalog.repo} @ {catalog.sha.slice(0, 7)} · 스킬 {catalog.skills.length}개 · 프롬프트 {catalog.prompts.length}개
            {catalog.truncated ? " · 저장소가 커서 일부만 읽었습니다" : ""}
          </div>
          <ul className="resource-list market-list">
            {catalog.skills.map((s) => (
              <li key={s.dir} onClick={() => setSelected({ kind: "skill", skill: s })}>
                <div className="resource-main">
                  <span className="resource-name">
                    {s.name}
                    <span className="resource-badge">스킬</span>
                    {importedFrom(s.dir) && <span className="resource-badge on">가져옴</span>}
                  </span>
                  <span className="muted market-meta">
                    {s.dir} · 파일 {s.files.length}개 · {formatSize(s.size)}
                  </span>
                </div>
              </li>
            ))}
            {catalog.prompts.map((p) => (
              <li key={p.path} onClick={() => setSelected({ kind: "prompt", prompt: p })}>
                <div className="resource-main">
                  <span className="resource-name">
                    /{p.name}
                    <span className="resource-badge">프롬프트</span>
                    {importedFrom(p.path) && <span className="resource-badge on">가져옴</span>}
                  </span>
                  <span className="muted market-meta">{p.path}</span>
                </div>
              </li>
            ))}
            {catalog.skills.length + catalog.prompts.length === 0 && (
              <li className="muted">이 저장소에서 스킬(SKILL.md)이나 prompts/ 아래 프롬프트를 찾지 못했습니다.</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function ImportDetail({
  hostId,
  cwd,
  catalog,
  selected,
  onBack,
  onImported,
}: {
  hostId: string;
  cwd?: string;
  catalog: GithubCatalog;
  selected: Selected;
  onBack: () => void;
  onImported: (record: ImportRecord) => void;
}) {
  const sourcePath = selected.kind === "skill" ? selected.skill.dir : selected.prompt.path;
  const previewPath = selected.kind === "skill" ? (selected.skill.dir === "." ? "SKILL.md" : `${selected.skill.dir}/SKILL.md`) : selected.prompt.path;
  const [text, setText] = useState<string | undefined>();
  const [name, setName] = useState(importName(selected.kind === "skill" ? selected.skill.name : selected.prompt.name));
  const [scope, setScope] = useState<PackageScope>("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<ImportRecord | undefined>();
  const scripts = selected.kind === "skill" ? scriptFiles(selected.skill.files) : [];

  useEffect(() => {
    void window.piDesktop.githubText(catalog, previewPath).then(setText, (e: unknown) => setError(errorText(e)));
  }, [catalog, previewPath]);

  async function run() {
    setBusy(true);
    setError(undefined);
    try {
      const item =
        selected.kind === "skill"
          ? { kind: "skill" as const, dir: selected.skill.dir, files: selected.skill.files }
          : { kind: "prompt" as const, path: selected.prompt.path, sha: selected.prompt.sha, size: selected.prompt.size };
      const record = await window.piDesktop.githubImport({ hostId, cwd: cwd ?? "", scope, name: name.trim(), repo: catalog, item });
      setDone(record);
      onImported(record);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="market-detail">
      <div className="resource-editor-head">
        <span className="resource-name market-title">
          {selected.kind === "skill" ? selected.skill.name : `/${selected.prompt.name}`}
          <span className="resource-badge">{selected.kind === "skill" ? "스킬" : "프롬프트"}</span>
        </span>
        <span className="spacer" />
        <button type="button" onClick={onBack}>
          저장소 목록으로
        </button>
      </div>
      <p className="muted market-meta">
        <a href={`https://github.com/${catalog.owner}/${catalog.repo}/tree/${catalog.sha}/${sourcePath === "." ? "" : sourcePath}`} target="_blank" rel="noreferrer">
          {catalog.owner}/{catalog.repo}/{sourcePath === "." ? "" : sourcePath}
        </a>{" "}
        @ {catalog.sha.slice(0, 7)}
      </p>
      <div className={`banner ${scripts.length > 0 ? "warn" : "info"} market-security`}>
        {selected.kind === "skill" ? (
          <>
            <div>
              파일 {selected.skill.files.length}개 · {formatSize(selected.skill.size)}. 스킬은 모델이 따를 지침이며, 모델이 그 안의
              스크립트를 실행하게 할 수 있습니다.
            </div>
            {scripts.length > 0 && <div>실행 스크립트 {scripts.length}개: {scripts.slice(0, 8).join(", ")}{scripts.length > 8 ? " …" : ""}</div>}
          </>
        ) : (
          <div>프롬프트 파일 하나입니다. /{name || "이름"}으로 씁니다.</div>
        )}
      </div>
      {done ? (
        <div className="banner ok">
          가져왔습니다: {done.target}
          {"\n"}새로 여는 세션부터 쓰이고, 열려 있는 세션은 리소스 창의 "지금 세션에 반영"으로 반영합니다.
          {done.scope === "project" ? " 프로젝트 범위는 그 폴더를 신뢰해야 불러옵니다." : ""}
        </div>
      ) : (
        <div className="market-install">
          <label>
            이름
            <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} aria-label="가져올 이름" />
          </label>
          <label>
            범위
            <select value={scope} onChange={(e) => setScope(e.target.value as PackageScope)}>
              <option value="user">사용자 (모든 폴더)</option>
              <option value="project" disabled={!cwd}>
                이 프로젝트 (.pi/)
              </option>
            </select>
          </label>
          <button type="button" className="primary" disabled={busy || !name.trim()} onClick={() => void run()}>
            {busy ? "가져오는 중…" : "가져오기"}
          </button>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      <div className="market-readme">
        {text === undefined ? (
          <p className="muted">불러오는 중…</p>
        ) : (
          <>
            {splitFrontmatter(text).meta && <pre className="market-frontmatter">{splitFrontmatter(text).meta}</pre>}
            <Markdown text={splitFrontmatter(text).body} />
          </>
        )}
      </div>
    </div>
  );
}
