import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASTEY_CAPABILITIES,
  fetchTarget,
  getStatus,
  listPublished,
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
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
  });

  afterEach(() => {
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
      "/jolt-api/sessions/request",
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

  it("uses the daemon status endpoint only for local identity discovery", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ identity_address: "alice.jolt" }));

    await expect(getStatus()).resolves.toEqual({ identity_address: "alice.jolt" });

    expect(fetch).toHaveBeenCalledWith("/jolt-daemon/status", undefined);
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
      "/jolt-api/published",
      expect.objectContaining({
        headers: { Authorization: "Bearer token-1" }
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/jolt-api/publish",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer token-1" },
        body: expect.any(FormData)
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/jolt-api/fetch",
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

  it("does not send publish requests outside the /pastes scope", async () => {
    expect(() => publishPaste("token-1", "/profile", "nope")).toThrow(
      "Pastey can only publish under /pastes/"
    );

    expect(fetch).not.toHaveBeenCalled();
  });
});
