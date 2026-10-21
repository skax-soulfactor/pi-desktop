import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResourceDiagnosticInfo, ResourceFile, ResourceItem, ResourcesView } from "@pi-desktop/host-protocol/messages";
import { errorText } from "./folder-browser";
import { ResourceEditor } from "./ResourceEditor";
import {
  creatableKind,
  diagnosticsByPath,
  formatSize,
  isEditable,
  RESOURCE_TABS,
  shortPath,
  sourceLabel,
  tabCount,
  type ResourceTab,
} from "./resources-view";

interface Props {
  hostId: string;
  hostLabel: string;
  /** 리소스를 찾을 작업 폴더 */
  cwd: string;
  /** 탐색기에서 위치를 볼 수 있는 호스트(로컬·WSL)면 준다 */
  onReveal?: (path: string) => void;
  /** 보고 있는 세션에 리소스를 다시 불러온다. 이 폴더의 세션을 보고 있고 입력 권한이 있을 때만 준다 */
  onReload?: () => Promise<void>;
  onClose: () => void;
}

/**
 * 리소스 창 (설계 §4.2~4.5).
 * 이 작업 폴더에서 Pi가 실제로 불러오는 AGENTS.md·시스템 프롬프트·프롬프트·스킬·확장·패키지를 출처와 함께 보여 준다.
 * 확장은 코드를 실행하지 않고 경로만 찾은 목록이다.
 * 마크다운 리소스(AGENTS.md·프롬프트·스킬)는 열어 고치고, 새로 만들 수 있다. 패키지에 든 것은 고치지 않는다.
 */
export function ResourcesPanel({ hostId, hostLabel, cwd, onReveal, onReload, onClose }: Props) {
  const [view, setView] = useState<ResourcesView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<ResourceTab>("context");
  /** 편집 중인 파일. 있으면 목록 대신 편집기를 보여 준다 */
  const [editing, setEditing] = useState<ResourceFile | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setView(await window.piDesktop.listResources(hostId, cwd));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [hostId, cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 편집 중에는 Esc로 닫지 않는다 (고친 내용을 잃지 않게).
      if (e.key === "Escape" && !editing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  async function open(path: string) {
    try {
      setEditing(await window.piDesktop.readResource(hostId, cwd, path));
    } catch (e) {
      setError(errorText(e));
    }
  }

  const diagnostics = useMemo(() => diagnosticsByPath(view?.diagnostics ?? []), [view]);

  return (
    <div className="modal-backdrop" onMouseDown={() => !editing && onClose()}>
      <div className="modal resources" role="dialog" aria-label="리소스" onMouseDown={(e) => e.stopPropagation()}>
        <header className="pi-manager-head">
          <h2>리소스</h2>
          <span className="modal-badge">{hostLabel}</span>
          <span className="spacer" />
          <button type="button" disabled={loading} onClick={() => void load()}>
            {loading ? "읽는 중…" : "다시 읽기"}
          </button>
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="muted resources-cwd" title={cwd}>
          작업 폴더 {cwd}
        </div>
        <div className="segmented resources-tabs">
          {RESOURCE_TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
              {view ? ` ${tabCount(view, t.id)}` : ""}
            </button>
          ))}
        </div>
        {error && <div className="banner error">{error}</div>}
        {view && view.diagnostics.length > 0 && (
          <div className="banner warn">
            불러올 때 문제가 {view.diagnostics.length}건 있습니다 (이름 충돌 등). 해당 항목에 표시했습니다.
          </div>
        )}
        {view && editing && (
          <ResourceEditor
            hostId={hostId}
            cwd={cwd}
            file={editing}
            label={shortPath(editing.path, view)}
            onSaved={() => void load()}
            {...(onReload ? { onReload } : {})}
            onClose={() => setEditing(undefined)}
          />
        )}
        {view && !editing && creatableKind(tab) && (
          <NewResourceForm
            kind={creatableKind(tab)!}
            onCreate={async (scope, name) => {
              const file = await window.piDesktop.createResource(hostId, cwd, creatableKind(tab)!, scope, name);
              await load();
              setEditing(file);
            }}
          />
        )}
        {view && !editing && (
          <div className="resources-body">
            {tab === "context" && <ContextList view={view} onReveal={onReveal} onEdit={(p) => void open(p)} />}
            {tab === "prompts" && (
              <ItemList
                view={view}
                items={view.prompts}
                diagnostics={diagnostics}
                empty="프롬프트가 없습니다. ~/.pi/agent/prompts/ 또는 .pi/prompts/에 .md 파일을 두면 /이름으로 씁니다."
                title={(p) => `/${p.name}${p.argumentHint ? ` ${p.argumentHint}` : ""}`}
                onReveal={onReveal}
                onEdit={(p) => void open(p)}
              />
            )}
            {tab === "skills" && (
              <ItemList
                view={view}
                items={view.skills}
                diagnostics={diagnostics}
                empty="스킬이 없습니다. ~/.pi/agent/skills/<이름>/SKILL.md 또는 .pi/skills/에 두면 불러옵니다."
                title={(s) => s.name}
                note={(s) => (s.disableModelInvocation ? `/skill:${s.name} 명령으로만 씀` : undefined)}
                onReveal={onReveal}
                onEdit={(p) => void open(p)}
              />
            )}
            {tab === "extensions" && (
              <ItemList
                view={view}
                items={view.extensions}
                diagnostics={diagnostics}
                empty="확장이 없습니다."
                title={(x) => x.name}
                onReveal={onReveal}
              />
            )}
            {tab === "packages" && <PackageList view={view} />}
          </div>
        )}
      </div>
    </div>
  );
}

