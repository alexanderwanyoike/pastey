import { readFileSync } from "node:fs";

const files = {
  workflow: readFileSync(".github/workflows/package-pastey.yml", "utf8"),
  installer: readFileSync("scripts/install-pastey.sh", "utf8"),
  packageScript: readFileSync("scripts/package-pastey.sh", "utf8"),
  normalizeArtifacts: readFileSync("scripts/normalize-pastey-artifacts.sh", "utf8"),
  assembleRelease: readFileSync("scripts/assemble-pastey-release.sh", "utf8"),
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
    "matrix:",
    "ubuntu-22.04",
    "macos-latest",
    "windows-latest",
    "scripts/package-pastey.sh",
    "scripts/normalize-pastey-artifacts.sh",
    "scripts/assemble-pastey-release.sh",
    "shell: bash",
    "pastey-x86_64.AppImage",
    "pastey-aarch64.dmg",
    "pastey-aarch64.app.tar.gz",
    "pastey-x86_64-setup.exe",
    "write-pastey-update-manifest.mjs",
    "softprops/action-gh-release",
    "refs/tags/"
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
    "target/release/bundle/dmg",
    "target/release/bundle/macos",
    "target/release/bundle/nsis",
    "BUNDLE_KIND",
    "--bundle",
    "PASTEY_CREATE_UPDATER_ARTIFACTS",
    "createUpdaterArtifacts",
    "app,dmg",
    "Prefetching Tauri AppImage helper binaries"
  ],
  normalizeArtifacts: [
    "Normalize Pastey package artifacts",
    "--bundle",
    "appimage",
    "dmg",
    "nsis",
    "target/release/bundle/appimage",
    "target/release/bundle/dmg",
    "target/release/bundle/macos",
    "target/release/bundle/nsis",
    "PASTEY_REQUIRE_UPDATER_ARTIFACTS",
    "sha256sum",
    "shasum -a 256"
  ],
  assembleRelease: [
    "Assemble normalized Pastey artifacts",
    "pastey-x86_64.AppImage",
    "pastey-x86_64.AppImage.sha256",
    "pastey-x86_64.AppImage.sig",
    "pastey-aarch64.dmg",
    "pastey-aarch64.dmg.sha256",
    "pastey-aarch64.app.tar.gz",
    "pastey-aarch64.app.tar.gz.sha256",
    "pastey-aarch64.app.tar.gz.sig",
    "pastey-x86_64-setup.exe",
    "pastey-x86_64-setup.exe.sha256",
    "pastey-x86_64-setup.exe.sig",
    "write-pastey-update-manifest.mjs",
    "latest.json",
    "linux-x86_64",
    "darwin-aarch64",
    "windows-x86_64"
  ],
  updateManifest: [
    "latest.json",
    "linux-x86_64",
    "darwin-aarch64",
    "windows-x86_64",
    "signature",
    "pastey-x86_64.AppImage",
    "pastey-aarch64.app.tar.gz",
    "pastey-x86_64-setup.exe"
  ],
  tauriConfig: [
    "icons/icon.png",
    "icons/icon.ico",
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
    "Packaged Pastey updates are signed and verified before installation",
    "pastey --appimage-help",
    "pastey-aarch64.dmg",
    "pastey-aarch64.app.tar.gz",
    "pastey-x86_64-setup.exe",
    "xattr -dr com.apple.quarantine"
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
