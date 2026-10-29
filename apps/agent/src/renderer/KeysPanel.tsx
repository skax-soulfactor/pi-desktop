import { useEffect, useState } from "react";

/** 자주 쓰는 프로바이더의 환경 변수 이름. Pi가 이 이름을 그대로 읽는다 */
const SUGGESTED = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"];

/**
 * API 키 관리 (설계 DESIGN-AGENT.md §3). 키는 OS 키체인으로 암호화해 두고, 새 세션을 열 때 Pi에 환경 변수로 넘긴다.
 * 화면에는 이름만 보이고 값은 다시 보여 주지 않는다.
 */
export function KeysPanel({ onError }: { onError: (message: string) => void }) {
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  const refresh = async () => setNames(await window.piAgent.listKeys());

  useEffect(() => {
    refresh().catch((error: unknown) => onError(String(error)));
  }, []);

  const run = (action: () => Promise<void>) =>
    action().catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));

  const save = () =>
    run(async () => {
      await window.piAgent.setKey(name.trim(), value);
      setName("");
      setValue("");
      await refresh();
    });

  return (
    <div className="keys-panel">
      <p className="keys-help">
        키는 OS 키체인으로 암호화해 이 PC에만 둡니다. <strong>새로 여는 세션부터</strong> Pi에 환경 변수로 넘깁니다. models.json의 커스텀
        프로바이더는 <code>"apiKey": "$이름"</code>으로 참조하세요.
      </p>
      {names.length > 0 && (
        <ul className="keys-list">
          {names.map((n) => (
            <li key={n}>
              <code>{n}</code>
              <button onClick={() => run(async () => (await window.piAgent.removeKey(n), await refresh()))}>지우기</button>
            </li>
          ))}
        </ul>
      )}
      <div className="keys-form">
        <input list="key-names" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="이름 (예: ANTHROPIC_API_KEY)" />
        <datalist id="key-names">
          {SUGGESTED.filter((s) => !names.includes(s)).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="값" autoComplete="off" />
        <button className="primary" disabled={!name.trim() || !value.trim()} onClick={save}>
          저장
        </button>
      </div>
    </div>
  );
}
