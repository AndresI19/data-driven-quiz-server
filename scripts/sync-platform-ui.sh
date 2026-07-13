#!/usr/bin/env bash
# Pull the shared design system (@platform/ui) into this repo.
#
# @platform/ui lives in portfolio-home, which is the source of truth for it. This repo consumes it by
# vendoring portfolio-home as a git SUBMODULE at vendor/portfolio-home, and package.json depends on
# the package by path (`file:vendor/portfolio-home/packages/platform-ui`).
#
# A submodule is a PINNED COMMIT, not a branch. That is the point — it is what makes this repo's
# build reproducible — but it also means a change to the design system does not reach this app until
# somebody moves the pin. Until then the two sites silently drift apart, which is exactly the failure
# the shared package was created to prevent. Moving the pin by hand is three commands nobody
# remembers, so it is this script instead:
#
#     npm run ui:sync          # fast-forward the pin to upstream main, show what changed
#     npm run ui:sync -- --check   # read-only: is the pin behind? (used by prebuild)
#
# The pin is NOT moved automatically at build time. A build that silently pulls whatever is on main
# is not reproducible: the same source tree would produce different output on different days, and a
# broken upstream commit would break this app's build with no local change to explain it. Pulling is
# a deliberate act that produces a reviewable commit.
set -euo pipefail

cd "$(dirname "$0")/.."
SUB=vendor/portfolio-home
PKG="$SUB/packages/platform-ui"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

# The submodule not being checked out at all is the single most common way this repo fails to build:
# `npm ci` dies on the `file:` dependency with an error that says nothing about submodules.
if [ ! -f "$PKG/package.json" ]; then
  if [ "$CHECK" = 1 ]; then
    echo "error: @platform/ui is missing — the vendor/ submodule is not checked out." >&2
    echo "       run:  git submodule update --init --recursive" >&2
    exit 1
  fi
  echo "==> submodule not initialised; checking it out"
  git submodule update --init --recursive
fi

# THE CHECK MUST NEVER BREAK A BUILD IT CANNOT HELP.
#
# `prebuild` runs this with --check, which means it also runs inside the Docker image build, in CI,
# and in any clone made from a tarball. In those places there is no .git (the Dockerfile copies the
# vendored FILES, not the submodule's git metadata) and often no network. A check that *requires*
# git and a fetch would turn a friendly "you are a few commits behind" into a hard build failure in
# precisely the environments where nobody can act on it. So: if we cannot check, we say nothing.
if [ ! -e "$SUB/.git" ] || ! git -C "$SUB" rev-parse HEAD >/dev/null 2>&1; then
  [ "$CHECK" = 1 ] && exit 0
  echo "error: $SUB is present but is not a git submodule here (no .git)." >&2
  echo "       This is normal inside a container. Run ui:sync from a real clone." >&2
  exit 1
fi

if ! git -C "$SUB" fetch --quiet origin 2>/dev/null; then
  [ "$CHECK" = 1 ] && exit 0   # offline: cannot compare, so do not complain
  echo "error: could not fetch upstream — check your network." >&2
  exit 1
fi

PINNED="$(git -C "$SUB" rev-parse HEAD)"
UPSTREAM="$(git -C "$SUB" rev-parse origin/main 2>/dev/null || git -C "$SUB" rev-parse origin/HEAD)"

if [ "$PINNED" = "$UPSTREAM" ]; then
  echo "@platform/ui is up to date (${PINNED:0:7})"
  exit 0
fi

BEHIND="$(git -C "$SUB" rev-list --count "$PINNED..$UPSTREAM" 2>/dev/null || echo '?')"

if [ "$CHECK" = 1 ]; then
  # A warning, not an error. Being behind is a normal state — the pin is deliberate — so this must
  # not fail a build. It exists so that "why doesn't my design-system change show up here?" is
  # answered by the build output instead of by an afternoon.
  echo "note: @platform/ui is $BEHIND commit(s) behind upstream (${PINNED:0:7} → ${UPSTREAM:0:7})."
  echo "      run 'npm run ui:sync' to pull it in."
  exit 0
fi

echo "==> @platform/ui: ${PINNED:0:7} → ${UPSTREAM:0:7} ($BEHIND commit(s))"
echo
echo "    What changes in the package itself:"
# Only the package matters here. portfolio-home is vendored whole (it is the submodule), but this app
# consumes exactly one directory of it — a commit that only touches that app's own pages changes
# nothing for us, and saying so is more useful than listing it.
if git -C "$SUB" diff --quiet "$PINNED" "$UPSTREAM" -- packages/platform-ui; then
  echo "      (nothing — the upstream commits do not touch packages/platform-ui)"
else
  git -C "$SUB" diff --stat "$PINNED" "$UPSTREAM" -- packages/platform-ui | sed 's/^/      /'
fi
echo

git -C "$SUB" checkout --quiet "$UPSTREAM"
git add "$SUB"

echo "==> Pin moved and staged. Reinstalling so the file: dependency picks it up."
npm install --silent

cat <<EOF

==> Done. The submodule pointer is staged; commit it so the pin travels with the code:

      git commit -m "Pull @platform/ui to ${UPSTREAM:0:7}"

    Then rebuild — the design system is compiled into the client bundle, so a running app does not
    pick this up until it is rebuilt:

      npm run build
EOF
