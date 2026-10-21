/**
 * Pi 설치·특정 버전 설치·제거 명령 (설계 §4.9 "설치 마법사"·"제거"). 화면과 분리한 순수 함수.
 *
 * 명령은 앱이 몰래 실행하지 않는다. 사용자에게 그대로 보여주고, 확인하면 내장 터미널(셸)에 입력해 눈앞에서 돈다.
 * - Windows: npm 전역 설치. PowerShell 실행 정책에 npm.ps1이 막힐 수 있어 npm.cmd를 쓴다. --ignore-scripts.
 * - Android(Termux, SSH로 연결): 공식 설치기가 받는 Node·Pi 묶음은 Android에서 돌지 않으므로 npm 전역 설치.
 * - macOS·Linux·WSL: 공식 설치기(https://pi.dev/install.sh). 먼저 내려받아 내용을 보여주고, 그다음 실행한다.
 *   설치기는 대화형 메뉴로 설치·업데이트·제거를 모두 다루므로, 관리형 설치의 제거도 설치기로 한다.
 * - 특정 버전은 npm 전역 설치만 된다 (설치기에는 버전 옵션이 없다).
 * - 데이터(~/.pi/agent)는 건드리지 않는다.
 */

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";
export const INSTALLER_URL = "https://pi.dev/install.sh";
/** 설치기를 내려받아 둘 곳 (앱이 쓰는 폴더) */
export const INSTALLER_PATH = "$HOME/.pi-desktop/pi-install.sh";

export interface InstallStep {
  id: string;
  label: string;
  /** 셸에 입력할 명령 */
  command: string;
  /** 무엇을 하는지 */
  note: string;
}

export function isWindows(platform: string): boolean {
  return platform === "win32";
}

/** Node가 알려 주는 Android(Termux) */
export function isAndroid(platform: string): boolean {
  return platform === "android";
}

/** npm 버전 형식 (예: 1.3.0, 1.2.0-beta.1). 이것만 명령에 넣는다 */
export function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function npm(platform: string): string {
  return isWindows(platform) ? "npm.cmd" : "npm";
}

/** Pi가 없을 때 설치하는 단계 */
export function installSteps(platform: string, nodeOk: boolean): InstallStep[] {
  if (isWindows(platform)) {
    const steps: InstallStep[] = [];
    if (!nodeOk) {
      steps.push({
        id: "node",
        label: "Node.js LTS 설치",
        command: "winget install OpenJS.NodeJS.LTS",
        note: "Pi에는 Node 22.19 이상이 필요합니다. 설치한 뒤에는 앱을 다시 시작해야 새 Node를 찾습니다.",
      });
    }
    steps.push({
      id: "install",
      label: "Pi 설치 (npm 전역)",
      command: `${npm(platform)} install -g --ignore-scripts ${PI_PACKAGE}`,
      note: "npm 전역에 Pi를 설치합니다.",
    });
    return steps;
  }
  if (isAndroid(platform)) {
    // Host Agent가 붙었으면 Node는 이미 있다 (Agent가 Node로 돈다).
    return [
      {
        id: "install",
        label: "Pi 설치 (npm 전역)",
        command: `npm install -g --ignore-scripts ${PI_PACKAGE}`,
        note: "Termux의 npm 전역에 Pi를 설치합니다.",
      },
    ];
  }
  return [
    {
      id: "view",
      label: "1. 설치 스크립트 내려받아 보기",
      command: `mkdir -p "$HOME/.pi-desktop" && curl -fsSL ${INSTALLER_URL} -o "${INSTALLER_PATH}" && less "${INSTALLER_PATH}"`,
      note: "공식 설치기를 내려받아 내용을 보여줍니다 (q로 닫기). 실행하지 않습니다.",
    },
    {
      id: "install",
      label: "2. 설치 스크립트 실행",
      command: `sh "${INSTALLER_PATH}"`,
      note: "내려받은 설치기를 실행합니다. 설치기가 메뉴로 물어봅니다 (필요하면 Node도 설치).",
    },
  ];
}

/** 특정 버전 설치 (npm 전역만). 그 밖의 설치 방식이면 undefined */
export function versionInstallStep(platform: string, source: string | undefined, version: string): InstallStep | undefined {
  if (source !== "npm-global" || !isVersion(version)) return undefined;
  return {
    id: "version",
    label: `Pi ${version} 설치`,
    command: `${npm(platform)} install -g --ignore-scripts ${PI_PACKAGE}@${version}`,
    note: "npm 전역의 Pi를 이 버전으로 바꿉니다 (롤백도 같은 방법).",
  };
}

/** 제거. 앱이 다룰 수 없는 설치(환경 변수·직접 지정 경로)면 undefined */
export function uninstallStep(platform: string, source: string | undefined): InstallStep | undefined {
  if (source === "npm-global") {
    return {
      id: "uninstall",
      label: "Pi 제거 (npm 전역)",
      command: `${npm(platform)} uninstall -g ${PI_PACKAGE}`,
      note: "npm 전역의 Pi를 지웁니다. ~/.pi/agent의 세션·설정·자격 증명은 남습니다.",
    };
  }
  if (source === "managed" && !isWindows(platform)) {
    return {
      id: "uninstall",
      label: "Pi 제거 (설치기)",
      command: `mkdir -p "$HOME/.pi-desktop" && curl -fsSL ${INSTALLER_URL} -o "${INSTALLER_PATH}" && sh "${INSTALLER_PATH}"`,
      note: "공식 설치기를 실행합니다. 메뉴에서 u를 누르면 제거합니다. ~/.pi/agent의 세션·설정·자격 증명은 남습니다.",
    };
  }
  return undefined;
}

/** 버전 목록을 최신부터, 프리릴리스는 뺀다 */
export function stableVersionsNewestFirst(versions: readonly string[]): string[] {
  const parse = (v: string) => v.split(".").map((n) => Number(n) || 0);
  return versions
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => {
      const [x, y] = [parse(a), parse(b)];
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i]! - x[i]!;
      return 0;
    });
}
