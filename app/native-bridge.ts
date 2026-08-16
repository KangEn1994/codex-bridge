export const NATIVE_BRIDGE_PROTOCOL = 1;

type NativeBridgeTransport = {
  postMessage: (message: string) => void;
  onmessage?: ((event: MessageEvent<string>) => void) | null;
};

type NativeReply = {
  protocol: number;
  type: string;
  requestId: string;
  ok: boolean;
  error?: string;
  features?: string[];
};

type PendingRequest = {
  resolve: (reply: NativeReply) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

declare global {
  interface Window {
    CodexBridgeNative?: NativeBridgeTransport;
  }
}

const pending = new Map<string, PendingRequest>();
let activeTransport: NativeBridgeTransport | null = null;
let nextRequestId = 0;
let capabilityPromise: Promise<boolean> | null = null;

function installReceiver(transport: NativeBridgeTransport) {
  if (activeTransport === transport) return;
  activeTransport = transport;
  transport.onmessage = (event) => {
    try {
      const reply = JSON.parse(event.data) as NativeReply;
      if (reply.protocol !== NATIVE_BRIDGE_PROTOCOL || typeof reply.requestId !== "string") return;
      const request = pending.get(reply.requestId);
      if (!request) return;
      pending.delete(reply.requestId);
      clearTimeout(request.timeout);
      request.resolve(reply);
    } catch {
      // Ignore messages from another page script or an older native shell.
    }
  };
}

function requestNative(
  type: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 1_200,
) {
  const transport = window.CodexBridgeNative;
  if (!transport?.postMessage) return Promise.reject(new Error("原生查看器不可用"));
  installReceiver(transport);
  const requestId = `${Date.now().toString(36)}-${++nextRequestId}`;
  return new Promise<NativeReply>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("原生查看器响应超时"));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timeout });
    try {
      transport.postMessage(JSON.stringify({
        protocol: NATIVE_BRIDGE_PROTOCOL,
        type,
        requestId,
        payload,
      }));
    } catch (reason) {
      clearTimeout(timeout);
      pending.delete(requestId);
      reject(reason instanceof Error ? reason : new Error("原生查看器调用失败"));
    }
  });
}

async function supportsNativeImageViewer() {
  if (!window.CodexBridgeNative?.postMessage) return false;
  if (!capabilityPromise) {
    capabilityPromise = requestNative("hello", {}, 800)
      .then((reply) => Boolean(reply.ok && reply.features?.includes("imageViewer")))
      .catch(() => false);
  }
  const attempt = capabilityPromise;
  const supported = await attempt;
  // Only a successful handshake is sticky. WebView may inject the bridge
  // shortly after this module first checks for it.
  if (!supported && capabilityPromise === attempt) capabilityPromise = null;
  return supported;
}

export async function openNativeImageViewer(options: {
  path: string;
  previewPath: string;
  token: string;
  title: string;
}) {
  if (!(await supportsNativeImageViewer())) return false;
  try {
    const reply = await requestNative("openImage", options);
    return reply.ok;
  } catch {
    return false;
  }
}
