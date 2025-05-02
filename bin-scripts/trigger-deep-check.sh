#!/usr/bin/env bash

cd "$(dirname "$0")/.."

tsNode="$(pnpm bin)/ts-node"
"$tsNode" ./bin/cli.ts deep-check || exit $?
