import { spawn } from "node:child_process";

/**
 * 데몬 프로세스를 띄운다. 띄운 쪽(연결기)이 끝나도 데몬은 계속 살아 있어야 한다.
 *
 * Windows에서는 Node의 spawn이 부모의 "상속 가능한" 핸들을 모두 자식에게 넘긴다.
 * 앱(Electron) → 연결기 → 데몬으로 이어지면 Electron이 연 소켓 같은 핸들을 데몬이 물려받아,
 * 앱을 닫아도 그 자원이 풀리지 않는다 (실제로 DevTools 포트가 계속 점유됨).
 * `cmd /c start`도 같은 문제가 있어서, Windows 관리 서비스(WMI)의 Win32_Process.Create로 띄운다.
 * WMI가 만든 프로세스는 우리 프로세스 트리와 무관하므로 아무 핸들도 물려받지 않는다.
 *
 * `PI_DESKTOP_DAEMON_SPAWN=direct`로 예전 방식(직접 spawn)을 강제할 수 있다 (문제 조사용).
 */
export async function spawnDaemon(script: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (process.platform === "win32" && env.PI_DESKTOP_DAEMON_SPAWN !== "direct") {
    if (await spawnViaWmi(script, env)) return;
    // WMI를 쓸 수 없는 환경(서비스 비활성 등)이면 직접 실행으로 물러선다.
  }
  const child = spawn(process.execPath, [script, "daemon"], {
    detached: true,
    stdio: "ignore",
    env,
    windowsHide: true,
  });
  child.unref();
}

/**
 * PowerShell로 WMI를 호출해 데몬을 띄운다. 성공하면 true.
 *
 * - WMI의 EnvironmentVariables는 환경을 덧붙이지 않고 통째로 대체하므로 연결기의 환경 전체를 넘긴다.
 * - 환경에는 API 키가 있을 수 있어 명령줄이나 파일에 남기지 않고 표준 입력(JSON)으로 넘긴다.
 *   명령줄 길이 제한(약 32K자)도 피할 수 있다.
 * - PowerShell을 detached로 띄우면(콘솔 없음) 명령을 아예 실행하지 않으므로 일반 자식으로 띄운다.
 *   데몬과의 분리는 WMI가 해 준다.
 */
function spawnViaWmi(script: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const payload = JSON.stringify({
    commandLine: `"${process.execPath}" "${script}" daemon`,
    env: Object.entries(env)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, value]) => `${key}=${value}`),
  });
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(WMI_SCRIPT)],
        { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
      );
    } catch {
      resolve(false);
      return;
    }
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
    child.stdin.on("error", () => {});
    child.stdin.end(payload, "utf8");
  });
}

/** 표준 입력의 JSON을 읽어 WMI로 프로세스를 만든다. Win32_Process.Create의 ReturnValue(0=성공)를 종료 코드로 돌려준다. */
const WMI_SCRIPT = `
$ErrorActionPreference = 'Stop'
$data = [Console]::In.ReadToEnd() | ConvertFrom-Json
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{
  EnvironmentVariables = [string[]]$data.env
  ShowWindow = [uint16]0
}
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = [string]$data.commandLine
  ProcessStartupInformation = $startup
}
exit [int]$result.ReturnValue
`;

/** PowerShell -EncodedCommand 형식(UTF-16LE base64) */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}
