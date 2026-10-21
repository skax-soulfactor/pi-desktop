import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TerminalOpenRequest } from "../shared/api";

/** 첫 입력은 Pi 화면이 다 그려지고 출력이 이만큼 잠잠해진 뒤 보낸다 */
const INITIAL_INPUT_QUIET_MS = 1200;

export interface TerminalSpec extends Omit<TerminalOpenRequest, "cols" | "rows"> {
  /** 열린 뒤 대신 입력할 글 (예: "/login anthropic\r") */
  initialInput?: string;
}

/**
 * xterm.js로 그리는 터미널 하나 (설계 §4.12). 프로세스는 main이 node-pty로 띄운다.
 * 화면에서 빠지면 프로세스도 끝낸다.
 */
export function TerminalView({
  spec,
  visible,
  onOpened,
  onExit,
}: {
  spec: TerminalSpec;
  visible: boolean;
  onOpened?: (title: string) => void;
  onExit?: (exitCode: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const callbacks = useRef({ onOpened, onExit });
  callbacks.current = { onOpened, onExit };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const styles = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    const term = new Terminal({
      fontFamily: "ui-monospace, Consolas, 'Cascadia Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: color("--bg", "#16171d"), foreground: color("--text", "#e6e7ec") },
    });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(el);
    try {
      fit.fit();
    } catch {
      // 숨겨진 상태면 크기를 잴 수 없다. 보일 때 다시 맞춘다.
    }

    let id: string | undefined;
    let disposed = false;
    // 터미널 ID를 받기 전에 온 출력도 버리지 않도록 모아 둔다.
    const early: Array<[string, string]> = [];
    let initialTimer: ReturnType<typeof setTimeout> | undefined;
    let initialSent = !spec.initialInput;
    const scheduleInitial = () => {
      if (initialSent) return;
      if (initialTimer) clearTimeout(initialTimer);
      initialTimer = setTimeout(() => {
        if (id && !initialSent) {
          initialSent = true;
          window.piDesktop.terminalWrite(id, spec.initialInput!);
        }
      }, INITIAL_INPUT_QUIET_MS);
    };

    const offData = window.piDesktop.onTerminalData((tid, data) => {
      if (!id) return void early.push([tid, data]);
      if (tid !== id) return;
      term.write(data);
      scheduleInitial();
    });
    const offExit = window.piDesktop.onTerminalExit((tid, exitCode) => {
      if (tid !== id) return;
      term.write(`\r\n\x1b[2m[종료됨 (코드 ${exitCode})]\x1b[0m\r\n`);
      callbacks.current.onExit?.(exitCode);
    });
    const input = term.onData((data) => {
      if (id) window.piDesktop.terminalWrite(id, data);
    });

    void window.piDesktop
      .terminalOpen({ ...spec, cols: term.cols, rows: term.rows })
      .then((opened) => {
        if (disposed) return void window.piDesktop.terminalClose(opened.id);
        id = opened.id;
        for (const [tid, data] of early.splice(0)) if (tid === id) term.write(data);
        scheduleInitial();
        callbacks.current.onOpened?.(opened.title);
        term.focus();
      })
      .catch((e: unknown) => {
        term.write(`\x1b[31m터미널을 열지 못했습니다: ${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
        callbacks.current.onExit?.(-1);
      });

    // 크기가 바뀌면 열·행을 다시 맞추고 프로세스에 알린다.
    const observer = new ResizeObserver(() => {
      if (!el.offsetWidth || !el.offsetHeight) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (id) window.piDesktop.terminalResize(id, term.cols, term.rows);
    });
    observer.observe(el);

    return () => {
      disposed = true;
      if (initialTimer) clearTimeout(initialTimer);
      observer.disconnect();
      offData();
      offExit();
      input.dispose();
      if (id) window.piDesktop.terminalClose(id);
      term.dispose();
    };
    // 터미널은 처음 연 설정 그대로 유지한다 (spec이 바뀌어도 다시 띄우지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // 무시
      }
    });
  }, [visible]);

  return <div className="terminal-view" ref={host} hidden={!visible} />;
}
