import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type PasteyUpdateAvailable = {
  available: true;
  version: string;
  currentVersion: string;
  notes?: string;
  date?: string;
};

export type PasteyUpdateUnavailable = {
  available: false;
  currentVersion?: string;
};

export type PasteyUpdateCheck = PasteyUpdateAvailable | PasteyUpdateUnavailable;

export type PasteyUpdateClient = {
  check(): Promise<PasteyUpdateCheck>;
  installAndRelaunch(): Promise<void>;
};

let pendingUpdate: Update | null = null;

export const tauriPasteyUpdateClient: PasteyUpdateClient = {
  async check() {
    const update = await check();
    pendingUpdate = update ?? null;

    if (!update) {
      return { available: false };
    }

    return {
      available: true,
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body,
      date: update.date
    };
  },

  async installAndRelaunch() {
    const update = pendingUpdate ?? (await check());
    if (!update) {
      throw new Error("No Pastey update is pending");
    }

    pendingUpdate = null;
    await update.downloadAndInstall();
    await relaunch();
  }
};
