import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { createPiDesktopApi } from "../shared/api-client";
import { createAgentApi } from "../../../agent/src/preload/api";
import { createMateApi } from "../../../mate/src/preload/api";

/**
 * 창의 preload. 작업 공간 화면이 이 창 안의 iframe이라(main/workspaces.ts, nodeIntegrationInSubFrames) 모든 프레임에서 돈다.
 * 프레임 주소로 그 화면의 API만 만든다:
 * - 맨 위 프레임(Pi Desktop 화면): window.piDesktop
 * - 앱 안의 Agent 화면(out/renderer/agent/index.html): window.piAgent
 * - 앱 안의 Mate 화면(out/renderer/mate/index.html): window.mate
 * - 그 밖의 프레임(응답 속 페이지 등): 아무것도 만들지 않는다
 */
// preload는 node 설정(tsconfig.node)으로 검사하므로 DOM 타입 없이 창 값을 읽는다
const page = globalThis as unknown as { top: unknown; location: { protocol: string; pathname: string } };
const topFrame = page.top === globalThis;
const appFile = page.location.protocol === "file:";

// 프레임 주소로 고른다. 작업 공간을 새 창으로 열면 그 앱 화면이 창의 맨 위 페이지가 된다 (main/index.ts openWorkspaceWindow)
const isAgent = appFile && /\/renderer\/agent\/index\.html$/.test(page.location.pathname);
const isMate = appFile && /\/renderer\/mate\/index\.html$/.test(page.location.pathname);

if (isAgent) {
  contextBridge.exposeInMainWorld("piAgent", createAgentApi(ipcRenderer));
} else if (isMate) {
  contextBridge.exposeInMainWorld("mate", createMateApi(ipcRenderer));
} else if (topFrame) {
  const api = createPiDesktopApi(
    {
      invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
      send: (channel, ...args) => ipcRenderer.send(channel, ...args),
      on: (channel, listener) => {
        const handler = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...args);
        ipcRenderer.on(channel, handler);
        return () => ipcRenderer.removeListener(channel, handler);
      },
    },
    "electron",
  );
  contextBridge.exposeInMainWorld("piDesktop", api);
}
