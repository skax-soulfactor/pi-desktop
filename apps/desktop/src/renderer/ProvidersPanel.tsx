import { useCallback, useEffect, useState } from "react";
import type { AuthCheckResult, ProviderInfo } from "@pi-desktop/host-protocol/messages";
import { checkLabel, keyProblem, STORED_LABELS, visibleProviders } from "./providers-view";

/**
 * Pi 관리 창의 프로바이더 탭 (설계 §4.7). 인증 상태 확인, API 키 등록·삭제.
 * 키는 입력받아 데몬으로 보내기만 하고, 저장된 키를 다시 받아 보여주지 않는다.
 */
export function ProvidersPanel({
  hostId,
  onChanged,
  onOAuthLogin,
}: {
  hostId: string;
  onChanged: () => void;
  /** 내장 터미널에서 pi를 열고 /login <provider>를 실행한다 */
  onOAuthLogin?: (provider: string) => void;
}) {
  const [providers, setProviders] = useState<ProviderInfo[] | undefined>();
  const [checks, setChecks] = useState<Record<string, AuthCheckResult | "checking">>({});
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | undefined>();
  const [key, setKey] = useState("");
  const [removing, setRemoving] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const check = useCallback(
    async (provider: string) => {
      setChecks((prev) => ({ ...prev, [provider]: "checking" }));
      const result = await window.piDesktop
        .authCheck(hostId, provider)
        .catch((): AuthCheckResult => ({ provider, status: "unknown" }));
      setChecks((prev) => ({ ...prev, [provider]: result }));
    },
    [hostId],
  );

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const list = await window.piDesktop.authProviders(hostId);
      setProviders(list);
      // 자격 증명이 저장된 것만 자동으로 확인한다 (전부 확인하면 Pi를 수십 번 띄워야 한다).
      for (const p of list.filter((x) => x.stored)) void check(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [hostId, check]);

  useEffect(() => {
    setProviders(undefined);
    setChecks({});
    setEditing(undefined);
    void load();
  }, [load]);

  async function save(provider: string) {
    const problem = keyProblem(key);
    if (problem) return setError(problem);
    setBusy(true);
    setError(undefined);
    try {
      await window.piDesktop.authSetApiKey(hostId, provider, key.trim());
      setKey("");
      setEditing(undefined);
      await load();
      await check(provider);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(provider: string) {
    setBusy(true);
    setError(undefined);
    try {
      await window.piDesktop.authRemove(hostId, provider);
      setRemoving(undefined);
      await load();
      await check(provider);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const shown = providers ? visibleProviders(providers, query) : [];

  return (
    <section className="providers">
      <input
        className="providers-search"
        type="search"
        placeholder={`프로바이더 검색${providers ? ` (${providers.length}개)` : ""}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="프로바이더 검색"
      />
      {error && <div className="banner error">{error}</div>}
      {!providers && !error && <p className="muted">프로바이더 목록을 읽는 중…</p>}
      <ul className="provider-list">
        {shown.map((p) => {
          const result = checks[p.id];
          const label = result === "checking" ? { text: "확인 중…", level: "info" as const } : checkLabel(result);
          return (
            <li key={p.id} className="provider">
              <div className="provider-row">
                <span className="provider-name">{p.name}</span>
                <span className="provider-id">{p.id}</span>
                {p.custom && <span className="provider-tag">사용자 정의</span>}
                {p.stored && <span className="provider-tag stored">{STORED_LABELS[p.stored]}</span>}
                {label && <span className={`provider-check ${label.level}`}>{label.text}</span>}
                <div className="spacer" />
                <button type="button" className="small" disabled={busy || result === "checking"} onClick={() => void check(p.id)}>
                  확인
                </button>
                {p.apiKey && (
                  <button
                    type="button"
                    className="small"
                    disabled={busy}
                    onClick={() => {
                      setEditing(editing === p.id ? undefined : p.id);
                      setKey("");
                      setError(undefined);
                    }}
                  >
                    {p.stored === "api_key" ? "키 바꾸기" : "API 키 입력"}
                  </button>
                )}
                {p.oauth && onOAuthLogin && (
                  <button
                    type="button"
                    className="small"
                    disabled={busy}
                    onClick={() => onOAuthLogin(p.id)}
                    title="내장 터미널에서 pi를 열고 /login을 실행합니다. 끝나면 이 창을 다시 열어 확인하세요"
                  >
                    OAuth 로그인
                  </button>
                )}
                {p.stored && (
                  <button type="button" className="small danger" disabled={busy} onClick={() => setRemoving(p.id)}>
                    삭제
                  </button>
                )}
              </div>
              {!p.apiKey && p.oauth && !p.stored && (
                <div className="provider-note">OAuth 로그인만 됩니다. "OAuth 로그인"을 누르면 내장 터미널에서 진행합니다.</div>
              )}
              {editing === p.id && (
                <form
                  className="provider-key"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(p.id);
                  }}
                >
                  <input
                    type="password"
                    autoFocus
                    autoComplete="off"
                    placeholder="API 키, 또는 !명령 (시크릿 매니저에서 읽기)"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    aria-label={`${p.name} API 키`}
                  />
                  <button type="submit" className="primary small" disabled={busy}>
                    저장
                  </button>
                  <button type="button" className="small" onClick={() => setEditing(undefined)}>
                    취소
                  </button>
                </form>
              )}
              {removing === p.id && (
                <div className="banner warn">
                  <span>
                    {p.name}의 저장된 자격 증명을 auth.json에서 지웁니다. 환경 변수로 설정한 키는 그대로 남습니다.
                  </span>
                  <button type="button" className="danger" disabled={busy} onClick={() => void remove(p.id)}>
                    삭제
                  </button>
                  <button type="button" onClick={() => setRemoving(undefined)}>
                    취소
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="pi-manager-note muted">
        저장한 키는 auth.json에만 쓰고 이 화면에 다시 보여주지 않습니다. 이미 열려 있는 세션에는 바로 반영되지 않을 수 있으니,
        새 세션에서 사용하세요.
      </p>
    </section>
  );
}
