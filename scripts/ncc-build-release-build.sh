#!/usr/bin/env bash

source "$(dirname "$0")/_util.sh"

for s; do
  s="$(_cleanup_param "$s")"
  bin_path="$(_get_bin_path "$s")"
  _pcmd "ncc build $bin_path -m -q -o build/$s ${EXCLUDES[*]}"
  npx @vercel/ncc build "$bin_path" -m -q -o "build/$s" ${EXCLUDES[@]}
done
