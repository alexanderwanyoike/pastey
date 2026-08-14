import { beforeEach, describe, expect, it, vi } from "vitest";
import { JoltApiError, JoltTransportError } from "jolt-sdk";

const checkPasteyCompatibility = vi.hoisted(() => vi.fn());

vi.mock("./api", () => ({
  PASTEY_COMPATIBILITY: {
    appApi: 1,
    requiredFeatures: {},
    optionalFeatures: {}
  },
  checkPasteyCompatibility
}));

import { enterPasteyRuntime } from "./startup";

describe("Pastey startup compatibility gate", () => {
  beforeEach(() => {
    checkPasteyCompatibility.mockReset();
  });

  it("enters the runtime only after compatibility is confirmed", async () => {
    const continueStartup = vi.fn(async () => undefined);
    checkPasteyCompatibility.mockResolvedValue({ status: "compatible" });

    await expect(enterPasteyRuntime(continueStartup)).resolves.toEqual({
      status: "compatible"
    });
    expect(continueStartup).toHaveBeenCalledOnce();
    expect(checkPasteyCompatibility.mock.invocationCallOrder[0]).toBeLessThan(
      continueStartup.mock.invocationCallOrder[0]
    );
  });

  it("does not enter the runtime when the installed Pastey build is incompatible", async () => {
    const continueStartup = vi.fn(async () => undefined);
    checkPasteyCompatibility.mockResolvedValue({ status: "incompatible" });

    await expect(enterPasteyRuntime(continueStartup)).resolves.toEqual({
      status: "incompatible"
    });

    expect(checkPasteyCompatibility).toHaveBeenCalledWith(
      {
        appApi: 1,
        requiredFeatures: {},
        optionalFeatures: {}
      },
      { refresh: true }
    );
    expect(continueStartup).not.toHaveBeenCalled();
  });

  it("reports an unavailable daemon without describing it as incompatible", async () => {
    const continueStartup = vi.fn(async () => undefined);
    checkPasteyCompatibility.mockRejectedValue(
      new JoltTransportError("Cannot reach the Jolt daemon")
    );

    await expect(enterPasteyRuntime(continueStartup)).resolves.toEqual({
      status: "unavailable"
    });
    expect(continueStartup).not.toHaveBeenCalled();
  });

  it("treats a failed web proxy as unavailable", async () => {
    const continueStartup = vi.fn(async () => undefined);
    checkPasteyCompatibility.mockRejectedValue(
      new JoltApiError("Bad gateway", { status: 502 })
    );

    await expect(enterPasteyRuntime(continueStartup)).resolves.toEqual({
      status: "unavailable"
    });
    expect(continueStartup).not.toHaveBeenCalled();
  });
});
