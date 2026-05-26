#!/usr/bin/env bash
# Build and recreate the local portal-init and portal services together.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/redeploy-portal.sh [--no-cache]

Builds portal and portal-init with DPF_VERSION set to the current git HEAD,
recreates both services without rebuilding again, and verifies both containers
carry the same DPF version marker.

Set DPF_COMPOSE_ENV_FILE to override the Docker Compose env file. By default,
the helper uses this checkout's .env, then $HOME/dpf/.env when present.
EOF
}

declare -a build_flags=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-cache)
      build_flags+=("--no-cache")
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[redeploy-portal] Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

compose_env_file="${DPF_COMPOSE_ENV_FILE:-}"
if [ -z "$compose_env_file" ]; then
  if [ -f "$repo_root/.env" ]; then
    compose_env_file="$repo_root/.env"
  elif [ -f "$HOME/dpf/.env" ]; then
    compose_env_file="$HOME/dpf/.env"
  fi
fi

declare -a compose_args=()
if [ -n "$compose_env_file" ]; then
  if [ ! -f "$compose_env_file" ]; then
    echo "[redeploy-portal] Compose env file not found: $compose_env_file" >&2
    exit 1
  fi
  echo "[redeploy-portal] Using Compose env file: $compose_env_file"
  compose_args+=(--env-file "$compose_env_file")
fi

sha="$(git rev-parse HEAD)"
export DPF_VERSION="$sha"
echo "[redeploy-portal] Building portal and portal-init with DPF_VERSION=$sha"

docker compose "${compose_args[@]}" build "${build_flags[@]}" portal portal-init

echo "[redeploy-portal] Recreating portal-init and portal from the built images"
docker compose "${compose_args[@]}" up -d --no-build --force-recreate portal-init portal

portal_container="$(docker compose "${compose_args[@]}" ps -a -q portal | head -n 1)"
portal_init_container="$(docker compose "${compose_args[@]}" ps -a -q portal-init | head -n 1)"

if [ -z "$portal_container" ] || [ -z "$portal_init_container" ]; then
  echo "[redeploy-portal] Missing portal or portal-init container after recreate." >&2
  exit 1
fi

version_tmp="$(mktemp -d)"
trap 'rm -rf "$version_tmp"' EXIT

read_container_version() {
  local service="$1"
  local container="$2"
  local version_file="$version_tmp/$service.dpf-image-version"

  docker cp "$container:/app/.dpf-image-version" "$version_file"
  tr -d '\r\n' < "$version_file"
}

portal_version="$(read_container_version portal "$portal_container")"
portal_init_version="$(read_container_version portal-init "$portal_init_container")"

if [ "$portal_version" != "$sha" ]; then
  echo "[redeploy-portal] portal image version differs from build SHA." >&2
  echo "[redeploy-portal] portal=$portal_version expected=$sha" >&2
  exit 1
fi

if [ "$portal_init_version" != "$sha" ]; then
  echo "[redeploy-portal] portal-init image version differs from build SHA." >&2
  echo "[redeploy-portal] portal-init=$portal_init_version expected=$sha" >&2
  exit 1
fi

echo "[redeploy-portal] portal and portal-init image versions match DPF_VERSION=$sha"
