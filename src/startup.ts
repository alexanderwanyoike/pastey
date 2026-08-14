import type { AppCompatibilityResult } from "jolt-sdk";
import { PASTEY_COMPATIBILITY, checkPasteyCompatibility } from "./api";
import { isJoltUnavailableError } from "./jolt-errors";

export type PasteyStartupCompatibility =
  | AppCompatibilityResult
  | { status: "unavailable" };

export async function enterPasteyRuntime(
  continueStartup: () => Promise<void>
): Promise<PasteyStartupCompatibility> {
  try {
    const compatibility = await checkPasteyCompatibility(PASTEY_COMPATIBILITY, { refresh: true });
    if (compatibility.status === "compatible") {
      await continueStartup();
    }
    return compatibility;
  } catch (error) {
    if (isJoltUnavailableError(error)) {
      return { status: "unavailable" };
    }
    throw error;
  }
}
