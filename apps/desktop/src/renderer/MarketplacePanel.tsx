import { useEffect, useState } from "react";
import type { MarketDetail, MarketPackage } from "../shared/api";
import { errorText } from "./folder-browser";
import { formatRelative } from "./format";
import {
  excludeKindsFilter,
  formatCount,
  installArgs,
  kindLabel,
  npmNameOfSource,
  type PackageResourceKind,
  type PackageScope,
} from "./market-view";
import { Markdown } from "./markdown/Markdown";
import { GithubImport } from "./GithubImport";

interface Props {
  hostId: string;
  hostLabel: string;
  /** 프로젝트 범위 설치와 "설치됨" 표시의 기준 폴더. 없으면 사용자 범위만 */
  cwd?: string;
  /**
   * 그 호스트의 pi를 내장 터미널에서 이 인자로 실행한다. projectCwd가 있으면 그 폴더에서 (프로젝트 범위).
   * onSuccess는 코드 0으로 끝난 뒤에 부른다 (설치 뒤 패키지 필터 적용)
   */
  onRunPi: (args: string[], title: string, projectCwd?: string, onSuccess?: () => void) => void;
  onClose: () => void;
}

const PAGE = 20;

/**
 * Marketplace (설계 §4.6). npm의 pi-package를 찾아 보고 설치한다.
 * 설치는 그 호스트의 `pi install`을 내장 터미널에서 눈앞에 실행한다.
 * 확장이 든 패키지는 임의 코드를 실행하므로 설치 전에 보안 요약을 보여 준다.
 */
