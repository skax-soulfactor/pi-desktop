import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isValidKeyName, KeyStore, type Cipher } from "../src/main/key-store";

/** 뒤집어서 감추는 가짜 암호화 (파일에 평문이 남지 않는지 보려는 것) */
const fake = (available = true): Cipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join("")}`),
  decryptString: (encrypted) => {
    const text = encrypted.toString();
    if (!text.startsWith("enc:")) throw new Error("다른 키체인");
    return [...text.slice(4)].reverse().join("");
  },
});

describe("KeyStore", () => {
  it("암호화해 저장하고, 이름만 보여 주고, 세션 환경으로 푼다", () => {
    const path = join(mkdtempSync(join(tmpdir(), "keys-")), "keys.json");
    const store = new KeyStore(path, fake());
    store.set("OPENAI_API_KEY", " sk-secret ");
    store.set("ANTHROPIC_API_KEY", "ant-1");
    expect(store.names()).toEqual(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
    expect(readFileSync(path, "utf8")).not.toContain("sk-secret");
    expect(store.env()).toEqual({ OPENAI_API_KEY: "sk-secret", ANTHROPIC_API_KEY: "ant-1" });
    store.remove("OPENAI_API_KEY");
    expect(store.names()).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("이름 규칙·빈 값·암호화를 쓸 수 없는 환경은 거절한다", () => {
    const path = join(mkdtempSync(join(tmpdir(), "keys-")), "keys.json");
    expect(() => new KeyStore(path, fake()).set("openai key", "x")).toThrow(/영문 대문자/);
    expect(() => new KeyStore(path, fake()).set("A", " ")).toThrow(/비어/);
    expect(() => new KeyStore(path, fake(false)).set("A", "x")).toThrow(/키체인/);
    expect(new KeyStore(path, fake()).names()).toEqual([]);
    expect(isValidKeyName("MY_KEY_2")).toBe(true);
    expect(isValidKeyName("2KEY")).toBe(false);
  });

  it("이 PC의 키체인으로 풀 수 없는 항목은 건너뛴다", () => {
    const path = join(mkdtempSync(join(tmpdir(), "keys-")), "keys.json");
    const store = new KeyStore(path, fake());
    store.set("GOOD", "1");
    const other: Cipher = { ...fake(), encryptString: (plain) => Buffer.from(`xx:${plain}`) };
    new KeyStore(path, other).set("FOREIGN", "2");
    expect(store.env()).toEqual({ GOOD: "1" });
  });
});
