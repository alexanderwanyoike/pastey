#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);

if (args.length !== 3 && (args.length < 5 || (args.length - 2) % 3 !== 0)) {
  console.error(
    [
      "Usage:",
      "  scripts/write-pastey-update-manifest.mjs <tag> <signature-path> <output-path, usually latest.json>",
      "  scripts/write-pastey-update-manifest.mjs <tag> <output-path> <platform> <signature-path> <asset-name> [...]"
    ].join("\n")
  );
  process.exit(2);
}

const repo = process.env.PASTEY_REPO ?? "alexanderwanyoike/pastey";
const supportedPlatforms = new Set(["linux-x86_64", "darwin-aarch64", "windows-x86_64"]);
const defaultPlatformAssets = {
  "linux-x86_64": "pastey-x86_64.AppImage",
  "darwin-aarch64": "pastey-aarch64.app.tar.gz",
  "windows-x86_64": "pastey-x86_64-setup.exe"
};
const [tag] = args;
const version = tag.replace(/^v/, "");
const pubDate = process.env.PASTEY_RELEASE_PUB_DATE ?? new Date().toISOString();
const releaseNotes = process.env.PASTEY_RELEASE_NOTES ?? `Pastey ${tag} signed update.`;
let outputPath;
let platformInputs;

if (args.length === 3) {
  const [, signaturePath, legacyOutputPath] = args;
  const assetName = process.env.PASTEY_ASSET_NAME ?? defaultPlatformAssets["linux-x86_64"];
  outputPath = legacyOutputPath;
  platformInputs = [["linux-x86_64", signaturePath, assetName]];
} else {
  outputPath = args[1];
  platformInputs = [];
  for (let index = 2; index < args.length; index += 3) {
    platformInputs.push([args[index], args[index + 1], args[index + 2]]);
  }
}

const platforms = {};

for (const [platform, signaturePath, assetName] of platformInputs) {
  if (!supportedPlatforms.has(platform)) {
    console.error(`Unsupported updater platform: ${platform}`);
    process.exit(2);
  }

  const signature = readFileSync(signaturePath, "utf8").trim();

  if (!signature) {
    console.error(`Updater signature is empty: ${signaturePath}`);
    process.exit(1);
  }

  platforms[platform] = {
    signature,
    url: `https://github.com/${repo}/releases/download/${tag}/${assetName}`
  };
}

const manifest = {
  version,
  notes: releaseNotes,
  pub_date: pubDate,
  platforms
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
