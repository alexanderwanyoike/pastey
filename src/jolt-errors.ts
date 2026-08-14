import { JoltApiError, JoltTransportError } from "jolt-sdk";

export function isJoltUnavailableError(error: unknown) {
  return (
    error instanceof JoltTransportError ||
    error instanceof TypeError ||
    (error instanceof JoltApiError && (error.status === 500 || error.status === 502))
  );
}
