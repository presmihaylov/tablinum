#!/bin/sh
# gitdocs container entrypoint: prepare /data and the git identity, then exec.
set -eu

CONTENT_DIR="${GITDOCS_CONTENT_DIR:-/data/content}"
SSH_DIR="${HOME:-/home/node}/.ssh"

mkdir -p "$CONTENT_DIR"

# The volume may be owned by another uid than the one git runs as; without this
# git refuses to touch the repo with "detected dubious ownership".
if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq "$CONTENT_DIR"; then
  git config --global --add safe.directory "$CONTENT_DIR" >/dev/null 2>&1 || true
fi
git config --global --get user.name  >/dev/null 2>&1 || \
  git config --global user.name  "${GITDOCS_GIT_AUTHOR_NAME:-gitdocs}"
git config --global --get user.email >/dev/null 2>&1 || \
  git config --global user.email "${GITDOCS_GIT_AUTHOR_EMAIL:-gitdocs@localhost}"
git config --global init.defaultBranch "${GITDOCS_GIT_BRANCH:-main}" >/dev/null 2>&1 || true

# An SSH remote needs the host key up front, otherwise the first pull hangs on a
# prompt that nobody can answer.
if [ -n "${GITDOCS_SSH_KNOWN_HOSTS:-}" ]; then
  mkdir -p "$SSH_DIR"
  chmod 700 "$SSH_DIR"
  printf '%s\n' "$GITDOCS_SSH_KNOWN_HOSTS" > "$SSH_DIR/known_hosts"
  chmod 600 "$SSH_DIR/known_hosts"
fi
if [ -z "${GIT_SSH_COMMAND:-}" ] && [ -f "$SSH_DIR/id_ed25519" ]; then
  GIT_SSH_COMMAND="ssh -i $SSH_DIR/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes"
  export GIT_SSH_COMMAND
fi

# The default command points at apps/server/dist/server.js. Fall back to the
# other plausible entry filenames so a rename in apps/server does not produce an
# image that cannot boot.
if [ "$#" -eq 2 ] && [ "$1" = "node" ] && [ ! -f "$2" ]; then
  found=""
  for candidate in /app/apps/server/dist/server.js \
                   /app/apps/server/dist/main.js \
                   /app/apps/server/dist/start.js \
                   /app/apps/server/dist/src/server.js; do
    if [ -f "$candidate" ]; then
      found="$candidate"
      break
    fi
  done
  if [ -z "$found" ]; then
    echo "gitdocs: no server entry point found. Looked for $2 and the dist/ fallbacks." >&2
    exit 1
  fi
  set -- node "$found"
fi

exec "$@"
