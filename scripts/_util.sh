_cleanup_param() {
  local s="$1"
  s="$(basename "$s")"
  s="${s%*.ts}"
  s="${s%*.js}"
  s="${s%*.mjs}"
  echo "$s"
}

_get_bin_path() {
  local s="$1"
  if [[ -f "bin/$s.ts" ]]; then
    echo "bin/$s.ts"
  elif [[ -f "bin/$s.mjs" ]]; then
    echo "bin/$s.mjs"
  else
    echo "bin/$s.js"
  fi
}

_pcmd() {
  printf '\e[2m$ %s\e[0m\n' "$1"
}

_run() {
    _pcmd "$1"
    eval "$1"
}

# export EXCLUDES=('-e' 'dotenv' '-e' 'express' '-e' 'got' '-e' 'http-terminator' '-e' 'node-schedule' '-e' 'pg')
export EXCLUDES=('-e' 'html-minifier')
