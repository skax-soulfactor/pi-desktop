import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConfiguredPackageInfo,
  ResourceDiagnosticInfo,
  ResourceFile,
  ResourceItem,
  ResourcesView,
} from "@pi-desktop/host-protocol/messages";
import type { HostDescriptor } from "../shared/api";
import { copyNote } from "./copy-view";
import { errorText } from "./folder-browser";
import { ResourceEditor } from "./ResourceEditor";
import { projectBadge, projectResourcesSkipped, trustStatusText } from "./project-trust";
import { isPinned, removeArgs, updateArgs } from "./market-view";
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

/** 다른 호스트에서 복사해 온 항목에 붙일 안내 (경로 → 글) */
type CopiedNotes = Map<string, { text: string; title: string }>;

interface Props {
  hostId: string;
  hostLabel: string;
  /** 복사해 온 출처의 호스트 이름을 보일 때 쓴다 */
  hosts?: HostDescriptor[];
  /** 리소스를 찾을 작업 폴더 */
  cwd: string;
  /** 탐색기에서 위치를 볼 수 있는 호스트(로컬·WSL)면 준다 */
  onReveal?: (path: string) => void;
  /** 보고 있는 세션에 리소스를 다시 불러온다. 이 폴더의 세션을 보고 있고 입력 권한이 있을 때만 준다 */
  onReload?: () => Promise<void>;
  /** 그 호스트의 pi를 내장 터미널에서 이 인자로 실행한다 (패키지 업데이트·제거). projectCwd가 있으면 그 폴더에서 */
  onRunPi?: (args: string[], title: string, projectCwd?: string) => void;
  /** Marketplace를 연다 */
  onOpenMarketplace?: () => void;
  /** 스킬·프롬프트·확장을 다른 호스트로 복사한다 (다른 호스트가 있을 때만) */
  onCopy?: (item: ResourceItem, kind: "skill" | "prompt" | "extension") => void;
  /** 사용자 범위 AGENTS.md·SYSTEM.md·APPEND_SYSTEM.md를 다른 호스트로 복사한다 */
  onCopyContext?: (path: string) => void;
  /** 패키지를 다른 호스트에 같은 소스로 설치한다 */
  onCopyPackage?: (pkg: ConfiguredPackageInfo) => void;
  onClose: () => void;
}

/**
 * 리소스 창 (설계 §4.2~4.5).
 * 이 작업 폴더에서 Pi가 실제로 불러오는 AGENTS.md·시스템 프롬프트·프롬프트·스킬·확장·패키지를 출처와 함께 보여 준다.
 * 확장은 코드를 실행하지 않고 경로만 찾은 목록이다.
 * 마크다운 리소스(AGENTS.md·프롬프트·스킬)는 열어 고치고, 새로 만들 수 있다. 패키지에 든 것은 고치지 않는다.
 */
