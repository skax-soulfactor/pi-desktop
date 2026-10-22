import { useEffect, useRef, useState } from "react";
import type { PlaygroundRunResult } from "@pi-desktop/host-protocol/messages";
import type { HostDescriptor } from "../shared/api";
import { errorText } from "./folder-browser";
import { appendOutput, EXAMPLES, insertIndent, resultText, type OutputChunk } from "./playground-view";

interface Props {
  hosts: HostDescriptor[];
  /** 처음 고를 호스트 (지금 탭의 호스트) */
  hostId: string;
  /** 처음 넣을 작업 폴더 (지금 탭의 폴더) */
  cwd?: string;
  onClose: () => void;
}

const STORAGE_KEY = "pi-desktop.playground.code";
const TIMEOUTS = [
  { ms: 30_000, label: "30초" },
  { ms: 120_000, label: "2분" },
  { ms: 600_000, label: "10분" },
];

function loadCode(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? EXAMPLES[0]!.code;
  } catch {
    return EXAMPLES[0]!.code;
  }
}

function saveCode(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // 저장하지 못해도 실행에는 상관없다.
  }
}

/**
 * SDK Playground (설계 §4.10): 고른 호스트에서 그 호스트에 설치된 Pi SDK로 스크립트를 실행한다.
 * WSL·SSH를 고르면 그 안의 Pi SDK로 돈다. 스크립트에서는 `pi`로 SDK를 바로 쓴다(최상위 await 가능).
 */
export function PlaygroundPanel({ hosts, hostId: initialHostId, cwd: initialCwd = "", onClose }: Props) {
  const [hostId, setHostId] = useState(initialHostId);
  const [cwd, setCwd] = useState(initialCwd);
  const [timeoutMs, setTimeoutMs] = useState(120_000);
  const [code, setCode] = useState(loadCode);
  const [output, setOutput] = useState<OutputChunk[]>([]);
  const [result, setResult] = useState<PlaygroundRunResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [runId, setRunId] = useState<string | undefined>();
  const runRef = useRef<{ hostId: string; runId: string } | undefined>(undefined);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const off = window.piDesktop.onPlaygroundOutput((id, n) => {
      const run = runRef.current;
      if (!run || id !== run.hostId || n.runId !== run.runId) return;
      setOutput((prev) => appendOutput(prev, { stream: n.stream, text: n.text }));
    });
    return off;
  }, []);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [output]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !runRef.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run() {
    if (runRef.current) return;
    saveCode(code);
    const id = crypto.randomUUID();
    runRef.current = { hostId, runId: id };
    setRunId(id);
    setOutput([]);
    setResult(undefined);
    setError(undefined);
    try {
      setResult(await window.piDesktop.playgroundRun(hostId, { runId: id, code, ...(cwd.trim() ? { cwd: cwd.trim() } : {}), timeoutMs }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      runRef.current = undefined;
      setRunId(undefined);
    }
  }

  function stop() {
    const run = runRef.current;
    if (run) void window.piDesktop.playgroundStop(run.hostId, run.runId).catch(() => {});
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !runId && onClose()}>
      <div className="modal playground" role="dialog" aria-label="SDK Playground" onMouseDown={(e) => e.stopPropagation()}>
        <header className="pi-manager-head">
          <h2>SDK Playground</h2>
          <select value={hostId} onChange={(e) => setHostId(e.target.value)} disabled={Boolean(runId)} aria-label="호스트">
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
          <select
            value=""
            onChange={(e) => {
              const example = EXAMPLES[Number(e.target.value)];
              if (example) setCode(example.code);
            }}
            disabled={Boolean(runId)}
            aria-label="예제"
          >
            <option value="">예제…</option>
            {EXAMPLES.map((ex, i) => (
              <option key={ex.title} value={String(i)}>
                {ex.title}
              </option>
            ))}
          </select>
          <div className="spacer" />
          {runId ? (
            <button type="button" className="danger" onClick={stop}>
              중지
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => void run()} title="Ctrl+Enter">
              실행
            </button>
          )}
          <button type="button" onClick={onClose} disabled={Boolean(runId)}>
            닫기
          </button>
        </header>
        <div className="playground-options">
          <label>
            작업 폴더
            <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="비우면 홈" spellCheck={false} disabled={Boolean(runId)} />
          </label>
          <label>
            제한 시간
            <select value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} disabled={Boolean(runId)}>
              {TIMEOUTS.map((t) => (
                <option key={t.ms} value={t.ms}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          JavaScript(ES 모듈)로 씁니다. 앞에 <code>const pi = await import(&lt;이 호스트의 Pi SDK&gt;)</code>가 붙으므로 <code>pi.SessionManager</code>처럼 바로 쓰고,
          최상위 await를 쓸 수 있습니다. 터미널처럼 그 호스트에서 내 권한으로 실행됩니다.
        </p>
        <textarea
          className="playground-code"
          value={code}
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void run();
            } else if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              const el = e.currentTarget;
              const next = insertIndent(code, el.selectionStart, el.selectionEnd);
              setCode(next.text);
              requestAnimationFrame(() => el.setSelectionRange(next.cursor, next.cursor));
            }
          }}
        />
        <div className="playground-result">
          {runId ? "실행 중…" : result ? resultText(result) : error ? "" : "실행하면 출력이 여기에 나옵니다."}
        </div>
        {error && <div className="banner error">{error}</div>}
        <pre className="playground-output" ref={outputRef}>
          {output.map((c, i) => (
            <span key={i} className={c.stream === "stderr" ? "stderr" : undefined}>
              {c.text}
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
}