function ContextList({
  view,
  onReveal,
  onEdit,
}: {
  view: ResourcesView;
  onReveal: ((path: string) => void) | undefined;
  onEdit: (path: string) => void;
}) {
  const rows: Array<{ label: string; path: string; detail: string }> = [
    ...view.contextFiles.map((f) => ({
      label: f.scope === "user" ? "AGENTS.md (사용자)" : "AGENTS.md (프로젝트)",
      path: f.path,
      detail: formatSize(f.bytes),
    })),
    ...(view.systemPrompt ? [{ label: "SYSTEM.md (기본 시스템 프롬프트 대체)", path: view.systemPrompt, detail: "" }] : []),
    ...view.appendSystemPrompt.map((path) => ({ label: "APPEND_SYSTEM.md (시스템 프롬프트 뒤에 덧붙임)", path, detail: "" })),
  ];
  if (rows.length === 0) {
    return <p className="muted">시스템 프롬프트에 들어가는 AGENTS.md가 없습니다.</p>;
  }
  return (
    <>
      <p className="muted">시스템 프롬프트에 위에서부터 차례로 들어갑니다.</p>
      <ul className="resource-list">
        {rows.map((r) => (
          <li key={r.path}>
            <div className="resource-main">
              <span className="resource-name">{r.label}</span>
              <span className="muted resource-path" title={r.path}>
                {shortPath(r.path, view)}
              </span>
            </div>
            {r.detail && <span className="muted">{r.detail}</span>}
            {isEditable({ path: r.path }) && (
              <button type="button" className="small" onClick={() => onEdit(r.path)}>
                편집
              </button>
            )}
            {onReveal && (
              <button type="button" className="small" onClick={() => onReveal(r.path)}>
                위치 열기
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function ItemList({
  view,
  items,
  diagnostics,
  empty,
  title,
  note,
  onReveal,
  onEdit,
}: {
  view: ResourcesView;
  items: ResourceItem[];
  diagnostics: Map<string, ResourceDiagnosticInfo[]>;
  empty: string;
  title: (item: ResourceItem) => string;
  note?: (item: ResourceItem) => string | undefined;
  onReveal: ((path: string) => void) | undefined;
  /** 없으면 고치지 않는 목록 (확장) */
  onEdit?: (path: string) => void;
}) {
  if (items.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="resource-list">
      {items.map((item) => {
        const problems = diagnostics.get(item.path) ?? [];
        const extra = note?.(item);
        return (
          <li key={item.path} className={item.enabled ? "" : "disabled"}>
            <div className="resource-main">
              <span className="resource-name">
                {title(item)}
                <span className="resource-badge">{sourceLabel(item)}</span>
                {!item.enabled && <span className="resource-badge off">꺼짐</span>}
                {extra && <span className="resource-badge">{extra}</span>}
              </span>
              {item.description && <span className="resource-desc">{item.description}</span>}
              <span className="muted resource-path" title={item.path}>
                {shortPath(item.path, view)}
              </span>
              {problems.map((d, i) => (
                <span key={i} className={`resource-problem ${d.type}`}>
                  {d.message}
                </span>
              ))}
            </div>
            {onEdit && isEditable(item) && (
              <button type="button" className="small" onClick={() => onEdit(item.path)}>
                편집
              </button>
            )}
            {onReveal && !item.path.startsWith("builtin:") && (
              <button type="button" className="small" onClick={() => onReveal(item.path)}>
                위치 열기
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PackageList({ view }: { view: ResourcesView }) {
  if (view.packages.length === 0) {
    return <p className="muted">설정에 적힌 패키지가 없습니다. pi install로 설치한 패키지가 여기에 나옵니다.</p>;
  }
  return (
    <ul className="resource-list">
      {view.packages.map((p) => (
        <li key={`${p.scope}:${p.source}`}>
          <div className="resource-main">
            <span className="resource-name">
              {p.source}
              <span className="resource-badge">{p.scope === "user" ? "사용자" : "프로젝트"}</span>
              {p.filtered && <span className="resource-badge">일부만 사용</span>}
              {!p.installedPath && <span className="resource-badge off">설치 안 됨</span>}
            </span>
            {p.installedPath && (
              <span className="muted resource-path" title={p.installedPath}>
                {shortPath(p.installedPath, view)}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

const KIND_LABEL = { prompt: "프롬프트", skill: "스킬", agents: "AGENTS.md" } as const;

/** 새 프롬프트·스킬·AGENTS.md 만들기. 만들면 바로 편집기로 연다 */
function NewResourceForm({
  kind,
  onCreate,
}: {
  kind: "prompt" | "skill" | "agents";
  onCreate: (scope: "user" | "project", name: string) => Promise<void>;
}) {
  const [scope, setScope] = useState<"user" | "project">("project");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      await onCreate(scope, name.trim());
      setName("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="resource-new"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <span className="muted">새 {KIND_LABEL[kind]}</span>
      <select value={scope} onChange={(e) => setScope(e.target.value as "user" | "project")} aria-label="범위">
        <option value="project">{kind === "agents" ? "이 작업 폴더" : "프로젝트 (.pi/)"}</option>
        <option value="user">사용자 (데이터 폴더)</option>
      </select>
      {kind !== "agents" && (
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (소문자·숫자·하이픈)" aria-label="이름" spellCheck={false} />
      )}
      <button type="submit" disabled={busy || (kind !== "agents" && !name.trim())}>
        만들기
      </button>
      {error && <span className="resource-problem error">{error}</span>}
    </form>
  );
}
