import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConfiguredPackageInfo,
  ExtensionTemplate,
  MyPackageInfo,
  PackageCreateResult,
  ResourceDiagnosticInfo,
  ResourceFile,
  ResourceItem,
  ResourcesView,
} from "@pi-desktop/host-protocol/messages";
import type { HostDescriptor } from "../shared/api";
import { copyNote } from "./copy-view";
import { errorText } from "./folder-browser";
import { ResourceEditor } from "./ResourceEditor";
import { PackageFilterEditor } from "./PackageFilterEditor";
import { projectBadge, projectResourcesSkipped, trustStatusText } from "./project-trust";
import { isPinned, removeArgs, updateArgs } from "./market-view";
import {
  creatableKind,
  diagnosticsByPath,
  editablePackageFiles,
  EXTENSION_TEMPLATE_LABELS,
  formatSize,
  installedPackageFor,
  isDeletable,
  isEditable,
  joinPath,
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
  /** 방금 만든 패키지 (편집기를 열었다 돌아와도 설치 버튼이 남도록 여기에 둔다) */
  const [createdPackage, setCreatedPackage] = useState<CreatedPackage | undefined>();
  /** 방금 지운 리소스 안내 */
  const [deleted, setDeleted] = useState<string | undefined>();
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

  /** 리소스를 지운다 (데몬이 백업 폴더로 옮긴다). 열려 있는 세션은 "지금 세션에 반영"을 해야 빠진다 */
  async function remove(item: ResourceItem, kind: "prompt" | "skill" | "extension") {
    try {
      const { backup } = await window.piDesktop.deleteResource(hostId, item.path, kind);
      setDeleted(`${item.name}을(를) 지웠습니다. 백업: ${backup}. 열려 있는 세션에서 빼려면 세션을 새로고침하거나 "지금 세션에 반영"을 누르세요.`);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

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
        {deleted && !editing && <div className="banner ok">{deleted}</div>}
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
            onCreate={async (scope, name, template) => {
              const file = await window.piDesktop.createResource(hostId, cwd, creatableKind(tab)!, scope, name, template);
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
                onDelete={(item) => void remove(item, "prompt")}
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
                onDelete={(item) => void remove(item, "skill")}
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
                onEdit={(p) => void open(p)}
                {...(onCopy ? { onCopy: (item: ResourceItem) => onCopy(item, "extension") } : {})}
                onDelete={(item) => void remove(item, "extension")}
              />
            )}
            {tab === "packages" && (
              <NewPackageForm
                view={view}
                hostId={hostId}
                result={createdPackage}
                onResult={setCreatedPackage}
                onEdit={(p) => void open(p)}
                {...(onReveal ? { onReveal } : {})}
                {...(onRunPi
                  ? {
                      onInstall: (dir: string, name: string) => {
                        onRunPi(["install", dir], `패키지 설치: ${name}`);
                        onClose();
                      },
                    }
                  : {})}
              />
            )}
            {tab === "packages" && (
              <MyPackageList
                view={view}
                hostId={hostId}
                refreshKey={createdPackage?.created.dir ?? ""}
                onEdit={(p) => void open(p)}
                onError={setError}
                {...(onReveal ? { onReveal } : {})}
                {...(onRunPi
                  ? {
                      onRun: (args: string[], title: string) => {
                        onRunPi(args, title);
                        onClose();
                      },
                    }
                  : {})}
              />
            )}
            {tab === "packages" && (
              <PackageList
                view={view}
                hostId={hostId}
                onChanged={() => void load()}
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
  onDelete,
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
  /** 지우기 (사용자·프로젝트 폴더에 있는 것만. 패키지에 든 것은 Marketplace에서 제거) */
  onDelete?: (item: ResourceItem) => void;
}) {
  const badge = projectBadge(view.trust);
  // 한 번 더 눌러야 지운다
  const [confirming, setConfirming] = useState<string | undefined>();
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
            {onDelete && isDeletable(item) &&
              (confirming === item.path ? (
                <button
                  type="button"
                  className="small danger"
                  onClick={() => {
                    setConfirming(undefined);
                    onDelete(item);
                  }}
                  title="백업 폴더(~/.pi-desktop/resource-backups/deleted)로 옮깁니다"
                >
                  정말 삭제
                </button>
              ) : (
                <button type="button" className="small" onClick={() => setConfirming(item.path)}>
                  삭제
                </button>
              ))}
          </li>
        );
      })}
    </ul>
  );
}

