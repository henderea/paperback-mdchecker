#!/usr/bin/env bash

cd "$(dirname "$0")"

pnpm run trigger:deep-check || exit $?
