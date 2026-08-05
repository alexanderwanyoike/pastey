// Pastey's daemon seam, since v0.1.2 a thin binding over jolt-sdk.
//
// The wire core that used to live here (a copy of Spoke's transport) is now
// the shared SDK; this module keeps Pastey's historical export surface and
// its app-specific richer DTOs, and drops to the SDK transport directly for
// the two endpoints the SDK does not wrap (/encrypted/open, /home-relay/pins).
// On desktop the transport invokes the tauri-plugin-jolt commands; on web it
// calls the daemon base paths the vite proxy forwards.

import {
  apiErrorMessage as sdkApiErrorMessage,
  JoltApiError,
  JoltTransportError,
  operations as ops,
  type JoltTransport,
} from "jolt-sdk";
import { HttpTransport } from "jolt-sdk/transport-http";
import { isTauriRuntime, TauriTransport } from "jolt-sdk/transport-tauri";

export type NodeStatus = {
  peer_id: string;
  identity_address: string;
  uptime_secs: number;
  connected_peers: number;
  direct_peers: number;
  relayed_peers: number;
  nat_type: string;
  active_relays: number;
  published_count: number;
  cached_count: number;
  bootstrap_state: string;
  known_relay_count: number;
  connected_bootstrap_peers: number;
  home_relay: null | {
    peer_id: string;
    multiaddr: string;
    capability: string;
    api_url?: string | null;
  };
};

export type PublishResponse = {
  content_id: string;
  size: number;
  path?: string;
  address?: string;
  latest_sequence?: number;
};

export type EncryptedPublishResponse = PublishResponse & {
  recipient_count: number;
};

export type DecryptResponse = {
  content_id: string;
  path: string;
  plaintext: number[];
  size: number;
  content_type: string;
};

export type OpenPrivateResponse = {
  content_id: string;
  path: string;
  status: "decrypted" | "ciphertext";
  plaintext?: number[] | null;
  ciphertext?: number[] | null;
  size: number;
  content_type?: string | null;
  decrypt_error?: string | null;
};

export type PublishedContent = {
  content_id: string;
  size: number;
  path?: string | null;
  address?: string | null;
  local_sequence?: number | null;
  pin_state: string;
  relay?: null | {
    peer_id: string;
    multiaddr: string;
    api_url?: string | null;
  };
  pinned_content_id?: string | null;
  pinned_sequence?: number | null;
};

export type ResolveResponse = {
  address: string;
  identity: string;
  path: string;
  latest_sequence: number;
  content_id: string;
  reachability_hints: unknown[];
  source: string;
};

export type FetchResult = {
  data: number[];
  content_id: string;
  size: number;
};

export type HomeRelayPinResponse = {
  content_id: string;
  path?: string | null;
  relay_peer_id: string;
  relay_api_url?: string | null;
  latest_sequence?: number | null;
};

export type AppSessionStatus = "pending" | "active" | "rejected" | "revoked" | "expired";

export type AppSessionRequestResponse = {
  request_id: string;
  status: AppSessionStatus;
};

export type AppSessionStatusResponse = {
  request_id: string;
  session_id?: string | null;
  session_token?: string | null;
  status: AppSessionStatus;
  requested_identity?: string | null;
  identity?: string | null;
  capabilities: string[];
  expires_at?: number | null;
};

export type CurrentAppSession = {
  request_id: string;
  session_id?: string | null;
  app_id: string;
  app_name: string;
  identity?: string | null;
  granted_capabilities: string[];
  status: AppSessionStatus;
  expires_at?: number | null;
  last_used_at?: number | null;
};

export const PASTEY_CAPABILITIES = [
  "resolve:public",
  "fetch:public",
  "publish:/pastes/*",
  "publish:encrypted:/pastes/*",
  "inventory:/pastes/*",
  "pin:own:/pastes/*",
  "encrypt:/pastes/*",
  "decrypt:/pastes/*"
] as const;

const PASTEY_APP_ID = "pastey.local";
const PASTEY_APP_NAME = "Pastey";
const PASTEY_APP_ORIGIN = "http://127.0.0.1:5174";
const PASTEY_PATH_PREFIX = "/pastes/";

