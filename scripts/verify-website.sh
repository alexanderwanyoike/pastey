#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

required=(
  website/index.html
  website/styles.css
  website/script.js
  website/favicon.svg
  website/jolt-mark.svg
  website/fonts/geist-latin-wght-normal.woff2
  website/fonts/Geist-LICENSE.txt
)
for file in "${required[@]}"; do
  test -s "$file" || { echo "missing website file: $file" >&2; exit 1; }
done

required_privacy_contract=(
  '@font-face'
  'font-family: "Geist Variable"'
  'url("fonts/geist-latin-wght-normal.woff2") format("woff2-variations")'
)

for value in "${required_privacy_contract[@]}"; do
  grep -Fq "$value" website/styles.css || {
    echo "missing self-hosted font contract: $value" >&2
    exit 1
  }
done

for value in \
  'fonts.googleapis.com' \
  'fonts.gstatic.com'; do
  if grep -Fq "$value" website/index.html website/styles.css; then
    echo "premature or third-party website dependency remains: $value" >&2
    exit 1
  fi
done

grep -Fq 'https://alexanderwanyoike.github.io/jolt/' website/index.html || {
  echo "website does not link back to the Jolt Pages site" >&2
  exit 1
}
grep -Fq 'https://alexanderwanyoike.github.io/jolt/#download' website/index.html || {
  echo "website does not send Jolt installs to the Pages download section" >&2
  exit 1
}

for value in \
  'href="https://github.com/alexanderwanyoike/jolt"' \
  'href="https://github.com/alexanderwanyoike/jolt/releases/latest"'; do
  if grep -Fq "$value" website/index.html; then
    echo "Jolt link bypasses the branded Pages site: $value" >&2
    exit 1
  fi
done

grep -Fq 'class="jolt-button-mark" src="jolt-mark.svg"' website/index.html || {
  echo "primary Jolt action does not carry the Jolt mark" >&2
  exit 1
}

expected_jolt_mark_sha='5ae675c21fdeb4cb469956d0a6d8546acaceeffd721589f94fccadcf57e7deec'
actual_jolt_mark_sha="$(sha256sum website/jolt-mark.svg | cut -d' ' -f1)"
test "$actual_jolt_mark_sha" = "$expected_jolt_mark_sha" || {
  echo "website Jolt mark does not match the approved Jolt logo" >&2
  exit 1
}

required_brand_palette=(
  '#f3efe5'
  '#245e4a'
  '#e9684f'
)
for value in "${required_brand_palette[@]}"; do
  grep -Fq "$value" website/favicon.svg || {
    echo "favicon does not carry the Pastey brand palette: $value" >&2
    exit 1
  }
done

required_jolt_dependency_contract=(
  'A Jolt app · requires Jolt ↗'
  'Pastey cannot run standalone.'
  'aria-label="Learn about Jolt"'
  'class="jolt-prerequisite reveal"'
)

for value in "${required_jolt_dependency_contract[@]}"; do
  grep -Fq "$value" website/index.html || {
    echo "missing explicit Jolt dependency contract: $value" >&2
    exit 1
  }
done

jolt_release_link_count="$(grep -Fc 'https://alexanderwanyoike.github.io/jolt/#download' website/index.html)"
test "$jolt_release_link_count" -ge 3 || {
  echo "Jolt prerequisite is not linked at every install decision point" >&2
  exit 1
}

em_dash="$(printf '\342\200\224')"
for file in website/index.html website/styles.css website/script.js scripts/verify-website.sh; do
  if grep -Fq "$em_dash" "$file"; then
    echo "house-style em dash remains in $file" >&2
    exit 1
  fi
done

python3 - <<'PY'
from pathlib import Path

font = Path("website/fonts/geist-latin-wght-normal.woff2")
if font.read_bytes()[:4] != b"wOF2":
    raise SystemExit(f"self-hosted Geist asset is not WOFF2: {font}")
PY

required_download_contract=(
  'https://github.com/alexanderwanyoike/pastey/releases/latest/download/pastey-x86_64.AppImage'
  'https://github.com/alexanderwanyoike/pastey/releases/latest/download/pastey-aarch64.dmg'
  'https://github.com/alexanderwanyoike/pastey/releases/latest/download/pastey-x86_64-setup.exe'
  'https://github.com/alexanderwanyoike/pastey/releases/latest'
  'xattr -dr com.apple.quarantine "/Applications/Pastey.app"'
)

for value in "${required_download_contract[@]}"; do
  grep -Fq "$value" website/index.html || {
    echo "missing website download contract: $value" >&2
    exit 1
  }
done

required_honesty_contract=(
  'Share the paste.<br /><em>Keep the keys.</em>'
  '<meta property="og:title" content="Pastey | Share the paste. Keep the keys." />'
  'Encrypted pastes stay private to you or the recipients you name.'
  'Relays only ever see ciphertext.'
  'one of the first two apps built on Jolt'
  'Pastey uses Jolt. It never touches your keys.'
  'JOLT NETWORK'
  'PUBLIC · SIGNED'
  'ENCRYPTED · SEALED'
  'RELAYS HOLD CIPHERTEXT'
)

for value in "${required_honesty_contract[@]}"; do
  grep -Fq "$value" website/index.html || {
    echo "missing application-accurate landing page contract: $value" >&2
    exit 1
  }
done

grep -Fq 'gh release view' .github/workflows/pages.yml || {
  echo "Pages workflow does not validate the latest published release" >&2
  exit 1
}

python3 - <<'PY'
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

root = Path("website")
html_files = list(root.rglob("*.html"))

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
    def handle_starttag(self, tag, attrs):
        if tag in {"a", "link", "script"}:
            values = dict(attrs)
            target = values.get("href") or values.get("src")
            if target:
                self.links.append(target)

for page in html_files:
    parser = Links()
    parser.feed(page.read_text())
    for link in parser.links:
        split = urlsplit(link)
        if split.scheme or link.startswith(("#", "//")):
            continue
        target = (page.parent / split.path).resolve()
        if split.path.endswith("/") or (target.exists() and target.is_dir()):
            target = target / "index.html"
        if not target.exists():
            raise SystemExit(f"broken local link in {page}: {link}")

print(f"verified {len(html_files)} HTML page")
PY