export function ResourcesPanel({
  hostId,
  hostLabel,
  hosts = [],
  cwd,
  onReveal,
  onReload,
  onRunPi,
  onOpenMarketplace,
  onCopy,
  onCopyContext,
  onCopyPackage,
  onClose,
}: Props) {
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

  // 다른 호스트에서 복사해 온 기록과 그 뒤 바뀐 것 (설계 §5.9 "출처 기록"). 원본 호스트를 읽느라 늦을 수 있어 따로 채운다.
  const [copied, setCopied] = useState<CopiedNotes>(new Map());
  useEffect(() => {
    let alive = true;
    void window.piDesktop.copyStatus(hostId).then(
      (entries) => {
        if (!alive) return;
        const label = (id: string) => hosts.find((h) => h.id === id)?.label ?? id;
        setCopied(
          new Map(
            entries.map(({ record, status }) => [
              record.toPath,
              {
                text: copyNote(status, label(record.fromHostId)),
                title: `${label(record.fromHostId)}의 ${record.fromPath}에서 ${new Date(record.copiedAt).toLocaleString()}에 복사${status.error ? `
원본을 확인하지 못함: ${status.error}` : ""}`,
              },
            ]),
          ),
        );
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [hostId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 편집 중에는 Esc로 닫지 않는다 (고친 내용을 잃지 않게).
      if (e.key === "Escape" && !editing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  /** 신뢰 결정을 바꾼다. 이미 열린 세션은 다시 열어야 반영된다 (Pi는 시작할 때 정한다) */
  async function changeTrust(decision: boolean | null) {
    try {
      await window.piDesktop.setTrust(hostId, cwd, decision);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

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
        {view && trustStatusText(view.trust) && !editing && (
          <div className={`banner ${projectResourcesSkipped(view.trust) ? "warn" : "info"}`}>
            <span>{trustStatusText(view.trust)}</span>
            {view.trust.saved !== true && (
              <button type="button" className="small" onClick={() => void changeTrust(true)}>
                이 폴더 신뢰
              </button>
            )}
            {view.trust.saved !== null && (
              <button type="button" className="small" onClick={() => void changeTrust(null)}>
                저장된 결정 지우기
              </button>
            )}
          </div>
        )}
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
            {tab === "context" && (
              <ContextList view={view} copied={copied} onReveal={onReveal} onEdit={(p) => void open(p)} {...(onCopyContext ? { onCopy: onCopyContext } : {})} />
            )}
            {tab === "prompts" && (
              <ItemList
                view={view}
                copied={copied}
                items={view.prompts}
                diagnostics={diagnostics}
                empty="프롬프트가 없습니다. ~/.pi/agent/prompts/ 또는 .pi/prompts/에 .md 파일을 두면 /이름으로 씁니다."
                title={(p) => `/${p.name}${p.argumentHint ? ` ${p.argumentHint}` : ""}`}
                onReveal={onReveal}
                onEdit={(p) => void open(p)}
                {...(onCopy ? { onCopy: (item: ResourceItem) => onCopy(item, "prompt") } : {})}
              />
            )}
            {tab === "skills" && (
              <ItemList
                view={view}
                copied={copied}
                items={view.skills}
                diagnostics={diagnostics}
                empty="스킬이 없습니다. ~/.pi/agent/skills/<이름>/SKILL.md 또는 .pi/skills/에 두면 불러옵니다."
                title={(s) => s.name}
                note={(s) => (s.disableModelInvocation ? `/skill:${s.name} 명령으로만 씀` : undefined)}
                onReveal={onReveal}
                onEdit={(p) => void open(p)}
                {...(onCopy ? { onCopy: (item: ResourceItem) => onCopy(item, "skill") } : {})}
              />
            )}
            {tab === "extensions" && (
              <ItemList
                view={view}
                copied={copied}
                items={view.extensions}
                diagnostics={diagnostics}
                empty="확장이 없습니다."
                title={(x) => x.name}
                onReveal={onReveal}
                {...(onCopy ? { onCopy: (item: ResourceItem) => onCopy(item, "extension") } : {})}
              />
            )}
            {tab === "packages" && (
              <PackageList
                view={view}
                {...(onRunPi
                  ? {
                      onRun: (args: string[], title: string, projectCwd?: string) => {
                        onRunPi(args, title, projectCwd);
                        onClose();
                      },
                    }
                  : {})}
                {...(onOpenMarketplace ? { onOpenMarketplace } : {})}
                {...(onCopyPackage ? { onCopy: onCopyPackage } : {})}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ContextList({
  view,
  copied,
  onReveal,
  onEdit,
  onCopy,
}: {
  view: ResourcesView;
  copied: CopiedNotes;
  onReveal: ((path: string) => void) | undefined;
  onEdit: (path: string) => void;
  /** 사용자 범위(데이터 폴더) 파일만 다른 호스트로 복사한다 */
  onCopy?: (path: string) => void;
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
              <span className="resource-name">
                {r.label}
                <CopiedBadge note={copied.get(r.path)} />
              </span>
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
            {onCopy && shortPath(r.path, view).startsWith("~agent/") && (
              <button type="button" className="small" onClick={() => onCopy(r.path)} title="다른 호스트의 데이터 폴더로 복사합니다">
                다른 호스트로
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
  copied,
  items,
  diagnostics,
  empty,
  title,
  note,
  onReveal,
  onEdit,
  onCopy,
}: {
  view: ResourcesView;
  copied: CopiedNotes;
  items: ResourceItem[];
  diagnostics: Map<string, ResourceDiagnosticInfo[]>;
  empty: string;
  title: (item: ResourceItem) => string;
  note?: (item: ResourceItem) => string | undefined;
  onReveal: ((path: string) => void) | undefined;
  /** 없으면 고치지 않는 목록 (확장) */
  onEdit?: (path: string) => void;
  /** 다른 호스트로 복사 */
  onCopy?: (item: ResourceItem) => void;
}) {
  const badge = projectBadge(view.trust);
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
                {badge && item.scope === "project" && <span className="resource-badge off">{badge}</span>}
                {extra && <span className="resource-badge">{extra}</span>}
                <CopiedBadge note={copied.get(item.path)} />
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
            {onCopy && item.enabled && /.(md|ts|js|mts|cts|mjs|cjs)$/i.test(item.path) && (
              <button type="button" className="small" onClick={() => onCopy(item)} title="다른 호스트(WSL·SSH)로 복사합니다">
                다른 호스트로
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

function PackageList({
  view,
  onRun,
  onOpenMarketplace,
  onCopy,
}: {
  view: ResourcesView;
  onRun?: (args: string[], title: string, projectCwd?: string) => void;
  onOpenMarketplace?: () => void;
  /** 다른 호스트에 같은 소스로 설치 */
  onCopy?: (pkg: ConfiguredPackageInfo) => void;
}) {
  /** 제거를 한 번 더 누르라고 묻는 중인 패키지 */
  const [confirmRemove, setConfirmRemove] = useState<string | undefined>();
  const find = onOpenMarketplace && (
    <button type="button" className="small" onClick={onOpenMarketplace}>
      Marketplace에서 패키지 찾기…
    </button>
  );
  if (view.packages.length === 0) {
    return (
      <>
        <p className="muted">설정에 적힌 패키지가 없습니다. pi install로 설치한 패키지가 여기에 나옵니다.</p>
        {find}
      </>
    );
  }
  return (
    <>
    {find}
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
          {onCopy && (
            <button type="button" className="small" onClick={() => onCopy(p)} title="다른 호스트에서 같은 소스로 pi install을 실행합니다">
              다른 호스트에 설치
            </button>
          )}
          {onRun && (
            <>
              <button
                type="button"
                className="small"
                disabled={isPinned(p.source)}
                title={isPinned(p.source) ? "버전이 고정된 패키지는 pi update로 바뀌지 않습니다" : "pi update로 갱신합니다"}
                onClick={() => onRun(updateArgs(p.source), `업데이트: ${p.source}`, p.scope === "project" ? view.cwd : undefined)}
              >
                업데이트
              </button>
              {confirmRemove === p.source ? (
                <button
                  type="button"
                  className="small danger"
                  onClick={() => onRun(removeArgs(p.source, p.scope), `제거: ${p.source}`, p.scope === "project" ? view.cwd : undefined)}
                >
                  정말 제거
                </button>
              ) : (
                <button type="button" className="small" onClick={() => setConfirmRemove(p.source)}>
                  제거
                </button>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
    </>
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

function CopiedBadge({ note }: { note: { text: string; title: string } | undefined }) {
  if (!note) return null;
  return (
    <span className={`resource-badge copied${note.text.includes(" · ") ? " changed" : ""}`} title={note.title}>
      {note.text}
    </span>
  );
}
