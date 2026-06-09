import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const isTauriMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock
}));

import {
  PASTEY_CAPABILITIES,
  decryptPaste,
  fetchTarget,
  getSessionRequestStatus,
  getStatus,
  isMissingAppSessionRequestError,
  listPublished,
  openPrivatePaste,
  publishPrivatePaste,
  publishPaste,
  requestPasteySession
} from "./api";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

describe("Pastey daemon API client", () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
  });

  afterEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("requests a Pastey app session with the /pastes capability set", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ request_id: "req_1", status: "pending" })
    );

    await expect(requestPasteySession("alice.jolt")).resolves.toEqual({
      request_id: "req_1",
      status: "pending"
    });

    expect(fetch).toHaveBeenCalledWith(
      "/app/v1/sessions/request",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: "pastey.local",
          app_name: "Pastey",
          app_origin: "http://127.0.0.1:5174",
          requested_identity: "alice.jolt",
          requested_capabilities: PASTEY_CAPABILITIES
        })
      })
    );
  });

  it("can request Pastey permissions for the local identity before the address is known", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ request_id: "req_1", status: "pending" })
    );

    await requestPasteySession(null);

    expect(fetch).toHaveBeenCalledWith(
      "/app/v1/sessions/request",
      expect.objectContaining({
        body: JSON.stringify({
          app_id: "pastey.local",
          app_name: "Pastey",
          app_origin: "http://127.0.0.1:5174",
          requested_identity: null,
          requested_capabilities: PASTEY_CAPABILITIES
        })
      })
    );
  });

  it("uses the daemon status endpoint only for local identity discovery", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ identity_address: "alice.jolt" }));

    await expect(getStatus()).resolves.toEqual({ identity_address: "alice.jolt" });

    expect(fetch).toHaveBeenCalledWith("/api/v1/status", undefined);
  });

  it("sends bearer session tokens on app API reads and writes", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ content_id: "cid", size: 4 }))
      .mockResolvedValueOnce(jsonResponse({ data: [116, 101, 115, 116], content_id: "cid", size: 4 }));

    await listPublished("token-1");
    await publishPaste("token-1", "/pastes/hello", "hello");
    await fetchTarget("token-1", "alice.jolt/pastes/hello");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/app/v1/published",
      expect.objectContaining({
        headers: { Authorization: "Bearer token-1" }
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/app/v1/publish",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer token-1" },
        body: expect.any(FormData)
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/app/v1/fetch",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token-1",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ target: "alice.jolt/pastes/hello" })
      })
    );
  });

  it("uses Tauri daemon commands for desktop JSON app API requests", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce([]);

    await listPublished("token-1");

    expect(fetch).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("daemon_request", {
      basePath: "/app/v1",
      path: "/published",
      method: "GET",
      body: null,
      sessionToken: "token-1"
    });
  });

  it("uses Tauri daemon commands when the IPC internals are available", async () => {
    isTauriMock.mockReturnValue(false);
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke: vi.fn() } });
    invokeMock.mockResolvedValueOnce({ identity_address: "alice-public.jolt" });

    await getStatus();

    expect(fetch).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("daemon_request", {
      basePath: "/api/v1",
      path: "/status",
      method: "GET",
      body: null,
      sessionToken: null
    });
  });

  it("does not treat a non-IPC Tauri internals object as desktop runtime", async () => {
    isTauriMock.mockReturnValue(false);
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ identity_address: "alice-public.jolt" }));

    await getStatus();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("/api/v1/status", undefined);
  });

  it("uses a Tauri daemon command for desktop text publishing", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce({ content_id: "cid", size: 5 });

    await publishPaste("token-1", "/pastes/hello", "hello");

    expect(fetch).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("daemon_publish_text", {
      sessionToken: "token-1",
      path: "/pastes/hello",
      text: "hello"
    });
  });

  it("sends private paste requests to the encrypted app APIs", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ content_id: "cid-private", size: 400, recipient_count: 2 }))
      .mockResolvedValueOnce(jsonResponse({
        content_id: "cid-private",
        path: "/pastes/secret",
        plaintext: [115, 101, 99, 114, 101, 116],
        size: 6,
        content_type: "text/plain"
      }));

    await publishPrivatePaste("token-1", "/pastes/secret", "secret", [
      "bob.jolt",
      "carol.jolt"
    ]);
    await decryptPaste("token-1", "alice.jolt/pastes/secret");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/app/v1/encrypted/publish",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token-1",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          path: "/pastes/secret",
          plaintext: [115, 101, 99, 114, 101, 116],
          content_type: "text/plain",
          recipients: ["bob.jolt", "carol.jolt"]
        })
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/app/v1/encrypted/decrypt",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token-1",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ target: "alice.jolt/pastes/secret" })
      })
    );
  });

  it("opens private pastes through one encrypted app API", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      content_id: "cid-private",
      path: "/pastes/secret",
      status: "decrypted",
      plaintext: [115, 101, 99, 114, 101, 116],
      ciphertext: null,
      size: 6,
      content_type: "text/plain",
      decrypt_error: null
    }));

    await openPrivatePaste("token-1", "alice.jolt/pastes/secret");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/app/v1/encrypted/open",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token-1",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ target: "alice.jolt/pastes/secret" })
      })
    );
  });

  it("does not send publish requests outside the /pastes scope", async () => {
    expect(() => publishPaste("token-1", "/profile", "nope")).toThrow(
      "Pastey can only publish under /pastes/"
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports self-only encrypted publish without explicit recipients", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ content_id: "cid-private", size: 400, recipient_count: 1 })
    );

    await publishPrivatePaste("token-1", "/pastes/secret", "nope", []);

    expect(fetch).toHaveBeenCalledWith(
      "/app/v1/encrypted/publish",
      expect.objectContaining({
        body: JSON.stringify({
          path: "/pastes/secret",
          plaintext: [110, 111, 112, 101],
          content_type: "text/plain",
          recipients: []
        })
      })
    );
  });

  it("does not send encrypted publish requests outside /pastes", async () => {
    expect(() => publishPrivatePaste("token-1", "/profile", "nope", ["bob.jolt"])).toThrow(
      "Pastey can only publish under /pastes/"
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it("detects stale app-session request ids from a fresh daemon", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          code: "app_session_not_found",
          error: "app session request not found: req_missing"
        },
        { status: 404 }
      )
    );

    await expect(getSessionRequestStatus("req_missing")).rejects.toSatisfy((error) =>
      isMissingAppSessionRequestError(error)
    );
  });
});
