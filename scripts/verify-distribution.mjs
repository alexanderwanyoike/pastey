import { readFileSync } from "node:fs";

const files = {
  workflow: readFileSync(".github/workflows/package-pastey.yml", "utf8"),
  installer: readFileSync("scripts/install-pastey.sh", "utf8"),
  packageScript: readFileSync("scripts/package-pastey.sh", "utf8"),
  updateManifest: readFileSync("scripts/write-pastey-update-manifest.mjs", "utf8"),
  tauriConfig: readFileSync("src-tauri/tauri.conf.json", "utf8"),
  tauriCargo: readFileSync("src-tauri/Cargo.toml", "utf8"),
  tauriLib: readFileSync("src-tauri/src/lib.rs", "utf8"),
  packageJson: readFileSync("package.json", "utf8"),
  app: readFileSync("src/App.tsx", "utf8"),
  updateClient: readFileSync("src/update/client.ts", "utf8"),
  readme: readFileSync("README.md", "utf8")
};

const requiredMarkers = {
  workflow: [
    "Package Pastey",
    "scripts/package-pastey.sh",
    "pastey-x86_64.AppImage",
    "pastey-x86_64.AppImage.sig",
    "latest.json",
    "write-pastey-update-manifest.mjs",
    "softprops/action-gh-release"
  ],
  installer: [
    "PASTEY_VERSION",
    "PASTEY_INSTALL_DIR",
    "pastey-x86_64.AppImage",
    "releases/latest",
    "releases/download",
    "--check",
    "--update",
    "--force",
    "--dry-run"
  ],
  packageScript: [
    "target/release/bundle/appimage",
    "PASTEY_CREATE_UPDATER_ARTIFACTS",
    "createUpdaterArtifacts",
    "Prefetching Tauri AppImage helper binaries"
  ],
  updateManifest: [
    "latest.json",
    "linux-x86_64",
    "signature",
    "pastey-x86_64.AppImage"
  ],
  tauriConfig: [
    "\"updater\"",
    "\"pubkey\"",
    "https://github.com/alexanderwanyoike/pastey/releases/latest/download/latest.json"
  ],
  tauriCargo: ["tauri-plugin-updater"],
  tauriLib: ["tauri_plugin_updater::Builder"],
  packageJson: ["@tauri-apps/plugin-updater", "@tauri-apps/plugin-process"],
  app: ["checkPasteyUpdate", "installPasteyUpdate", "Update available"],
  updateClient: ["check()", "downloadAndInstall", "relaunch"],
  readme: [
    "curl -fsSL",
    "scripts/install-pastey.sh",
    "Jolt Console",
    "Do not commit or document private signing key material",
    "pastey --appimage-help"
  ]
};

for (const [fileName, markers] of Object.entries(requiredMarkers)) {
  for (const marker of markers) {
    if (!files[fileName].includes(marker)) {
      throw new Error(`Missing Pastey distribution marker in ${fileName}: ${marker}`);
    }
  }
}

console.log("Pastey distribution contract verified");
