#!/usr/bin/env bash

source "$(dirname "$0")/_util.sh"

ncc="$(yarn bin ncc)"
for s; do
  s="$(_cleanup_param "$s")"
  bin_path="$(_get_bin_path "$s")"
  _pcmd "ncc build $bin_path -m -q -s -o build/$s ${EXCLUDES[*]}"
  "$ncc" build "$bin_path" -m -q -s -o "build/$s" ${EXCLUDES[@]}
done
