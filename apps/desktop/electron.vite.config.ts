import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    // 워크스페이스 패키지(@pi-desktop/*)는 TS 소스 그대로이므로 번들에 포함한다.
    plugins: [externalizeDepsPlugin({ exclude: ["@pi-desktop/host-protocol"] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@pi-desktop/host-protocol"] })],
    // sandbox가 켜진 preload는 ESM을 쓸 수 없으므로 CommonJS로 내보낸다.
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    plugins: [react()],
  },
});
