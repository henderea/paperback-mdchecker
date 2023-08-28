#!/usr/bin/env bash

source "$(dirname "$0")/_util.sh"

for s; do
  s="$(_cleanup_param "$s")"
  _run "./scripts/ncc-clean.sh '$s' && ./scripts/ncc-build-release-build.sh '$s' && ./scripts/ncc-post_clean.sh '$s'"
done
