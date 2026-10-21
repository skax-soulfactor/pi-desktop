import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@pi-desktop/host-protocol/messages";
import { htmlExportPath } from "./format";

/** Pi Model 객체 중 화면에 쓰는 부분 (rpc-commands.md "Model object") */
export interface ModelInfo {
  id: string;
  name?: string;
  provider: string;
  reasoning?: boolean;
  contextWindow?: number;
}

/** get_session_stats 응답 중 화면에 쓰는 부분 */
export interface SessionStats {
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost?: number;
  /** 컴팩션 직후에는 tokens·percent가 null이다 */
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

export interface SessionInfo {
  model?: ModelInfo;
  thinkingLevel?: string;
  /** 사용자가 붙인 세션 이름 (get_state.sessionName) */
  sessionName?: string;
  thinkingLevels: string[];
  models: ModelInfo[];
  stats?: SessionStats;
}

const EMPTY: SessionInfo = { thinkingLevels: [], models: [] };

/** 이 이벤트가 오면 모델·사용량이 바뀌었을 수 있으므로 다시 읽는다. */
const REFRESH_ON = new Set(["agent_settled", "thinking_level_changed", "compaction_end", "message_end"]);

/**
 * 보고 있는 세션의 모델·thinking 수준·사용량을 읽고 바꾼다 (설계 §4.1 상단 바).
 *
 * Pi에는 모델 변경 이벤트가 없어서, 실행이 끝나거나 설정을 바꾼 뒤 get_state를 다시 읽는다.
 * 확장이 모델을 바꾸는 경우도 agent_settled 시점에 반영된다.
 */
export function useSessionInfo(hostId: string, session: SessionSummary | undefined, enabled: boolean) {
  const [info, setInfo] = useState<SessionInfo>(EMPTY);
  const target = useRef<{ hostId: string; sessionId: string } | undefined>(undefined);
  target.current = session && enabled ? { hostId, sessionId: session.sessionId } : undefined;

  const command = useCallback(async (cmd: Record<string, unknown>) => {
    const t = target.current;
    if (!t) return undefined;
    const response = await window.piDesktop.sendCommand(t.hostId, t.sessionId, cmd);
    if (response.success !== true) throw new Error(String(response.error ?? `${String(cmd.type)} 실패`));
    return response.data as Record<string, unknown> | undefined;
  }, []);

  const refresh = useCallback(async () => {
    const sessionId = target.current?.sessionId;
    if (!sessionId) return;
    try {
      const [state, levels, stats] = await Promise.all([
        command({ type: "get_state" }),
        command({ type: "get_available_thinking_levels" }),
        command({ type: "get_session_stats" }),
      ]);
      // 기다리는 사이 다른 세션으로 바뀌었으면 버린다.
      if (target.current?.sessionId !== sessionId) return;
      setInfo((prev) => {
        const next: SessionInfo = {
          ...prev,
          thinkingLevels: (levels?.levels as string[] | undefined) ?? [],
        };
        if (state?.model) next.model = state.model as ModelInfo;
        if (typeof state?.thinkingLevel === "string") next.thinkingLevel = state.thinkingLevel;
        if (typeof state?.sessionName === "string" && state.sessionName) next.sessionName = state.sessionName;
        else delete next.sessionName;
        if (stats) next.stats = stats as SessionStats;
        return next;
      });
    } catch {
      // 세션이 끝났거나 연결이 끊긴 경우. 다음 기회에 다시 읽는다.
    }
  }, [command]);

  const loadModels = useCallback(async () => {
    const sessionId = target.current?.sessionId;
    try {
      const data = await command({ type: "get_available_models" });
      if (target.current?.sessionId !== sessionId) return;
      setInfo((prev) => ({ ...prev, models: (data?.models as ModelInfo[] | undefined) ?? [] }));
    } catch {
      // 목록을 못 받아도 현재 모델 표시는 유지한다.
    }
  }, [command]);

  const setModel = useCallback(
    async (provider: string, modelId: string) => {
      await command({ type: "set_model", provider, modelId });
      await refresh();
    },
    [command, refresh],
  );

  const setThinkingLevel = useCallback(
    async (level: string) => {
      await command({ type: "set_thinking_level", level });
      await refresh();
    },
    [command, refresh],
  );

  /**
   * 수동 컴팩션. 성공·실패·중단은 Pi가 compaction_start/end 이벤트로 알리고 대화 안 안내로 보여주므로,
   * 명령 실패를 다시 예외로 올려 같은 내용을 두 번 보여주지 않는다.
   */
  const compact = useCallback(async () => {
    try {
      await command({ type: "compact" });
    } catch {
      // compaction_end 안내로 이미 표시됨
    }
    await refresh();
  }, [command, refresh]);

  /** 세션 이름을 바꾼다. Pi가 세션 파일에 session_info로 남겨 기록과 TUI /resume에도 보인다 */
  const rename = useCallback(
    async (name: string) => {
      await command({ type: "set_session_name", name });
      await refresh();
    },
    [command, refresh],
  );

  /** 세션을 HTML로 내보낸다 (세션 파일 옆, htmlExportPath). 만든 파일의 호스트 기준 경로를 돌려준다 */
  const exportHtml = useCallback(async (sessionFile: string | undefined): Promise<string | undefined> => {
    const outputPath = htmlExportPath(sessionFile);
    const data = await command(outputPath ? { type: "export_html", outputPath } : { type: "export_html" });
    return typeof data?.path === "string" ? data.path : undefined;
  }, [command]);

  // 세션이 바뀌면 처음부터 다시 읽는다.
  const sessionId = session?.sessionId;
  useEffect(() => {
    setInfo(EMPTY);
    if (!sessionId || !enabled) return;
    void refresh();
    void loadModels();
  }, [hostId, sessionId, enabled, refresh, loadModels]);

  // 실행이 끝나는 등 상태가 바뀔 만한 이벤트가 오면 잠시 모았다가 다시 읽는다.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.piDesktop.onSessionEvent((id, n) => {
      const t = target.current;
      if (!t || id !== t.hostId || n.sessionId !== t.sessionId) return;
      const type = (n.event as { type?: string } | null)?.type;
      if (!type || !REFRESH_ON.has(type)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 300);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  return { info, refresh, loadModels, setModel, setThinkingLevel, compact, rename, exportHtml };
}
