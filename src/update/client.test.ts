import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { JoltTransportError } from "jolt-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tauriPasteyUpdateClient } from "./client";

const checkPasteyCompatibility = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn()
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn()
}));

vi.mock("../api", () => ({
  PASTEY_COMPATIBILITY: {
    appApi: 1,
    requiredFeatures: {},
    optionalFeatures: {}
  },
  checkPasteyCompatibility
}));

describe("tauriPasteyUpdateClient", () => {
  beforeEach(() => {
    vi.mocked(check).mockReset();
    vi.mocked(relaunch).mockReset();
    checkPasteyCompatibility.mockReset();
    checkPasteyCompatibility.mockResolvedValue({
      status: "compatible",
      manifest: { appApi: 1, features: {}, discovery: "advertised" },
      appApi: { requiredLevel: 1, availableLevel: 1, supported: true },
      requiredFeatures: {},
      optionalFeatures: {}
    });
  });

  it("reports no update when the Tauri updater returns none", async () => {
    vi.mocked(check).mockResolvedValueOnce(null);

    await expect(tauriPasteyUpdateClient.check()).resolves.toEqual({ available: false });
  });

  it("installs the pending signed update and relaunches Pastey", async () => {
    const update = {
      version: "0.2.0",
      currentVersion: "0.1.0",
      body: "Release notes",
      date: "2026-06-09T12:00:00Z",
      downloadAndInstall: vi.fn(async () => undefined)
    };
    vi.mocked(check).mockResolvedValueOnce(update as never);

    await expect(tauriPasteyUpdateClient.check()).resolves.toMatchObject({
      available: true,
      version: "0.2.0",
      currentVersion: "0.1.0",
      notes: "Release notes",
      date: "2026-06-09T12:00:00Z",
      compatibility: { status: "compatible" }
    });

    await tauriPasteyUpdateClient.installAndRelaunch();

    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("keeps an incompatible signed update pending without downloading it", async () => {
    const update = {
      version: "0.3.0",
      currentVersion: "0.2.0",
      body: "Requires document deletion",
      rawJson: {
        app_compatibility: {
          app_api: 1,
          required_features: { "data.tombstones": 1 },
          optional_features: {}
        }
      },
      downloadAndInstall: vi.fn(async () => undefined)
    };
    vi.mocked(check).mockResolvedValueOnce(update as never);
    checkPasteyCompatibility.mockResolvedValue({ status: "incompatible" });

    await expect(tauriPasteyUpdateClient.check()).resolves.toMatchObject({
      available: true,
      compatibility: { status: "incompatible" }
    });
    expect(checkPasteyCompatibility).toHaveBeenCalledWith(
      {
        appApi: 1,
        requiredFeatures: { "data.tombstones": 1 },
        optionalFeatures: {}
      },
      { refresh: true }
    );
    await expect(tauriPasteyUpdateClient.installAndRelaunch()).rejects.toThrow(
      "This Pastey update requires newer Jolt App API features"
    );

    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("keeps Jolt unavailability distinct from an incompatible update", async () => {
    const update = {
      version: "0.3.0",
      currentVersion: "0.2.0",
      body: "Compatible after Jolt reconnects",
      rawJson: {
        app_compatibility: {
          app_api: 1,
          required_features: {},
          optional_features: {}
        }
      },
      downloadAndInstall: vi.fn(async () => undefined)
    };
    vi.mocked(check).mockResolvedValueOnce(update as never);
    checkPasteyCompatibility.mockRejectedValue(
      new JoltTransportError("Cannot reach the Jolt daemon")
    );

    await expect(tauriPasteyUpdateClient.check()).resolves.toMatchObject({
      available: true,
      compatibility: { status: "unavailable" }
    });
    await expect(tauriPasteyUpdateClient.installAndRelaunch()).rejects.toThrow(
      "Cannot verify this Pastey update until Jolt is available"
    );

    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("does not weaken malformed compatibility metadata", async () => {
    const update = {
      version: "0.4.0",
      currentVersion: "0.3.0",
      rawJson: {
        app_compatibility: {
          app_api: "2",
          required_features: {},
          optional_features: {}
        }
      },
      downloadAndInstall: vi.fn(async () => undefined)
    };
    vi.mocked(check).mockResolvedValue(update as never);

    await expect(tauriPasteyUpdateClient.check()).rejects.toThrow(
      "Pastey update has invalid app_compatibility metadata"
    );
    await expect(tauriPasteyUpdateClient.installAndRelaunch()).rejects.toThrow(
      "Pastey update has invalid app_compatibility metadata"
    );

    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("does not treat present primitive compatibility metadata as absent", async () => {
    const update = {
      version: "0.4.0",
      currentVersion: "0.3.0",
      rawJson: { app_compatibility: "invalid" },
      downloadAndInstall: vi.fn(async () => undefined)
    };
    vi.mocked(check).mockResolvedValue(update as never);

    await expect(tauriPasteyUpdateClient.check()).rejects.toThrow(
      "Pastey update has invalid app_compatibility metadata"
    );
    expect(checkPasteyCompatibility).not.toHaveBeenCalled();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });
});
