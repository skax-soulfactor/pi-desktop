import { readFileSync, renameSync, writeFileSync } from "node:fs";

/**
 * API 키 보관 (설계 DESIGN-AGENT.md §3 "API 키").
 *
 * Pi는 키를 auth.json에 평문으로 둔다. 에이전트 앱은 키를 OS 키체인으로 암호화해(Electron safeStorage —
 * Windows DPAPI, macOS Keychain, Linux libsecret) 앱 데이터에 두고, 세션을 열 때만 풀어 Pi 프로세스의
 * 환경 변수로 넘긴다. Pi는 ANTHROPIC_API_KEY 같은 환경 변수를 그대로 읽고, models.json의 커스텀
 * 프로바이더는 "apiKey": "$이름"으로 참조한다. 데몬은 세션 환경을 디스크에 남기지 않는다.
 */

/** 암호화·복호화. Electron safeStorage를 넘기고, 테스트에서는 가짜를 쓴다 */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** 환경 변수 이름으로 쓸 수 있는 키 이름 */
const NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

export function isValidKeyName(name: string): boolean {
  return NAME.test(name);
}

export class KeyStore {
  constructor(
    private readonly path: string,
    private readonly cipher: Cipher,
  ) {}

  /** 저장된 키 이름들 (값은 돌려주지 않는다) */
  names(): string[] {
    return Object.keys(this.read()).sort();
  }

  set(name: string, value: string): void {
    if (!isValidKeyName(name)) throw new Error(`키 이름은 영문 대문자·숫자·밑줄만 쓸 수 있습니다 (예: ANTHROPIC_API_KEY): ${name}`);
    if (!value.trim()) throw new Error("키 값이 비어 있습니다");
    // 암호화할 수 없는 환경(키링 없는 Linux 등)에서 평문으로 떨어뜨리지 않는다
    if (!this.cipher.isEncryptionAvailable()) throw new Error("이 PC에서는 OS 키체인 암호화를 쓸 수 없어 키를 저장하지 않았습니다");
    const all = this.read();
    all[name] = this.cipher.encryptString(value.trim()).toString("base64");
    this.write(all);
  }

  remove(name: string): void {
    const all = this.read();
    delete all[name];
    this.write(all);
  }

  /** 세션 환경 변수로 넘길 값. 풀 수 없는 항목은 건너뛴다 (다른 PC에서 옮겨 온 파일 등) */
  env(): Record<string, string> {
    if (!this.cipher.isEncryptionAvailable()) return {};
    const env: Record<string, string> = {};
    for (const [name, encrypted] of Object.entries(this.read())) {
      try {
        env[name] = this.cipher.decryptString(Buffer.from(encrypted, "base64"));
      } catch {
        // 이 PC의 키체인으로 만든 것이 아니다
      }
    }
    return env;
  }

  private read(): Record<string, string> {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => isValidKeyName(e[0]) && typeof e[1] === "string"));
    } catch {
      return {};
    }
  }

  private write(all: Record<string, string>): void {
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, this.path);
  }
}