function PackageList({
  view,
  hostId,
  onChanged,
  onRun,
  onOpenMarketplace,
  onCopy,
}: {
  view: ResourcesView;
  hostId: string;
  /** 패키지 필터를 바꾼 뒤 목록을 다시 읽는다 */
  onChanged: () => void;
  onRun?: (args: string[], title: string, projectCwd?: string) => void;
  onOpenMarketplace?: () => void;
  /** 다른 호스트에 같은 소스로 설치 */
  onCopy?: (pkg: ConfiguredPackageInfo) => void;
}) {
  /** 제거를 한 번 더 누르라고 묻는 중인 패키지 */
  const [confirmRemove, setConfirmRemove] = useState<string | undefined>();
  /** 리소스를 고르고 있는 패키지 (범위:소스, 덧씌우기면 끝에 :overlay) */
  const [filtering, setFiltering] = useState<string | undefined>();
  /** 작업 폴더가 데이터 폴더가 아니면 프로젝트다 (사용자 패키지를 이 프로젝트에서만 고를 수 있다) */
  const inProject = view.cwd.replace(/[\\/]+$/, "") !== view.agentDir.replace(/[\\/]+$/, "");
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
        <li key={`${p.scope}:${p.source}`} className={filtering?.startsWith(`${p.scope}:${p.source}`) ? "package-filtering" : undefined}>
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
          {p.installedPath && filtering !== `${p.scope}:${p.source}` && (
            <button
              type="button"
              className="small"
              onClick={() => setFiltering(`${p.scope}:${p.source}`)}
              title="이 패키지의 확장·스킬·프롬프트·테마를 하나씩 켜고 끕니다"
            >
              리소스 고르기
            </button>
          )}
          {p.installedPath && p.scope === "user" && inProject && filtering !== `${p.scope}:${p.source}:overlay` && (
            <button
              type="button"
              className="small"
              onClick={() => setFiltering(`${p.scope}:${p.source}:overlay`)}
              title="사용자 설정은 그대로 두고 이 프로젝트에서만 켜고 끕니다 (.pi/settings.json)"
            >
              이 프로젝트에서만 고르기
            </button>
          )}
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
          {filtering?.startsWith(`${p.scope}:${p.source}`) && (
            <PackageFilterEditor
              key={filtering}
              hostId={hostId}
              cwd={view.cwd}
              pkg={p}
              overlay={filtering.endsWith(":overlay")}
              onSaved={onChanged}
              onClose={() => setFiltering(undefined)}
            />
          )}
        </li>
      ))}
    </ul>
    </>
  );
}

const KIND_LABEL = { prompt: "프롬프트", skill: "스킬", agents: "AGENTS.md", extension: "확장" } as const;

/** 새 프롬프트·스킬·AGENTS.md·확장 만들기. 만들면 바로 편집기로 연다. 확장은 템플릿을 고른다 */
function NewResourceForm({
  kind,
  onCreate,
}: {
  kind: "prompt" | "skill" | "agents" | "extension";
  onCreate: (scope: "user" | "project", name: string, template?: ExtensionTemplate) => Promise<void>;
}) {
  const [scope, setScope] = useState<"user" | "project">("project");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<ExtensionTemplate>("command");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      await onCreate(scope, name.trim(), kind === "extension" ? template : undefined);
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
      {kind === "extension" && (
        <select value={template} onChange={(e) => setTemplate(e.target.value as ExtensionTemplate)} aria-label="템플릿" title="처음 코드의 종류">
          {EXTENSION_TEMPLATE_LABELS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      )}
      <button type="submit" disabled={busy || (kind !== "agents" && !name.trim())}>
        만들기
      </button>
      {error && <span className="resource-problem error">{error}</span>}
    </form>
  );
}

/**
 * 새 Pi 패키지 만들기 (패키지 탭). ~/pi-packages/<이름>에 package.json·README와 고른 템플릿의 확장을 만들고,
 * 사용자·프로젝트에 둔 프롬프트·스킬·확장 중 고른 것을 복사해 넣는다. 만든 뒤 바로 편집하거나 이 호스트에 설치한다.
 */
/** 방금 만든 패키지 */
interface CreatedPackage {
  name: string;
  created: PackageCreateResult;
  /** 템플릿으로 만든 확장 파일 */
  extension?: string;
}

