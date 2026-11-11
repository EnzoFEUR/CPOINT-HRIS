#!/usr/bin/env bash
set -euo pipefail

if [ ! -x /usr/lib/postgresql/17/bin/pg_dump ]; then
    sudo apt-get update -qq
    sudo apt-get install -y postgresql-common curl ca-certificates
    sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
    sudo apt-get update -qq
    sudo apt-get install -y postgresql-client-17
fi
printf '%s\n' /usr/lib/postgresql/17/bin >> "$GITHUB_PATH"

tool_dir="$RUNNER_TEMP/cpoint-tools"
mkdir -p "$tool_dir"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_linux_amd64.bz2 \
    --output "$tool_dir/restic.bz2"
printf '%s  %s\n' f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c "$tool_dir/restic.bz2" | sha256sum --check --status
bzip2 --decompress --stdout "$tool_dir/restic.bz2" > "$tool_dir/restic"
chmod 700 "$tool_dir/restic"
printf '%s\n' "$tool_dir" >> "$GITHUB_PATH"
"$tool_dir/restic" version
/usr/lib/postgresql/17/bin/pg_dump --version
