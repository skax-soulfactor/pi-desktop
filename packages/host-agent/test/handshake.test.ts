import { createConnection, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { clientHandshake, proofFor, readLine, serverHandshake } from "../src/handshake";

const TOKEN = "a".repeat(64);
let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

/** 서버 쪽 동작을 정해 localhost에 띄우고, 붙은 클라이언트 소켓을 돌려준다 */
async function pair(onServer: (socket: Socket) => void): Promise<Socket> {
  server = createServer(onServer);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const socket = createConnection(port, "127.0.0.1");
  await new Promise((resolve) => socket.once("connect", resolve));
  return socket;
}

describe("handshake", () => {
  it("같은 토큰이면 서로 확인하고, 그 뒤 데이터가 그대로 이어진다", async () => {
    const serverResult = new Promise<{ legacy: boolean }>((resolve) => {
      void pair(async (socket) => {
        const result = await serverHandshake(socket, TOKEN, false);
        socket.write('{"jsonrpc":"2.0","method":"hi"}\n');
        resolve(result);
      }).then(async (client) => {
        const result = await clientHandshake(client, async () => TOKEN);
        expect(result.status).toBe("verified");
        const next = await readLine(client, 1000, result.rest);
        expect(next?.line).toBe('{"jsonrpc":"2.0","method":"hi"}');
        client.destroy();
      });
    });
    expect((await serverResult).legacy).toBe(false);
  });

  it("토큰을 모르는 가짜 데몬이면 연결기가 거절한다", async () => {
    const client = await pair(async (socket) => {
      socket.write('{"piDesktopAuth":1,"nonce":"n1"}\n');
      const answer = await readLine(socket, 1000);
      const { nonce } = JSON.parse(answer!.line) as { nonce: string };
      socket.write(`${JSON.stringify({ proof: proofFor("b".repeat(64), "server", nonce) })}\n`);
    });
    await expect(clientHandshake(client, async () => TOKEN)).rejects.toThrow("신원을 확인하지 못했습니다");
    client.destroy();
  });

  it("인사가 없으면(예전 데몬) legacy로 알린다", async () => {
    const client = await pair(() => {});
    expect((await clientHandshake(client, async () => TOKEN, 100)).status).toBe("legacy");
    client.destroy();
  });

  it("데몬은 증명이 틀린 연결기를 거절하고, 예전 연결기는 allowLegacy일 때만 받는다", async () => {
    const wrong = new Promise<unknown>((resolve) => {
      void pair((socket) => void serverHandshake(socket, TOKEN, false).then(resolve, resolve)).then(async (client) => {
        await readLine(client, 1000);
        client.write('{"nonce":"c","proof":"00"}\n');
      });
    });
    expect(await wrong).toBeInstanceOf(Error);
    server?.close();

    for (const allowLegacy of [false, true]) {
      const result = new Promise<unknown>((resolve) => {
        void pair((socket) => void serverHandshake(socket, TOKEN, allowLegacy).then(resolve, resolve)).then(async (client) => {
          await readLine(client, 1000);
          client.write('{"jsonrpc":"2.0","id":1,"method":"host.info"}\n');
        });
      });
      const value = await result;
      if (allowLegacy) expect(value).toMatchObject({ legacy: true });
      else expect(value).toBeInstanceOf(Error);
      server?.close();
    }
  });
});
