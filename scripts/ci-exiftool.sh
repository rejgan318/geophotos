#!/usr/bin/env bash
# exiftool for GitHub Actions (tz.md, п. 9.3): a pinned version, checked against the SHA-256 that
# exiftool.org publishes (https://exiftool.org/checksums.txt), from SourceForge where exiftool.org
# links it; put into PATH. Windows: where the official installer puts it
# (%LOCALAPPDATA%\Programs\ExifTool — the exiftool-install test packs it from there). Linux: the Perl
# distribution, run by the system Perl.
set -euo pipefail

VERSION=13.64
SHA_WIN=72c29c44d1e860eebcaefa71692d979af9858fe9a6d7d791a5e7f1dac77804af
SHA_PERL=dcb9f6be1f6705ee826a92d1522e3fec1d0b3749cdc061b03c46873d5fe204fc

fetch() { # file sha
  curl -fsSL --retry 3 -o "$RUNNER_TEMP/$1" "https://sourceforge.net/projects/exiftool/files/$1/download"
  echo "$2  $RUNNER_TEMP/$1" | sha256sum -c -
}

case "$RUNNER_OS" in
  Windows)
    file="exiftool-${VERSION}_64.zip"
    fetch "$file" "$SHA_WIN"
    /c/Windows/System32/tar.exe -xf "$(cygpath -w "$RUNNER_TEMP/$file")" -C "$(cygpath -w "$RUNNER_TEMP")"
    dir="$(cygpath -u "$LOCALAPPDATA")/Programs/ExifTool"
    mkdir -p "$dir"
    cp "$RUNNER_TEMP/exiftool-${VERSION}_64/exiftool(-k).exe" "$dir/exiftool.exe"
    cp -r "$RUNNER_TEMP/exiftool-${VERSION}_64/exiftool_files" "$dir/"
    cygpath -w "$dir" >> "$GITHUB_PATH"
    "$dir/exiftool.exe" -ver
    ;;
  Linux)
    file="Image-ExifTool-${VERSION}.tar.gz"
    fetch "$file" "$SHA_PERL"
    tar -xzf "$RUNNER_TEMP/$file" -C "$RUNNER_TEMP"
    echo "$RUNNER_TEMP/Image-ExifTool-${VERSION}" >> "$GITHUB_PATH"
    "$RUNNER_TEMP/Image-ExifTool-${VERSION}/exiftool" -ver
    ;;
  *)
    echo "Unsupported runner: $RUNNER_OS" >&2
    exit 1
    ;;
esac
