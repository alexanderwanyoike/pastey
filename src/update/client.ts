import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  decodeAppCompatibilityDeclaration,
  type AppCompatibilityDeclaration,
  type AppCompatibilityResult
} from "jolt-sdk";
import { PASTEY_COMPATIBILITY, checkPasteyCompatibility } from "../api";
import { isJoltUnavailableError } from "../jolt-errors";

export type PasteyUpdateAvailable = {
  available: true;
  version: string;
  currentVersion: string;
  notes?: string;
  date?: string;
  compatibility: PasteyUpdateCompatibility;
};

export type PasteyUpdateCompatibility = AppCompatibilityResult | { status: "unavailable" };

export type PasteyUpdateUnavailable = {
  available: false;
  currentVersion?: string;
};

export type PasteyUpdateCheck = PasteyUpdateAvailable | PasteyUpdateUnavailable;

export type PasteyUpdateClient = {
  check(): Promise<PasteyUpdateCheck>;
  installAndRelaunch(): Promise<void>;
};

type PendingPasteyUpdate = {
  update: Update;
  compatibility: PasteyUpdateCompatibility;
};

let pendingUpdate: PendingPasteyUpdate | null = null;

function compatibilityDeclaration(update: Update): AppCompatibilityDeclaration {
  const raw = update.rawJson?.app_compatibility;
  // Manifests published before compatibility metadata use this build's baseline.
  if (raw === undefined) return PASTEY_COMPATIBILITY;

  try {
    return decodeAppCompatibilityDeclaration(raw);
  } catch {
    throw new Error("Pastey update has invalid app_compatibility metadata");
  }
}

async function inspectUpdate(update: Update): Promise<PendingPasteyUpdate> {
  try {
    const compatibility = await checkPasteyCompatibility(compatibilityDeclaration(update), {
      refresh: true
    });
    return { update, compatibility };
  } catch (error) {
    if (isJoltUnavailableError(error)) {
      return { update, compatibility: { status: "unavailable" } };
    }
    throw error;
  }
}

export const tauriPasteyUpdateClient: PasteyUpdateClient = {
  async check() {
    pendingUpdate = null;
    const update = await check();
    if (!update) {
      return { available: false };
    }
    const inspected = await inspectUpdate(update);
    pendingUpdate = inspected;

    return {
      available: true,
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body,
      date: update.date,
      compatibility: inspected.compatibility
    };
  },

  async installAndRelaunch() {
    if (!pendingUpdate) {
      const update = await check();
      pendingUpdate = update ? await inspectUpdate(update) : null;
    }
    if (!pendingUpdate) {
      throw new Error("No Pastey update is pending");
    }
    if (pendingUpdate.compatibility.status === "incompatible") {
      throw new Error("This Pastey update requires newer Jolt App API features");
    }
    if (pendingUpdate.compatibility.status === "unavailable") {
      throw new Error("Cannot verify this Pastey update until Jolt is available");
    }

    const { update } = pendingUpdate;
    pendingUpdate = null;
    await update.downloadAndInstall();
    await relaunch();
  }
};
