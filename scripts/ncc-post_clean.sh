#!/usr/bin/env bash

source "$(dirname "$0")/_util.sh"

for s; do
  s="$(_cleanup_param "$s")"
  _run "rm -rf build/$s/*.hbs && rm -rf build/$s/locales"
done
