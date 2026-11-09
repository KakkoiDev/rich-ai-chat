#!/bin/zsh
# Deploy a committed revision of Rich AI Chat to the live copy that Tailscale Home runs
# (/Library/Application Support/Rich AI Chat, port 3212), keeping the previous build for rollback.
#   zsh scripts/deploy-live.sh [revision, default origin/main]
#   zsh scripts/deploy-live.sh --prepare REVISION DIRECTORY
#   zsh scripts/deploy-live.sh --install DIRECTORY
# The build runs as you; only copying into the root-owned live folder uses sudo. The .env is appended to, never read
# or printed. Start the chat afterwards from the Tailscale Home page (Rich AI Chat → Start).
set -euo pipefail
repo=${0:A:h:h}
live="/Library/Application Support/Rich AI Chat"
build=.next-local/breadth-stability-11 # the build folder Tailscale Home starts
mode=${1:-}
if [[ "$mode" == --install ]]; then
  install_dir=${2:?Pass the prepared directory}
  stage=${install_dir:A}
  sha=$(cat "$stage/DEPLOY_REVISION")
  git -C "$repo" cat-file -e "$sha^{commit}"
  test -s "$stage/$build/BUILD_ID"
else
  if [[ "$mode" == --prepare ]]; then
    revision=${2:?Pass a committed revision}
    prepare_dir=${3:?Pass a new directory}
    stage=${prepare_dir:A}
    mkdir "$stage"
  else
    revision=${1:-origin/main}
    stage=$(mktemp -d "${TMPDIR:-/tmp}/rich-chat-deploy.XXXXXX")
    trap 'rm -rf "$stage"' EXIT
  fi
  if [[ "$revision" == origin/* ]]; then
    git -C "$repo" fetch -q origin
  fi
  sha=$(git -C "$repo" rev-parse --verify "$revision^{commit}")
  echo "== Build ${sha:0:7} in $stage"
  git -C "$repo" archive "$sha" | tar -x -C "$stage"
  if [[ -d "$repo/node_modules" ]] && cmp -s "$repo/package-lock.json" "$stage/package-lock.json" \
    && (cd "$repo" && npm ls --depth=0 >/dev/null 2>&1); then
    cp -cR "$repo/node_modules" "$stage/node_modules"
  else
    (cd "$stage" && npm ci --no-audit --no-fund)
  fi
  (cd "$stage" && RICH_CHAT_BUILD_DIR=$build NEXT_TELEMETRY_DISABLED=1 npm run build >"$stage/build.log" 2>&1) \
    || { tail -30 "$stage/build.log"; exit 1; }
  if [[ "$mode" == --prepare ]]; then
    printf '%s\n' "$sha" > "$stage/DEPLOY_REVISION"
    echo "Prepared ${sha:0:7}; run --install with $stage"
    exit 0
  fi
fi
git -C "$repo" diff --quiet "$(cat "$live/REVISION")" "$sha" -- package-lock.json \
  || echo "note: package-lock.json changed since the live revision; the live node_modules is kept as it is"

echo "== Copy into the live folder (sudo)"
sudo rsync -a --exclude node_modules --exclude .env --exclude logs --exclude .next-local --exclude build.log --exclude DEPLOY_REVISION "$stage/" "$live/"
if [ -d "$live/$build" ]; then
  sudo rm -rf "$live/$build.before-${sha:0:7}"
  sudo mv "$live/$build" "$live/$build.before-${sha:0:7}"
fi
sudo cp -R "$stage/$build" "$live/$build"
echo "$sha" | sudo tee "$live/REVISION" >/dev/null

echo "== Export origin for Install as app"
if ! grep -q '^RICH_CHAT_EXPORT_ORIGIN=' "$live/.env"; then
  host=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
  printf '\nRICH_CHAT_EXPORT_ORIGIN=https://%s:3216\n' "$host" >> "$live/.env"
  echo "added RICH_CHAT_EXPORT_ORIGIN (port 3216)"
else
  echo "RICH_CHAT_EXPORT_ORIGIN already set"
fi
echo "Deployed ${sha:0:7}. Rollback: sudo mv the .before-${sha:0:7} build back to $build."
echo "Now start Rich AI Chat from the Tailscale Home page."
