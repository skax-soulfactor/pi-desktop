import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResourceDiagnosticInfo, ResourceItem, ResourcesView } from "@pi-desktop/host-protocol/messages";
import { errorText } from "./folder-browser";
import { diagnosticsByPath, formatSize, RESOURCE_TABS, shortPath, sourceLabel, tabCount, type ResourceTab } from "./resources-view";

interface Props {
  hostId: string;
  hostLabel: string;
  /** 리소스를 찾을 작업 폴더 */
  cwd: string;
  /** 탐색기에서 위치를 볼 수 있는 호스트(로컬·WSL)면 준다 */
  onReveal?: (path: string) => void;
  onClose: () => void;
}

/**
 * 리소스 창 (설계 §4.2~4.5, M4 첫 단계: 읽기 전용).
 * 이 작업 폴더에서 Pi가 실제로 불러오는 AGENTS.md·시스템 프롬프트·프롬프트·스킬·확장·패키지를 출처와 함께 보여 준다.
 * 확장은 코드를 실행하지 않고 경로만 찾은 목록이다.
 */
export function ResourcesPanel({ hostId, hostLabel, cwd, onReveal, onClose }: Props) {
  const [view, setView] = useState<ResourcesView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<ResourceTab>("context");

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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const diagnostics = useMemo(() => diagnosticsByPath(view?.diagnostics ?? []), [view]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
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
        {view && (
          <div className="resources-body">
            {tab === "context" && <ContextList view={view} onReveal={onReveal} />}
            {tab === "prompts" && (
              <ItemList
                view={view}
                items={view.prompts}
                diagnostics={diagnostics}
                empty="프롬프트가 없습니다. ~/.pi/agent/prompts/ 또는 .pi/prompts/에 .md 파일을 두면 /이름으로 씁니다."
                title={(p) => `/${p.name}${p.argumentHint ? ` ${p.argumentHint}` : ""}`}
                onReveal={onReveal}
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

function ContextList({ view, onReveal }: { view: ResourcesView; onReveal: ((path: string) => void) | undefined }) {
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
}: {
  view: ResourcesView;
  items: ResourceItem[];
  diagnostics: Map<string, ResourceDiagnosticInfo[]>;
  empty: string;
  title: (item: ResourceItem) => string;
  note?: (item: ResourceItem) => string | undefined;
  onReveal: ((path: string) => void) | undefined;
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
