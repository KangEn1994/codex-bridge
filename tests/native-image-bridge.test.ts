import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_BRIDGE_PROTOCOL, openNativeImageViewer } from "../app/native-bridge";

test("native image bridge handshakes and waits for an open acknowledgement", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const transport: {
    postMessage: (message: string) => void;
    onmessage?: (event: MessageEvent<string>) => void;
  } = {
    postMessage(message) {
      const request = JSON.parse(message) as {
        protocol: number;
        type: string;
        requestId: string;
        payload: Record<string, unknown>;
      };
      requests.push(request);
      const reply = request.type === "hello"
        ? {
            protocol: NATIVE_BRIDGE_PROTOCOL,
            type: "helloResult",
            requestId: request.requestId,
            ok: true,
            features: ["imageViewer"],
          }
        : {
            protocol: NATIVE_BRIDGE_PROTOCOL,
            type: "openImageResult",
            requestId: request.requestId,
            ok: true,
          };
      queueMicrotask(() => transport.onmessage?.({ data: JSON.stringify(reply) } as MessageEvent<string>));
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { CodexBridgeNative: transport },
  });

  const opened = await openNativeImageViewer({
    path: "/api/threads/thread-1/images/image-1",
    previewPath: "/api/threads/thread-1/images/image-1?variant=preview",
    token: "a-valid-token-that-is-long-enough",
    title: "测试图片",
  });

  assert.equal(opened, true);
  assert.deepEqual(requests.map((request) => request.type), ["hello", "openImage"]);
  assert.deepEqual((requests[1].payload as Record<string, unknown>).path, "/api/threads/thread-1/images/image-1");
});
test("native image bridge reports a rejected open so the web viewer can fall back", async () => {
  const transport = (window as Window & {
    CodexBridgeNative: {
      postMessage: (message: string) => void;
      onmessage?: (event: MessageEvent<string>) => void;
    };
  }).CodexBridgeNative;
  transport.postMessage = (message) => {
    const request = JSON.parse(message) as { type: string; requestId: string };
    queueMicrotask(() => transport.onmessage?.({
      data: JSON.stringify({
        protocol: NATIVE_BRIDGE_PROTOCOL,
        type: "openImageResult",
        requestId: request.requestId,
        ok: false,
        error: "rejected",
      }),
    } as MessageEvent<string>));
  };

  assert.equal(await openNativeImageViewer({
    path: "/api/threads/thread-1/images/image-2",
    previewPath: "/api/threads/thread-1/images/image-2?variant=preview",
    token: "a-valid-token-that-is-long-enough",
    title: "测试图片",
  }), false);
});
