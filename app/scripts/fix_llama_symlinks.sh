#!/usr/bin/env bash
# fix_llama_symlinks.sh — ensure SONAME symlinks for llama.cpp libraries
#
# llama.cpp ships shared libraries with versioned filenames
# (libllama-common.so.0.4.0, libggml.so.0.23.0, libmtmd.so.0.4.0) but the
# ELF SONAME inside the binary is just `libllama-common.so.0` /
# `libggml.so.0` / `libmtmd.so.0`. The dynamic loader resolves SONAMEs
# at process start; without a matching symlink in the same directory,
# ld.so prints "error while loading shared libraries" and the
# llama-server child process exits with code 127.
#
# The llama.cpp release tarball normally lays down these symlinks
# itself, but the version Maestro bundles under app/ckpts/llm/bin/
# was extracted without them. The downstream Maestro Director
# treats the 127 exit as a soft failure and falls back to a
# heuristic, so the symptom is a hard-to-spot warning in the log
# ("llama-server exited with code 127") rather than a crash — easy
# to miss, but it kills the entire LLM advisor path (cinema
# evaluation can't run, Director can't call Gemma 4 for prompts).
#
# This script creates the missing symlinks idempotently. It only
# touches files inside app/ckpts/llm/bin/ and only writes a
# lib*.so.0 symlink if it doesn't already exist or if its target is
# missing. It does NOT replace an existing symlink whose target is
# still there, to avoid clobbering any local override.
#
# Symlinks created:
#   libggml-base.so.0     -> libggml-base.so.0.23.0
#   libggml.so.0          -> libggml.so.0.23.0
#   libllama-common.so.0  -> libllama-common.so.0.4.0
#   libllama.so.0         -> libllama.so.0.4.0
#   libmtmd.so.0          -> libmtmd.so.0.4.0
#
# The exact version suffix may drift when llama.cpp ships a new
# release; this script picks the highest *.so.0.* it finds for
# each basename, so a future 0.5.0 / 0.24.0 release still works
# without edits. The five SONAMEs above are stable across all
# llama.cpp releases since b3500.
#
# Idempotent: safe to run on every startup. Fast: < 50 ms.
set -euo pipefail

# Resolve BIN_DIR with priority:
#   1. CLI arg (allows callers to override)
#   2. SCRIPT_DIR-based: if the script lives at app/scripts/, derive
#      app/ckpts/llm/bin from there (works regardless of where the
#      repo is checked out — Cue Studio, Maestro, or any fork).
#   3. Hardcoded Maestro path as a last-resort fallback.
if [[ $# -ge 1 && -n "$1" ]]; then
  BIN_DIR="$1"
elif BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../ckpts/llm/bin" 2>/dev/null && pwd)"; then
  : # resolved from script location
else
  BIN_DIR="/home/yuri/Documentos/maestro/app/ckpts/llm/bin"
fi

if [[ ! -d "$BIN_DIR" ]]; then
  echo "[fix_llama_symlinks] directory not found: $BIN_DIR" >&2
  exit 0  # not fatal — no llama.cpp bundle installed yet
fi

# Each entry: soname -> glob of versioned files we want to point at.
declare -a SONAMES=(
  "libggml-base.so.0:libggml-base.so.0.*"
  "libggml.so.0:libggml.so.0.*"
  "libllama-common.so.0:libllama-common.so.0.*"
  "libllama.so.0:libllama.so.0.*"
  "libmtmd.so.0:libmtmd.so.0.*"
)

fixed=0
for entry in "${SONAMES[@]}"; do
  soname="${entry%%:*}"
  glob="${entry##*:}"
  link="$BIN_DIR/$soname"

  # If the link already exists and its target exists, do nothing.
  if [[ -L "$link" ]] && [[ -e "$link" ]]; then
    continue
  fi

  # Find the highest versioned file (lexicographic max — good enough
  # for the .X.Y.Z format llama.cpp ships; a real "highest" would
  # parse semver but the cost is not worth it for this fix).
  target="$(ls -1 "$BIN_DIR"/$glob 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -z "$target" ]]; then
    # No versioned file at all — nothing to symlink to. Leave it;
    # the loader will fail loudly if the binary is ever invoked,
    # which is the right outcome (we don't want to silently mask a
    # missing library).
    continue
  fi

  # If a stale broken link exists, remove it before creating the
  # new one (ln -sf would otherwise happily replace it).
  [[ -L "$link" && ! -e "$link" ]] && rm -f "$link"
  ln -sf "$(basename "$target")" "$link"
  fixed=$((fixed + 1))
done

if (( fixed > 0 )); then
  echo "[fix_llama_symlinks] created $fixed SONAME symlink(s) in $BIN_DIR"
fi
