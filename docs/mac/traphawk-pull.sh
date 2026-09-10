#!/bin/bash
# Keeps the desktop project folder on current main. Installed once by
# the launchd agent next to this file; runs every 15 minutes. The
# project's own shell cannot modify tracked files, so this is the only
# thing that updates the folder, and it refuses to do anything but a
# fast forward so a local edit can never be clobbered or merged.
set -u
REPO="$HOME/GHRepositories/Cray_Cray_Parlay_App"
cd "$REPO" || exit 1
# A zero byte index.lock left by an interrupted git command blocks every
# later command. Only a stale one is removed.
if [ -f .git/index.lock ] && [ ! -s .git/index.lock ]; then
  find .git/index.lock -mmin +2 -delete
fi
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$branch" != "main" ]; then
  echo "$(date '+%F %T') not on main ($branch), not pulling" >> "$HOME/Library/Logs/traphawk-pull.log"
  exit 0
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "$(date '+%F %T') tracked changes present, not pulling" >> "$HOME/Library/Logs/traphawk-pull.log"
  exit 0
fi
git pull --ff-only --quiet origin main >> "$HOME/Library/Logs/traphawk-pull.log" 2>&1 \
  && echo "$(date '+%F %T') pulled $(git rev-parse --short HEAD)" >> "$HOME/Library/Logs/traphawk-pull.log"
