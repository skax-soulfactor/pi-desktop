import type { PiDesktopApi } from "../shared/api";

declare global {
  interface Window {
    /** preload가 노출한 API (src/preload/index.ts) */
    piDesktop: PiDesktopApi;
  }
}

export {};