// Desktop invokes the tauri-plugin-jolt commands; web hits /app/v1 and
// /api/v1 directly, which the vite dev proxy forwards to the daemon. The
// runtime is probed per call (constructors are trivial), matching the old
// behavior and keeping tests free to switch runtimes.
function getTransport(): JoltTransport {
  return isTauriRuntime()
    ? new TauriTransport({ plugin: true })
    : new HttpTransport({ bases: { app: "/app/v1", daemon: "/api/v1" } });
}

export function apiErrorMessage(error: unknown) {
  if (error instanceof JoltTransportError || error instanceof TypeError) {
    return "Cannot reach the Jolt daemon. Start Jolt Console and make sure the daemon is running.";
  }
  if (error instanceof JoltApiError && (error.status === 500 || error.status === 502)) {
    return "Cannot reach the Jolt daemon. Start Jolt Console and make sure the daemon is running.";
  }
  return sdkApiErrorMessage(error);
}

export function isMissingAppSessionRequestError(error: unknown) {
  return error instanceof Error && error.message.includes("app session request not found:");
}

export function getStatus() {
  return getTransport().request<NodeStatus>("daemon", "/status");
}

export function requestPasteySession(identity: string | null) {
  const appOrigin = typeof window === "undefined" ? PASTEY_APP_ORIGIN : window.location.origin;
  return getTransport().request<AppSessionRequestResponse>("app", "/sessions/request", {
    json: {
      app_id: PASTEY_APP_ID,
      app_name: PASTEY_APP_NAME,
      app_origin: appOrigin,
      requested_identity: identity,
      requested_capabilities: PASTEY_CAPABILITIES
    }
  });
}

export function getSessionRequestStatus(requestId: string) {
  return getTransport().request<AppSessionStatusResponse>(
    "app",
    `/sessions/${encodeURIComponent(requestId)}`
  );
}

export function getCurrentSession(sessionToken: string) {
  return getTransport().request<CurrentAppSession>("app", "/session", { token: sessionToken });
}

export function listPublished(sessionToken: string) {
  return getTransport().request<PublishedContent[]>("app", "/published", { token: sessionToken });
}

export function publishPaste(sessionToken: string, path: string, text: string) {
  if (!path.startsWith(PASTEY_PATH_PREFIX)) {
    throw new Error("Pastey can only publish under /pastes/");
  }
  return ops.publishBytes(
    getTransport(),
    sessionToken,
    path,
    new TextEncoder().encode(text),
    { fileName: `${path.split("/").pop() || "paste"}.txt`, mimeType: "text/plain" }
  ) as Promise<PublishResponse>;
}

export function publishPrivatePaste(
  sessionToken: string,
  path: string,
  text: string,
  recipients: string[]
) {
  if (!path.startsWith(PASTEY_PATH_PREFIX)) {
    throw new Error("Pastey can only publish under /pastes/");
  }
  return ops.publishEncryptedBytes(
    getTransport(),
    sessionToken,
    path,
    new TextEncoder().encode(text),
    { mimeType: "text/plain", recipients }
  ) as Promise<EncryptedPublishResponse>;
}

export function resolveAddress(sessionToken: string, address: string) {
  return ops.resolveAddress(getTransport(), sessionToken, address) as Promise<ResolveResponse>;
}

export function fetchTarget(sessionToken: string, target: string) {
  return ops.fetchTarget(getTransport(), sessionToken, target) as Promise<FetchResult>;
}

export function decryptPaste(sessionToken: string, target: string) {
  return getTransport().request<DecryptResponse>("app", "/encrypted/decrypt", {
    token: sessionToken,
    json: { target }
  });
}

export function openPrivatePaste(sessionToken: string, target: string) {
  return getTransport().request<OpenPrivateResponse>("app", "/encrypted/open", {
    token: sessionToken,
    json: { target }
  });
}

export function pinHomeRelay(sessionToken: string, contentId: string, path?: string | null) {
  return getTransport().request<HomeRelayPinResponse>("app", "/home-relay/pins", {
    token: sessionToken,
    json: { content_id: contentId, path }
  });
}

export function decodeFetchData(result: FetchResult) {
  return new TextDecoder().decode(new Uint8Array(result.data));
}

export function decodePlaintext(result: DecryptResponse) {
  return new TextDecoder().decode(new Uint8Array(result.plaintext));
}

export function decodePrivateOpen(result: OpenPrivateResponse) {
  const bytes = result.status === "decrypted" ? result.plaintext : result.ciphertext;
  return new TextDecoder().decode(new Uint8Array(bytes || []));
}
