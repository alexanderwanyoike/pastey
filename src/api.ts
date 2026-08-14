// Pastey's daemon seam, since v0.1.2 a thin binding over jolt-sdk.
//
// The wire core that used to live here (a copy of Spoke's transport) is now
// the shared SDK; this module keeps Pastey's historical export surface and
// its app-specific text/path guards. Generic daemon operations stay behind
// released SDK operations or the fakeable high-level client.
// On desktop the transport invokes the tauri-plugin-jolt commands; on web it
// calls the daemon base paths the vite proxy forwards.

import {
  apiErrorMessage as sdkApiErrorMessage,
  createJoltClient,
  operations as ops,
  type AppCompatibilityDeclaration,
  type AppSessionRequestResponse,
  type AppSessionStatus,
  type AppSessionStatusResponse,
  type CompatibilityCheckOptions,
  type CurrentAppSession,
  type DecryptedEncryptedObject,
  type EncryptedPublishResponse,
  type FetchResult,
  type HomeRelayPinResult,
  type JoltTransport,
  type NodeStatus,
  type OpenEncryptedResult,
  type PublishedContent,
  type PublishResponse,
  type ResolveResponse,
} from "jolt-sdk";
import { HttpTransport } from "jolt-sdk/transport-http";
import { isTauriRuntime, TauriTransport } from "jolt-sdk/transport-tauri";
import appCompatibility from "../pastey-compatibility.json";
import { isJoltUnavailableError, JOLT_UNAVAILABLE_MESSAGE } from "./jolt-errors";

export type {
  AppSessionRequestResponse,
  AppSessionStatus,
  AppSessionStatusResponse,
  CurrentAppSession,
  EncryptedPublishResponse,
  FetchResult,
  HomeRelayPinResult,
  NodeStatus,
  OpenEncryptedResult as OpenPrivateResponse,
  PublishedContent,
  PublishResponse,
  ResolveResponse
};

export type DecryptResponse = DecryptedEncryptedObject;

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

export const PASTEY_COMPATIBILITY = {
  appApi: appCompatibility.app_api,
  requiredFeatures: appCompatibility.required_features,
  optionalFeatures: appCompatibility.optional_features
} as const satisfies AppCompatibilityDeclaration;

// Desktop invokes the tauri-plugin-jolt commands; web hits /app/v1 and
// /api/v1 directly, which the vite dev proxy forwards to the daemon.
const desktopTransport = new TauriTransport({ plugin: true });
const webTransport = new HttpTransport({ bases: { app: "/app/v1", daemon: "/api/v1" } });

function getTransport(): JoltTransport {
  return isTauriRuntime() ? desktopTransport : webTransport;
}

function getClient(sessionToken = "") {
  return createJoltClient({
    transport: getTransport(),
    getSessionToken: () => sessionToken
  });
}

export function checkPasteyCompatibility(
  declaration: AppCompatibilityDeclaration = PASTEY_COMPATIBILITY,
  options?: CompatibilityCheckOptions
) {
  return getClient().checkCompatibility(declaration, options);
}

export function apiErrorMessage(error: unknown) {
  if (isJoltUnavailableError(error)) {
    return JOLT_UNAVAILABLE_MESSAGE;
  }
  return sdkApiErrorMessage(error);
}

export function isMissingAppSessionRequestError(error: unknown) {
  return error instanceof Error && error.message.includes("app session request not found:");
}

export function getStatus() {
  return getClient().getStatus();
}

export function requestPasteySession(identity: string | null) {
  const appOrigin = typeof window === "undefined" ? PASTEY_APP_ORIGIN : window.location.origin;
  return getClient().requestSession({
    appId: PASTEY_APP_ID,
    appName: PASTEY_APP_NAME,
    appOrigin,
    identity,
    capabilities: PASTEY_CAPABILITIES
  });
}

export function getSessionRequestStatus(requestId: string) {
  return getClient().getSessionRequestStatus(requestId);
}

export function getCurrentSession(sessionToken: string) {
  return getClient(sessionToken).getCurrentSession();
}

export function listPublished(sessionToken: string) {
  return getClient(sessionToken).listPublished();
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
  );
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
  );
}

export function resolveAddress(sessionToken: string, address: string) {
  return ops.resolveAddress(getTransport(), sessionToken, address);
}

export function fetchTarget(sessionToken: string, target: string) {
  return ops.fetchTarget(getTransport(), sessionToken, target);
}

export function decryptPaste(sessionToken: string, target: string) {
  return ops.decryptEncryptedTarget(getTransport(), sessionToken, target);
}

export function openPrivatePaste(sessionToken: string, target: string) {
  return getClient(sessionToken).openEncrypted(target);
}

export function pinHomeRelay(sessionToken: string, contentId: string, path?: string | null) {
  return getClient(sessionToken).pinHomeRelay(contentId, path ?? undefined);
}

export function decodeFetchData(result: FetchResult) {
  return new TextDecoder().decode(new Uint8Array(result.data));
}

export function decodePlaintext(result: DecryptResponse) {
  return new TextDecoder().decode(new Uint8Array(result.plaintext));
}

export function decodePrivateOpen(result: OpenEncryptedResult) {
  return new TextDecoder().decode(new Uint8Array(result.bytes));
}