export function MarketplacePanel({ hostId, hostLabel, cwd, onRunPi, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MarketPackage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [detail, setDetail] = useState<MarketDetail | undefined>();
  /** npm 패키지 / GitHub 저장소의 개별 스킬·프롬프트 */
  const [source, setSource] = useState<"npm" | "github">("npm");
  const [installed, setInstalled] = useState<Map<string, string>>(new Map());

  async function search(text: string, from = 0) {
    setLoading(true);
    setError(undefined);
    try {
      const result = await window.piDesktop.marketSearch(text, from);
      setResults((prev) => (from === 0 ? result.packages : [...prev, ...result.packages]));
      setTotal(result.total);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadInstalled() {
    if (!cwd) return;
    try {
      const view = await window.piDesktop.listResources(hostId, cwd);
      const map = new Map<string, string>();
      for (const p of view.packages) {
        const name = npmNameOfSource(p.source);
        if (name) map.set(name, p.scope === "user" ? "사용자" : "프로젝트");
      }
      setInstalled(map);
    } catch {
      // 설치 목록을 못 읽어도 검색은 된다.
    }
  }

  useEffect(() => {
    void search("");
    void loadInstalled();
  }, [hostId, cwd]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detail) setDetail(undefined);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, detail]);

  async function openDetail(name: string) {
    setError(undefined);
    try {
      setDetail(await window.piDesktop.marketDetail(name));
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal marketplace" role="dialog" aria-label="Marketplace" onMouseDown={(e) => e.stopPropagation()}>
        <header className="pi-manager-head">
          <h2>Marketplace</h2>
          <span className="modal-badge">{hostLabel}</span>
          <span className="spacer" />
          {detail && (
            <button type="button" onClick={() => setDetail(undefined)}>
              목록으로
            </button>
          )}
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </header>
        {!detail && (
          <div className="segmented market-tabs">
            <button type="button" className={source === "npm" ? "on" : ""} onClick={() => setSource("npm")}>
              npm 패키지
            </button>
            <button type="button" className={source === "github" ? "on" : ""} onClick={() => setSource("github")}>
              GitHub 스킬·프롬프트
            </button>
          </div>
        )}
        {error && <div className="banner error">{error}</div>}
        {source === "github" && !detail ? (
          <GithubImport hostId={hostId} {...(cwd ? { cwd } : {})} />
        ) : detail ? (
          <PackageDetail
            detail={detail}
            installedScope={installed.get(detail.name)}
            {...(cwd ? { cwd } : {})}
            onInstall={(args, scope, excluded) => {
              // 뺄 종류가 있으면 설치가 끝난 뒤 그 종류를 패키지 필터에 []로 적는다 (설치 전에는 settings에 항목이 없다).
              const source = args[1]!;
              const onSuccess =
                excluded.length > 0
                  ? () =>
                      void window.piDesktop
                        .setPackageFilter(hostId, scope === "project" ? cwd ?? "" : "", source, scope, [], false, excludeKindsFilter(excluded))
                        .catch(() => {})
                  : undefined;
              onRunPi(args, `설치: ${detail.name}`, scope === "project" ? cwd : undefined, onSuccess);
              onClose();
            }}
          />
        ) : (
          <>
            <form
              className="market-search"
              onSubmit={(e) => {
                e.preventDefault();
                void search(query.trim());
              }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="npm의 Pi 패키지 검색 (예: mcp, review, subagent)"
                aria-label="패키지 검색"
                autoFocus
              />
              <button type="submit" disabled={loading}>
                검색
              </button>
            </form>
            <div className="muted market-total">{loading && results.length === 0 ? "찾는 중…" : `${total.toLocaleString()}개 중 ${results.length}개`}</div>
            <ul className="resource-list market-list">
              {results.map((p) => (
                <li key={p.name} onClick={() => void openDetail(p.name)}>
                  <div className="resource-main">
                    <span className="resource-name">
                      {p.name}
                      <span className="resource-badge">{p.version}</span>
                      {installed.has(p.name) && <span className="resource-badge on">설치됨 ({installed.get(p.name)})</span>}
                    </span>
                    {p.description && <span className="resource-desc">{p.description}</span>}
                    <span className="muted market-meta">
                      {p.monthlyDownloads !== undefined ? `월 ${formatCount(p.monthlyDownloads)}회 다운로드` : ""}
                      {p.updated ? ` · ${formatRelative(p.updated)} 게시` : ""}
                      {p.publisher ? ` · ${p.publisher}` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {results.length < total && (
              <button type="button" disabled={loading} onClick={() => void search(query.trim(), results.length)}>
                {loading ? "불러오는 중…" : `더 보기 (${PAGE}개)`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PackageDetail({
  detail,
  installedScope,
  cwd,
  onInstall,
}: {
  detail: MarketDetail;
  installedScope: string | undefined;
  cwd?: string;
  onInstall: (args: string[], scope: PackageScope, excluded: PackageResourceKind[]) => void;
}) {
  const [version, setVersion] = useState("");
  /** 설치할 때 뺄 리소스 종류 (매니페스트에 선언된 것만 고를 수 있다) */
  const [excluded, setExcluded] = useState<Set<PackageResourceKind>>(new Set());
  const [scope, setScope] = useState<PackageScope>("user");
  const [error, setError] = useState<string | undefined>();
  const risky = detail.mayRunCode || detail.installScripts.length > 0;

  return (
    <div className="market-detail">
      <div className="resource-name market-title">
        {detail.name}
        <span className="resource-badge">{detail.latest}</span>
        {detail.license && <span className="resource-badge">{detail.license}</span>}
        {installedScope && <span className="resource-badge on">설치됨 ({installedScope})</span>}
      </div>
      {detail.description && <p className="resource-desc">{detail.description}</p>}
      <p className="muted market-meta">
        {detail.updated ? `${formatRelative(detail.updated)} 게시 · ` : ""}
        <a href={`https://www.npmjs.com/package/${detail.name}`} target="_blank" rel="noreferrer">
          npm
        </a>
        {" · "}
        <a href={`https://pi.dev/packages/${detail.name}`} target="_blank" rel="noreferrer">
          pi.dev
        </a>
        {detail.repository && (
          <>
            {" · "}
            <a href={detail.repository} target="_blank" rel="noreferrer">
              저장소
            </a>
          </>
        )}
      </p>

      <div className={`banner ${risky ? "warn" : "info"} market-security`}>
        <div>
          <strong>포함된 리소스: </strong>
          {detail.manifest === "declared"
            ? detail.kinds.map(kindLabel).join(", ") || "선언 없음"
            : "매니페스트가 없어 설치해야 알 수 있습니다 (extensions/·skills/ 같은 폴더로 찾음)"}
        </div>
        {detail.mayRunCode && (
          <div>
            {detail.manifest === "declared" ? "확장이 들어 있습니다." : "확장이 들어 있을 수 있습니다."} 확장은 Pi 안에서 임의의 코드를
            실행합니다. 설치 전에 저장소의 코드를 확인하세요.
          </div>
        )}
        {detail.installScripts.length > 0 && <div>설치할 때 실행되는 npm 스크립트: {detail.installScripts.join(", ")}</div>}
        <div>
          함께 설치되는 의존성 {detail.dependencies.length}개
          {detail.dependencies.length > 0 ? `: ${detail.dependencies.slice(0, 12).join(", ")}${detail.dependencies.length > 12 ? " …" : ""}` : ""}
        </div>
      </div>

      <div className="market-install">
        <label>
          버전
          <select value={version} onChange={(e) => setVersion(e.target.value)}>
            <option value="">최신 (pi update로 갱신)</option>
            {detail.versions.map((v) => (
              <option key={v} value={v}>
                {v} (고정)
              </option>
            ))}
          </select>
        </label>
        <label>
          범위
          <select value={scope} onChange={(e) => setScope(e.target.value as PackageScope)}>
            <option value="user">사용자 (모든 폴더)</option>
            <option value="project" disabled={!cwd}>
              이 프로젝트 (.pi/settings.json)
            </option>
          </select>
        </label>
        <button
          type="button"
          className="primary"
          onClick={() => {
            try {
              onInstall(installArgs(detail.name, version || undefined, scope), scope, [...excluded]);
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          터미널에서 설치
        </button>
      </div>
      {detail.manifest === "declared" && detail.kinds.length > 1 && (
        <div className="market-kinds">
          <span>포함할 리소스</span>
          {detail.kinds.map((kind) => (
            <label key={kind}>
              <input
                type="checkbox"
                checked={!excluded.has(kind)}
                onChange={(e) =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.delete(kind);
                    else next.add(kind);
                    return next;
                  })
                }
              />
              {kindLabel(kind)}
            </label>
          ))}
          {excluded.size > 0 && (
            <span className="muted">
              설치가 끝나면 뺀 종류를 패키지 필터에 적습니다. 나중에 리소스 창 패키지 탭의 "리소스 고르기"로 바꿀 수 있습니다.
            </span>
          )}
        </div>
      )}
      <p className="muted">
        그 호스트의 pi install을 내장 터미널에서 실행합니다. 설치한 뒤에는 새 세션부터 쓰이며, 열려 있는 세션은 리소스 창의
        "지금 세션에 반영"으로 반영합니다. 프로젝트 범위는 그 폴더를 신뢰해야 불러옵니다.
      </p>
      {error && <div className="banner error">{error}</div>}
      <div className="market-readme">{detail.readme ? <Markdown text={detail.readme} /> : <p className="muted">README가 없습니다.</p>}</div>
    </div>
  );
}
