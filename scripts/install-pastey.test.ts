import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("install-pastey", () => {
  let workDir: string | null = null;

  afterEach(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    workDir = null;
  });

  it("registers the installed AppImage and its icon with the Linux desktop", () => {
    workDir = mkdtempSync(join(tmpdir(), "pastey-installer-"));
    const fakeBinDir = join(workDir, "fake-bin");
    const fakeAppImage = join(workDir, "pastey.AppImage");
    const installDir = join(workDir, "bin");
    const stateDir = join(workDir, "state");
    const dataHome = join(workDir, "share");

    mkdirSync(fakeBinDir);
    writeFileSync(
      fakeAppImage,
      `#!/usr/bin/env bash
set -euo pipefail
[[ "\${1:-}" == "--appimage-extract" ]]
mkdir -p squashfs-root/usr/share/icons/hicolor/128x128/apps
printf 'pastey-icon' > squashfs-root/usr/share/icons/hicolor/128x128/apps/pastey.png
`
    );
    chmodSync(fakeAppImage, 0o755);

    const fakeCurl = join(fakeBinDir, "curl");
    writeFileSync(
      fakeCurl,
      `#!/usr/bin/env bash
set -euo pipefail
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then
    output="$2"
    shift 2
  else
    shift
  fi
done
cp "$PASTEY_TEST_APPIMAGE" "$output"
`
    );
    chmodSync(fakeCurl, 0o755);

    const runInstaller = () =>
      execFileSync("bash", ["scripts/install-pastey.sh"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBinDir}:${process.env.PATH}`,
          HOME: workDir,
          XDG_DATA_HOME: dataHome,
          PASTEY_VERSION: "v0.1.3",
          PASTEY_INSTALL_DIR: installDir,
          PASTEY_STATE_DIR: stateDir,
          PASTEY_TEST_APPIMAGE: fakeAppImage
        }
      });

    runInstaller();

    const desktopEntryPath = join(dataHome, "applications", "net.jolt.pastey.desktop");
    const iconPath = join(
      dataHome,
      "icons",
      "hicolor",
      "128x128",
      "apps",
      "net.jolt.pastey.png"
    );
    const desktopEntry = readFileSync(desktopEntryPath, "utf8");
    expect(desktopEntry).toContain("Name=Pastey");
    expect(desktopEntry).toContain(`Exec=${join(installDir, "pastey")}`);
    expect(desktopEntry).toContain("Icon=net.jolt.pastey");
    expect(desktopEntry).toContain("StartupWMClass=pastey");
    expect(readFileSync(iconPath, "utf8")).toBe("pastey-icon");

    rmSync(desktopEntryPath);
    rmSync(iconPath);
    runInstaller();

    expect(readFileSync(desktopEntryPath, "utf8")).toBe(desktopEntry);
    expect(readFileSync(iconPath, "utf8")).toBe("pastey-icon");
  });
});