function NewPackageForm({
  view,
  hostId,
  result,
  onResult,
  onEdit,
  onReveal,
  onInstall,
}: {
  view: ResourcesView;
  hostId: string;
  result: CreatedPackage | undefined;
  onResult: (result: CreatedPackage | undefined) => void;
  onEdit: (path: string) => void;
  onReveal?: (path: string) => void;
  /** pi install <폴더>를 내장 터미널에서 실행한다 */
  onInstall?: (dir: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<ExtensionTemplate | "">("command");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // 함께 넣을 수 있는 것: 사용자·프로젝트 폴더에 직접 둔 리소스
  const candidates = [
    ...view.prompts.map((item) => ({ item, kind: "prompt" as const, label: `/${item.name}` })),
    ...view.skills.map((item) => ({ item, kind: "skill" as const, label: `스킬 ${item.name}` })),
    ...view.extensions.map((item) => ({ item, kind: "extension" as const, label: `확장 ${item.name}` })),
  ].filter((c) => isDeletable(c.item));

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      const trimmed = name.trim();
      const created = await window.piDesktop.createPackage(hostId, {
        name: trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(template ? { extensionTemplate: template } : {}),
        include: candidates.filter((c) => selected.has(c.item.path)).map((c) => ({ path: c.item.path, kind: c.kind })),
      });
      onResult({ name: trimmed, created, ...(template ? { extension: joinPath(created.dir, "extensions", `${trimmed}.ts`) } : {}) });
      setName("");
      setDescription("");
      setSelected(new Set());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const { created } = result;
    return (
      <div className="banner ok package-created">
        <div>
          <strong>{result.name}</strong> 패키지를 만들었습니다: <code>{created.dir}</code>
        </div>
        <div className="muted">들어간 파일: {created.files.join(", ")}</div>
        <div className="muted">
          설치하면 이 폴더를 그대로 읽으므로 고친 내용이 바로 쓰입니다(열린 세션은 "지금 세션에 반영"). 넣은 원본 리소스는 그대로 있으니, 설치한 뒤 이름이 겹치면 원본을 지우세요.
          다른 사람과 나누려면 그 폴더에서 git 저장소에 올리거나 npm publish 하세요(README.md 참고).
        </div>
        <div className="package-created-actions">
          {onInstall && (
            <button type="button" className="small primary" onClick={() => onInstall(created.dir, result.name)}>
              이 호스트에 설치 (pi install)
            </button>
          )}
          {result.extension && (
            <button type="button" className="small" onClick={() => onEdit(result.extension!)}>
              확장 편집
            </button>
          )}
          <button type="button" className="small" onClick={() => onEdit(joinPath(created.dir, "package.json"))}>
            package.json 편집
          </button>
          <button type="button" className="small" onClick={() => onEdit(joinPath(created.dir, "README.md"))}>
            README 편집
          </button>
          {onReveal && (
            <button type="button" className="small" onClick={() => onReveal(joinPath(created.dir, "package.json"))}>
              위치 열기
            </button>
          )}
          <button type="button" className="small" onClick={() => onResult(undefined)}>
            닫기
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="resource-new">
        <button type="button" onClick={() => setOpen(true)} title="내 확장·스킬·프롬프트를 묶어 다른 호스트나 다른 사람과 나눌 수 있는 Pi 패키지로 만듭니다">
          새 패키지 만들기…
        </button>
        <span className="muted">확장·스킬·프롬프트를 묶어 설치하고 나눌 수 있는 패키지로 만듭니다.</span>
      </div>
    );
  }

  return (
    <form
      className="package-new"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div className="package-new-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="패키지 이름 (소문자·숫자·하이픈)" aria-label="패키지 이름" spellCheck={false} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="설명 (선택)" aria-label="설명" />
      </div>
      <label className="package-new-row">
        <span className="muted">확장</span>
        <select value={template} onChange={(e) => setTemplate(e.target.value as ExtensionTemplate | "")} aria-label="확장 템플릿">
          {EXTENSION_TEMPLATE_LABELS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
          <option value="">넣지 않기</option>
        </select>
      </label>
      {candidates.length > 0 && (
        <fieldset className="package-new-include">
          <legend className="muted">함께 넣을 리소스 (복사합니다)</legend>
          {candidates.map((c) => (
            <label key={c.item.path} title={c.item.path}>
              <input
                type="checkbox"
                checked={selected.has(c.item.path)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(c.item.path);
                    else next.delete(c.item.path);
                    return next;
                  })
                }
              />
              {c.label} <span className="resource-badge">{sourceLabel(c.item)}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="muted">~/pi-packages/{name.trim() || "<이름>"}에 package.json·README와 위 항목을 만듭니다.</p>
      <div className="package-new-row">
        <button type="submit" className="primary" disabled={busy || !name.trim()}>
          {busy ? "만드는 중…" : "만들기"}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          취소
        </button>
        {error && <span className="resource-problem error">{error}</span>}
      </div>
    </form>
  );
}

/**
 * 내가 만든 패키지 (~/pi-packages). 만든 뒤 바로 설치하지 않았어도 여기서 파일을 고치고, 설치·제거하고, 지운다.
 * 설치 여부는 설정의 패키지 중 로컬 경로(installedPath)가 그 폴더인 것으로 본다.
 */
function MyPackageList({
  view,
  hostId,
  refreshKey,
  onEdit,
  onError,
  onReveal,
  onRun,
}: {
  view: ResourcesView;
  hostId: string;
  /** 바뀌면 목록을 다시 읽는다 (새 패키지를 만든 뒤) */
  refreshKey: string;
  onEdit: (path: string) => void;
  onError: (message: string) => void;
  onReveal?: (path: string) => void;
  /** 그 호스트의 pi를 이 인자로 내장 터미널에서 실행한다 (설치·제거) */
  onRun?: (args: string[], title: string) => void;
}) {
  const [packages, setPackages] = useState<MyPackageInfo[] | undefined>();
  const [fileChoice, setFileChoice] = useState<Map<string, string>>(new Map());
  const [confirming, setConfirming] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      setPackages(await window.piDesktop.listMyPackages(hostId));
    } catch (e) {
      // 예전 Agent면 이 기능이 없다. 패키지 탭의 나머지는 그대로 쓴다.
      setPackages([]);
      onError(errorText(e));
    }
  }, [hostId, onError]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function remove(pkg: MyPackageInfo) {
    setConfirming(undefined);
    try {
      const { backup } = await window.piDesktop.deleteMyPackage(hostId, pkg.folder);
      setNotice(`${pkg.name} 패키지를 지웠습니다. 백업: ${backup}`);
      await load();
    } catch (e) {
      onError(errorText(e));
    }
  }

  if (!packages || packages.length === 0) return null;
  return (
    <div className="my-packages">
      <h4 className="settings-section">내가 만든 패키지 (~/pi-packages)</h4>
      {notice && <div className="banner ok">{notice}</div>}
      <ul className="resource-list">
        {packages.map((pkg) => {
          const installed = installedPackageFor(pkg.dir, view.packages);
          const files = editablePackageFiles(pkg.files);
          const chosen = fileChoice.get(pkg.dir) ?? files.find((f) => f.startsWith("extensions/")) ?? files[0];
          return (
            <li key={pkg.dir}>
              <div className="resource-main">
                <span className="resource-name">
                  {pkg.name}
                  {pkg.version && <span className="resource-badge">{pkg.version}</span>}
                  {installed ? (
                    <span className="resource-badge on">설치됨 ({installed.scope === "project" ? "프로젝트" : "사용자"})</span>
                  ) : (
                    <span className="resource-badge off">설치 안 됨</span>
                  )}
                </span>
                {pkg.description && <span className="resource-desc">{pkg.description}</span>}
                <span className="muted resource-path" title={pkg.dir}>
                  {pkg.dir}
                </span>
              </div>
              {files.length > 0 && (
                <span className="my-package-edit">
                  <select
                    value={chosen}
                    onChange={(e) => setFileChoice((prev) => new Map(prev).set(pkg.dir, e.target.value))}
                    aria-label="고칠 파일"
                  >
                    {files.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="small" disabled={!chosen} onClick={() => chosen && onEdit(joinPath(pkg.dir, ...chosen.split("/")))}>
                    편집
                  </button>
                </span>
              )}
              {onRun &&
                (installed ? (
                  <button
                    type="button"
                    className="small"
                    onClick={() => onRun(removeArgs(installed.source, installed.scope), `패키지 제거: ${pkg.name}`)}
                    title="설정에서 이 패키지를 뺍니다 (폴더는 그대로 둡니다)"
                  >
                    설치 해제
                  </button>
                ) : (
                  <button type="button" className="small primary" onClick={() => onRun(["install", pkg.dir], `패키지 설치: ${pkg.name}`)}>
                    설치
                  </button>
                ))}
              {onReveal && (
                <button type="button" className="small" onClick={() => onReveal(joinPath(pkg.dir, "package.json"))}>
                  위치 열기
                </button>
              )}
              {confirming === pkg.dir ? (
                <button type="button" className="small danger" onClick={() => void remove(pkg)} title="폴더를 백업 폴더로 옮깁니다">
                  정말 삭제
                </button>
              ) : (
                <button
                  type="button"
                  className="small"
                  disabled={Boolean(installed)}
                  title={installed ? "설치되어 있으면 먼저 \"설치 해제\"를 하세요" : "폴더를 지웁니다 (백업 폴더로 옮김)"}
                  onClick={() => setConfirming(pkg.dir)}
                >
                  삭제
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
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
