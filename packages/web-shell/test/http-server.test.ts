import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { listenWebServer, type RunningServer } from "../src/server/http-server";

describe("웹 서버 공통 바탕 (server/http-server)", () => {
  let dir: string;
  let running: RunningServer;
  let base: string;
  let token: string;
  const connected: string[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "web-shell-http-"));
    writeFileSync(join(dir, "index.html"), "<p>화면</p>");
    running = await listenWebServer({
      app: "시험 앱",
      version: "1.2.3",
      port: 0,
      host: "127.0.0.1",
      dataDir: dir,
      publicDir: dir,
      maxPayload: 1024,
      route: (req, res) => {
        if (req.url !== "/app-route") return false;
        res.writeHead(200).end("앱 경로");
        return true;
      },
      accept: (url) => url.searchParams.get("client") !== "bad",
      connect: (ws, url) => {
        connected.push(url.searchParams.get("client") ?? "");
        ws.close();
      },
    });
    base = `http://127.0.0.1:${(running.server.address() as AddressInfo).port}`;
    token = readFileSync(join(dir, "token"), "utf8").trim();
  });
  afterAll(() => {
    running.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("토큰이 든 주소를 dataDir/url에 쓴다", () => {
    expect(readFileSync(join(dir, "url"), "utf8").trim()).toBe(running.url);
    expect(running.url).toContain(`#token=${token}`);
  });

  it("토큰 확인: 맞으면 앱 이름과 버전, 틀리면 401", async () => {
    const ok = await fetch(`${base}/api/auth`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await ok.json()).toEqual({ ok: true, app: "시험 앱", version: "1.2.3" });
    expect((await fetch(`${base}/api/auth`, { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("앱 경로를 먼저 묻고, 나머지는 화면 파일로 내준다", async () => {
    expect(await (await fetch(`${base}/app-route`)).text()).toBe("앱 경로");
    expect(await (await fetch(`${base}/`)).text()).toBe("<p>화면</p>");
  });

  it("다른 사이트의 요청은 막는다", async () => {
    expect((await fetch(`${base}/`, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
  });

  it("WebSocket은 토큰과 앱의 확인을 거친 연결만 넘긴다", async () => {
    const open = (query: string) =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`${base.replace("http", "ws")}/ws?${query}`);
        ws.once("open", () => resolve(true));
        ws.once("error", () => resolve(false));
      });
    expect(await open("token=nope&client=a")).toBe(false);
    expect(await open(`token=${token}&client=bad`)).toBe(false);
    expect(await open(`token=${token}&client=good`)).toBe(true);
    expect(connected).toEqual(["good"]);
  });
});
