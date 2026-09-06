#!/usr/bin/env bash
set -euo pipefail

# DPF self-upgrade promoter. Runs inside the dedicated `dpf-promoter` SIBLING
# container (Dockerfile.promoter) — never inside the portal — so it survives
# recreating the portal mid-swap. It drives the host docker daemon (mounted
# socket) to rebuild the portal image stamped with the target SHA, recreate the
# portal container, then health- and sha-verify the new portal.
#
# The orchestrating portal process dies when the portal is recreated, so it
# cannot mark the run succeeded. Boot reconciliation in the NEW portal
# (instrumentation.ts) records completion once it comes up reporting the target
# SHA. This script's exit code is still captured by whatever survives.

_self_upgrade=0
_dry_run=0
_readiness=0
_promoter_dir="${DPF_PROMOTER_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

# A registry release promoter is selected by immutable digest before this
# script starts. Portals released before the release-mode carrier existed can
# launch that exact candidate but cannot pass DPF_PROMOTION_MODE or its release
# identity. Recover only that one N-1 edge: a schema-valid source-free install
# may consume identity baked into the candidate image. Explicit source callers
# and source installs never enter this path.
_candidate_release_error=""
_resolve_immutable_release_config_digest() {
  local _immutable_ref="$1"
  local _platform_os="$2"
  local _platform_architecture="$3"
  local _raw_manifest=""
  local _platform_manifest_digest=""
  local _repository="${_immutable_ref%@*}"

  _raw_manifest="$(docker buildx imagetools inspect "$_immutable_ref" --raw)" || return 1
  if printf '%s' "$_raw_manifest" | node -e 'const raw=require("node:fs").readFileSync(0,"utf8"); const value=JSON.parse(raw); const digest=value?.config?.digest; if(!/^sha256:[a-f0-9]{64}$/.test(digest??"")) process.exit(2); process.stdout.write(digest)'; then
    return 0
  fi
  _platform_manifest_digest="$(printf '%s' "$_raw_manifest" | node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(0,"utf8")); const matches=(value.manifests??[]).filter((entry)=>entry?.platform?.os===process.argv[1]&&entry?.platform?.architecture===process.argv[2]&&/^sha256:[a-f0-9]{64}$/.test(entry?.digest??"")); if(matches.length!==1) process.exit(2); process.stdout.write(matches[0].digest)' "$_platform_os" "$_platform_architecture")" || return 1
  _raw_manifest="$(docker buildx imagetools inspect "${_repository}@${_platform_manifest_digest}" --raw)" || return 1
  printf '%s' "$_raw_manifest" | node -e 'const raw=require("node:fs").readFileSync(0,"utf8"); const value=JSON.parse(raw); const digest=value?.config?.digest; if(!/^sha256:[a-f0-9]{64}$/.test(digest??"")) process.exit(2); process.stdout.write(digest)'
}

_resolve_candidate_release_bootstrap() {
  _candidate_release_error=""

  if [[ -n "${DPF_PROMOTION_MODE:-}" ]]; then
    if [[ "$DPF_PROMOTION_MODE" != "source" && "$DPF_PROMOTION_MODE" != "release" ]]; then
      _candidate_release_error="unsupported DPF_PROMOTION_MODE=$DPF_PROMOTION_MODE"
      return 1
    fi
    return 0
  fi

  local _candidate_state="${DPF_PROMOTER_STATE_DIR:-/dpf-state}/install-state.json"
  local _install_mode=""
  [[ -r "$_candidate_state" ]] || return 0
  _install_mode="$(node -e 'const state=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8").replace(/^\uFEFF/,"")); process.stdout.write(typeof state.installMode==="string"?state.installMode:"")' "$_candidate_state" 2>/dev/null || true)"
  [[ "$_install_mode" == "consumer" || "$_install_mode" == "customer" ]] || return 0

  local _candidate_validator="$_promoter_dir/installer/validate-install-state.mjs"
  local _candidate_state_error=""
  if [[ ! -f "$_candidate_validator" ]] ||
     ! _candidate_state_error="$(node "$_candidate_validator" "$_candidate_state" 2>&1 >/dev/null)"; then
    _candidate_release_error="candidate release bootstrap requires valid install-state${_candidate_state_error:+: $_candidate_state_error}"
    return 1
  fi

  if [[ ! "${DPF_CANDIDATE_RELEASE_TAG:-}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-+][A-Za-z0-9.-]+)?$ ]] ||
     [[ ! "${DPF_CANDIDATE_RELEASE_OWNER:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$ ]] ||
     [[ ! "${DPF_CANDIDATE_SOURCE_SHA:-}" =~ ^[a-f0-9]{40}$ ]]; then
    _candidate_release_error="candidate release identity is incomplete or malformed"
    return 1
  fi
  if [[ "$DPF_CANDIDATE_SOURCE_SHA" != "${PROMOTE_TARGET_SHA:-}" ]]; then
    _candidate_release_error="candidate release source $DPF_CANDIDATE_SOURCE_SHA does not match promote target ${PROMOTE_TARGET_SHA:-<unset>}"
    return 1
  fi
  if [[ -n "${DPF_RELEASE_TAG:-}" && "$DPF_RELEASE_TAG" != "$DPF_CANDIDATE_RELEASE_TAG" ]] ||
     [[ -n "${GHCR_OWNER:-}" && "$GHCR_OWNER" != "$DPF_CANDIDATE_RELEASE_OWNER" ]]; then
    _candidate_release_error="caller release identity contradicts the immutable candidate"
    return 1
  fi

  export DPF_PROMOTION_MODE=release
  export DPF_RELEASE_TAG="$DPF_CANDIDATE_RELEASE_TAG"
  export GHCR_OWNER="$DPF_CANDIDATE_RELEASE_OWNER"
}

if [[ "${1:-}" == "--runtime-transition-secret-rotation" ]]; then
  exec node "$_promoter_dir/rotate-runtime-transition-secret.mjs" --state-dir "${DPF_PROMOTER_STATE_DIR:-/dpf-state}" --rotate
elif [[ "${1:-}" == "--runtime-transition-authority" ]]; then
  _operation="${2:-}"
  _transition_id="${3:-}"
  _ownership_token="${4:-}"
  exec node "$_promoter_dir/runtime-transition-authority.mjs" "$_operation" "$_transition_id" "$_ownership_token"
elif [[ "${1:-}" == "--runtime-capability-transition" ]]; then
  _transition_id="${2:-}"
  [[ "$_transition_id" =~ ^RCT-[A-Za-z0-9-]{1,48}$ ]] || {
    printf '{"status":"failed","failure":"invalid_transition_id"}\n' >&2
    exit 64
  }
  exec node "$_promoter_dir/apply-runtime-capability-transition.mjs" --runtime-capability-transition "$_transition_id"
fi

for arg in "$@"; do
  case "$arg" in
    --self-upgrade) _self_upgrade=1 ;;
    --dry-run)      _dry_run=1 ;;
    --readiness)    _readiness=1 ;;
  esac
done

if [[ $_readiness -eq 1 ]]; then
  _readiness_failures=()
  # A bare failure code cost hours of live diagnosis on SUR-C45B5F4B: readiness
  # reported `capability_projection_failed` while discarding the one line that
  # named the cause (`capability_state_stale`). Every probe below now carries its
  # own error text out with it. No temp files - the acceptance gate runs this
  # container `--read-only`, so the node probes report failure as data on stdout
  # rather than as a stream the shell would have to spool.
  _readiness_details=()
  _readiness_fail() { _readiness_failures+=("$1"); _readiness_details+=("$(printf '%s' "${2-}" | tr -d '\000\r' | tr '\n' ' ' | cut -c1-400)"); }
  _contract="${DPF_PROMOTER_CONTRACT:-/app/promoter-contract.json}"
  [[ -r "$_contract" ]] || _readiness_fail contract_unreadable "no readable promoter contract at $_contract"
  if [[ -r "$_contract" ]]; then
    while IFS= read -r _required_file; do
      [[ -r "$_required_file" ]] || _readiness_fail required_file_unreadable "contract requires unreadable file: $_required_file"
    done < <(jq -r '.requiredFiles[]? // empty' "$_contract" 2>/dev/null)
  fi
  [[ -x "$_promoter_dir/promote.sh" ]] || _readiness_fail entrypoint_unavailable "$_promoter_dir/promote.sh is not executable"
  if [[ "${DPF_PROMOTER_DOCKER_PREFLIGHT:-}" != "ready" ]] || ! command -v docker >/dev/null 2>&1 || ! docker --version >/dev/null 2>&1; then
    _readiness_fail docker_unavailable "docker preflight=${DPF_PROMOTER_DOCKER_PREFLIGHT:-<unset>} and no usable docker CLI"
  fi
  [[ -d "${PROMOTE_SOURCE:-}" && -r "${PROMOTE_SOURCE:-}" ]] || _readiness_fail source_mount_unreadable "candidate source mount ${PROMOTE_SOURCE:-<unset>} is not a readable directory"
  [[ -n "${PROMOTE_TARGET_SHA:-}" ]] || _readiness_fail target_sha_missing "PROMOTE_TARGET_SHA is unset"
  [[ -n "${PROMOTE_HEALTH_URL:-}" ]] || _readiness_fail health_url_missing "PROMOTE_HEALTH_URL is unset"
  _state_dir="${DPF_PROMOTER_STATE_DIR:-/dpf-state}"
  _state_file="$_state_dir/install-state.json"
  [[ -d "$_state_dir" && -r "$_state_dir" ]] || _readiness_fail state_mount_unreadable "state mount $_state_dir is not a readable directory"
  _state_validator="$_promoter_dir/installer/validate-install-state.mjs"
  _state_valid=0
  if [[ ! -r "$_state_file" ]] || [[ ! -f "$_state_validator" ]]; then
    _readiness_fail install_state_invalid "no readable install-state at $_state_file"
  elif ! _state_error="$(node "$_state_validator" "$_state_file" 2>&1 >/dev/null)"; then
    _readiness_fail install_state_invalid "$_state_error"
  else
    _state_valid=1
  fi
  if [[ $_state_valid -eq 1 ]] && ! _resolve_candidate_release_bootstrap; then
    _readiness_fail release_identity_invalid "$_candidate_release_error"
  fi
  # Build-context completeness. The candidate promoter image is built FROM the
  # host source tree, so every COPY source in Dockerfile.promoter must exist
  # there. When one does not, BuildKit reports it as an opaque cache-key
  # checksum failure naming a single path, hours after the useful moment:
  #
  #   promoter_candidate_build_failed: ... failed to compute cache key:
  #   "/scripts/installer/install-release-assets.mjs": not found
  #
  # Observed on SUR-75DAF829 and SUR-0C221FD3 (2026-08-22). The file was present
  # in git and absent from the host WORKING TREE, because the host install path
  # was checked out to a feature branch 44 commits behind main that predated it.
  # Nothing in that error says "your host tree is stale", which is the only
  # thing the operator needed to know.
  #
  # This probe reads the COPY sources out of the candidate's own
  # Dockerfile.promoter, so it stays correct as that file changes, and names
  # EVERY missing path at once rather than the first one BuildKit trips over.
  _promoter_dockerfile="${PROMOTE_SOURCE:-}/Dockerfile.promoter"
  if [[ -n "${PROMOTE_SOURCE:-}" && -r "$_promoter_dockerfile" ]]; then
    _missing_context=()
    while IFS= read -r _copy_src; do
      [[ -n "$_copy_src" ]] || continue
      [[ -e "${PROMOTE_SOURCE}/${_copy_src}" ]] || _missing_context+=("$_copy_src")
    done < <(awk '/^COPY /{ for (i = 2; i < NF; i++) if ($i !~ /^--/) print $i }' "$_promoter_dockerfile")
    if [[ ${#_missing_context[@]} -gt 0 ]]; then
      _readiness_fail promoter_build_context_incomplete \
        "host source tree ${PROMOTE_SOURCE} is missing ${#_missing_context[@]} file(s) the promoter image COPYs: ${_missing_context[*]} - if these exist in git, the host install path is checked out to a stale branch or has an incomplete working tree"
    fi
  fi
  _profile_adapter="${PROMOTE_SOURCE:-}/scripts/lib/resolve-capability-compose-profiles.mjs"
  if [[ "${DPF_PROMOTION_MODE:-source}" == "release" ]]; then
    # A consumer install contains verified release assets, not a source tree.
    # The candidate promoter is itself an immutable release artifact and its
    # contract requires this adapter, so release readiness must project from
    # that packaged closure instead of reaching through /host-source.
    _profile_adapter="$_promoter_dir/lib/resolve-capability-compose-profiles.mjs"
  fi
  if [[ ! -f "$_profile_adapter" ]]; then
    _readiness_fail capability_projection_failed "candidate source has no profile adapter at $_profile_adapter"
  elif ! _profile_error="$(node "$_profile_adapter" --state "$_state_file" --overlay promote --migrate 2>&1 >/dev/null)"; then
    _readiness_fail capability_projection_failed "$_profile_error"
  fi
  # Host identity is resolved by the shipped resolver, not read raw from the caller's env.
  # The promoter is candidate-owned but launched by the DEPLOYED portal, so an N-1 caller
  # sends no DPF_HOST_* and never can - demanding it wedges every pre-existing install,
  # since the upgrade that teaches the caller to send it IS the blocked upgrade. The
  # resolver still prefers explicit env, falls back to the installer-owned identity in the
  # mounted install-state, and fails closed on contradictory or unverifiable evidence.
  # Both probes report refusal as `{"error":...}` on stdout instead of dying on
  # stderr, so the reason survives into the readiness report.
  _migration_projection=""
  _readiness_error() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{return process.stdout.write(s?`unparseable probe output: ${s}`:"probe produced no output")}process.stdout.write(typeof v?.error==="string"?v.error:"")})' 2>/dev/null; }
  _host_identity="$(STATE_FILE="$_state_file" PROMOTER_DIR="$_promoter_dir" node --input-type=module -e '
    import { readFile } from "node:fs/promises"; import { pathToFileURL } from "node:url";
    try {
      const { resolveHostIdentity } = await import(pathToFileURL(process.env.PROMOTER_DIR + "/installer/resolve-host-identity.mjs").href);
      const state=JSON.parse((await readFile(process.env.STATE_FILE)).toString("utf8").replace(/^\uFEFF/,""));
      process.stdout.write(JSON.stringify(resolveHostIdentity({state,env:process.env})));
    } catch (error) { process.stdout.write(JSON.stringify({error:String(error?.message ?? error)})); }
  ' 2>&1)" || _host_identity=""
  _host_identity_error="$(_readiness_error "$_host_identity")"
  if [[ -n "$_host_identity" && -z "$_host_identity_error" ]]; then
    _migration_projection="$(STATE_FILE="$_state_file" PROMOTER_DIR="$_promoter_dir" DPF_HOST_IDENTITY="$_host_identity" node --input-type=module -e '
      import { readFile } from "node:fs/promises"; import { pathToFileURL } from "node:url";
      try {
        const { projectInstallState } = await import(pathToFileURL(process.env.PROMOTER_DIR + "/installer/migrate-install-state.mjs").href);
        const bytes=await readFile(process.env.STATE_FILE); const source=JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/,"")); const catalog=JSON.parse(await readFile(process.env.PROMOTER_DIR+"/capability-service-catalog.generated.json","utf8"));
        const hostIdentity=JSON.parse(process.env.DPF_HOST_IDENTITY);
        const r=await projectInstallState({bytes,hostIdentity,catalog}); process.stdout.write(JSON.stringify({sourceHash:r.sourceHash,projectionHash:r.projectionHash,migrationRequired:r.migrationRequired,fromSchemaVersion:source.schemaVersion??1,toSchemaVersion:r.projectedState.schemaVersion}));
      } catch (error) { process.stdout.write(JSON.stringify({error:String(error?.message ?? error)})); }
    ' 2>&1)" || _migration_projection=""
    _projection_error="$(_readiness_error "$_migration_projection")"
    if [[ -n "$_projection_error" ]]; then
      _migration_projection=""
      _readiness_fail install_state_projection_failed "$_projection_error"
    fi
  else
    _readiness_fail host_identity_missing "${_host_identity_error:-the shipped resolver produced no host identity}"
  fi
  [[ -n "${PROMOTE_COMPOSE_PROJECT:-}" ]] || _readiness_fail compose_identity_missing "PROMOTE_COMPOSE_PROJECT is unset"
  _recovery_path="${PROMOTE_BACKUP_PATH:-}"
  _recovery_parent="$(dirname "${_recovery_path:-/missing}")"
  _recovery_root="${DPF_PROMOTER_RECOVERY_ROOT:-/backups}"
  _recovery_available=0
  if [[ -n "$_recovery_path" && -d "$_recovery_parent" ]]; then
    _recovery_available=1
  elif [[ -n "$_recovery_path" && -d "$_recovery_root" && "$_recovery_path" == "${_recovery_root%/}/"* ]]; then
    # Readiness is deliberately non-mutating and mounts recovery storage read
    # only. The mutating run creates its self-upgrade/<run> subdirectories; the
    # preflight proves the governed mount root exists and the target stays below
    # it instead of requiring those future directories to pre-exist.
    _recovery_available=1
  fi
  [[ $_recovery_available -eq 1 ]] || _readiness_fail recovery_parent_unavailable "no writable parent for PROMOTE_BACKUP_PATH=${PROMOTE_BACKUP_PATH:-<unset>}"
  [[ -d "$_state_dir" ]] || _readiness_fail transition_secret_parent_unavailable "state dir $_state_dir is not a directory"
  if [[ ${#_readiness_failures[@]} -gt 0 ]]; then
    _failures_json="$(
      for _index in "${!_readiness_failures[@]}"; do
        printf '%s\n%s\n' "${_readiness_failures[$_index]}" "${_readiness_details[$_index]-}"
      done | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=s.split("\n"),o=[];for(let i=0;i+1<l.length;i+=2){const code=l[i],detail=(l[i+1]||"").trim();o.push({code,message:`Promoter readiness check failed: ${code}${detail?`: ${detail}`:""}`})}process.stdout.write(JSON.stringify(o))})'
    )"
    printf '{"stage":"preflight","result":"failed","quiescenceBegan":false,"failures":%s}\n' "$_failures_json"
    exit 78
  fi
  printf '%s\n' "$_migration_projection" | jq -c '. + {stage:"preflight",result:"ready",quiescenceBegan:false,failures:[]}'
  exit 0
fi

[[ $_self_upgrade -eq 1 ]] || { printf 'error: --self-upgrade flag required\n' >&2; exit 1; }

if ! _resolve_candidate_release_bootstrap; then
  printf 'error: %s\n' "$_candidate_release_error" >&2
  exit 78
fi

# Validate all required variables before any mutating work
_missing=()
[[ -n "${PROMOTE_SOURCE:-}"      ]] || _missing+=(PROMOTE_SOURCE)
[[ -n "${PROMOTE_TARGET_SHA:-}"  ]] || _missing+=(PROMOTE_TARGET_SHA)
[[ -n "${PROMOTE_BACKUP_PATH:-}" ]] || _missing+=(PROMOTE_BACKUP_PATH)
[[ -n "${PROMOTE_HEALTH_URL:-}"  ]] || _missing+=(PROMOTE_HEALTH_URL)

_release_mode=0
_release_identity_mode="legacy-no-config"
if [[ "${DPF_PROMOTION_MODE:-source}" == "release" ]]; then
  _release_mode=1
  [[ -n "${PROMOTE_INSTALL_ROOT:-}" ]] || _missing+=(PROMOTE_INSTALL_ROOT)
  [[ "${DPF_RELEASE_TAG:-}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-+][A-Za-z0-9.-]+)?$ ]] || _missing+=(DPF_RELEASE_TAG)
  # Portals released before the registry-authoritative upgrade contract do not
  # send a config digest. Keep that one-hop bootstrap path working; repaired
  # callers always send the digest and remain bound to it below.
  if [[ -n "${DPF_RELEASE_CONFIG_DIGEST:-}" && ! "${DPF_RELEASE_CONFIG_DIGEST}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    _missing+=(DPF_RELEASE_CONFIG_DIGEST)
  fi
  if [[ -n "${DPF_RELEASE_CONFIG_DIGEST:-}" ]]; then
    _release_identity_mode="config-only"
  fi
  if [[ -n "${DPF_RELEASE_CHANNEL_DIGEST:-}" || -n "${DPF_RELEASE_PLATFORM_MANIFEST_DIGEST:-}" ||
        -n "${DPF_RELEASE_PLATFORM_OS:-}" || -n "${DPF_RELEASE_PLATFORM_ARCHITECTURE:-}" ]]; then
    _release_identity_mode="full"
    [[ "${DPF_RELEASE_CONFIG_DIGEST:-}" =~ ^sha256:[a-f0-9]{64}$ ]] || _missing+=(DPF_RELEASE_CONFIG_DIGEST)
    [[ "${DPF_RELEASE_CHANNEL_DIGEST:-}" =~ ^sha256:[a-f0-9]{64}$ ]] || _missing+=(DPF_RELEASE_CHANNEL_DIGEST)
    [[ "${DPF_RELEASE_PLATFORM_MANIFEST_DIGEST:-}" =~ ^sha256:[a-f0-9]{64}$ ]] || _missing+=(DPF_RELEASE_PLATFORM_MANIFEST_DIGEST)
    [[ "${DPF_RELEASE_PLATFORM_OS:-}" == "linux" ]] || _missing+=(DPF_RELEASE_PLATFORM_OS)
    [[ "${DPF_RELEASE_PLATFORM_ARCHITECTURE:-}" =~ ^(amd64|arm64)$ ]] || _missing+=(DPF_RELEASE_PLATFORM_ARCHITECTURE)
  fi
  [[ "${GHCR_OWNER:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$ ]] || _missing+=(GHCR_OWNER)
fi

if [[ ${#_missing[@]} -gt 0 ]]; then
  printf 'error: missing required variables: %s\n' "${_missing[*]}" >&2
  exit 1
fi

if [[ $_dry_run -eq 0 ]]; then
  # An N-1 caller (a portal predating the signed handoff) sends NEITHER half and
  # never can - refusing it wedges the install exactly as the readiness gate did
  # (BI-76651B7B). promoter-migration-envelope.mjs self-issues from the candidate's own
  # projection in that case. Exactly ONE half is a broken caller, not a legacy
  # one, and still fails closed.
  if [[ -n "${DPF_INSTALL_STATE_MIGRATION_ENVELOPE:-}" && -z "${DPF_INSTALL_STATE_MIGRATION_SIGNATURE:-}" ]] ||
     [[ -z "${DPF_INSTALL_STATE_MIGRATION_ENVELOPE:-}" && -n "${DPF_INSTALL_STATE_MIGRATION_SIGNATURE:-}" ]]; then
    printf 'error: install_state_migration_handoff_incomplete\n' >&2
    exit 78
  fi
  node "$_promoter_dir/promoter-migration-envelope.mjs" >/dev/null || exit $?
fi

# Resolve the exact runtime profile closure from the governed install snapshot.
# A stale catalog/state pair fails before Docker mutation. Copy the snapshot to
# the recovery point and restore it atomically if any later promotion step fails.
_install_state="${DPF_PROMOTER_STATE_DIR:-/dpf-state}/install-state.json"
_compose_root="$PROMOTE_SOURCE"
_release_assets=""
_candidate_portal=""
if [[ $_release_mode -eq 1 && $_dry_run -eq 0 ]]; then
  _candidate_portal="ghcr.io/${GHCR_OWNER}/dpf-portal:${DPF_RELEASE_TAG}"
  docker pull "$_candidate_portal" >/dev/null
  _candidate_engine_digest="$(docker image inspect "$_candidate_portal" --format '{{.Id}}' | tr -d '[:space:]')"
  [[ "$_candidate_engine_digest" =~ ^sha256:[a-f0-9]{64}$ ]] || {
    printf 'error: release portal returned invalid engine digest %s\n' "${_candidate_engine_digest:-missing}" >&2
    exit 1
  }
  if [[ -z "${DPF_RELEASE_CONFIG_DIGEST:-}" ]]; then
    printf 'step=release-identity mode=legacy-bootstrap engine-digest=%s\n' "$_candidate_engine_digest"
  fi
  _candidate_platform_os="$(docker image inspect "$_candidate_portal" --format '{{.Os}}' | tr -d '[:space:]')"
  _candidate_platform_architecture="$(docker image inspect "$_candidate_portal" --format '{{.Architecture}}' | tr -d '[:space:]')"
  if [[ "$_release_identity_mode" == "full" &&
        ( "$_candidate_platform_os" != "$DPF_RELEASE_PLATFORM_OS" || "$_candidate_platform_architecture" != "$DPF_RELEASE_PLATFORM_ARCHITECTURE" ) ]]; then
    printf 'error: release portal platform %s/%s does not match resolved candidate %s/%s\n' \
      "${_candidate_platform_os:-missing}" "${_candidate_platform_architecture:-missing}" "$DPF_RELEASE_PLATFORM_OS" "$DPF_RELEASE_PLATFORM_ARCHITECTURE" >&2
    exit 1
  fi
  if [[ "$_release_identity_mode" == "full" &&
        "$_candidate_engine_digest" != "$DPF_RELEASE_CONFIG_DIGEST" &&
        "$_candidate_engine_digest" != "$DPF_RELEASE_PLATFORM_MANIFEST_DIGEST" &&
        "$_candidate_engine_digest" != "$DPF_RELEASE_CHANNEL_DIGEST" ]]; then
    printf 'error: release portal engine digest %s does not match resolved config/platform/channel identities %s %s %s\n' \
      "${_candidate_engine_digest:-missing}" "$DPF_RELEASE_CONFIG_DIGEST" "$DPF_RELEASE_PLATFORM_MANIFEST_DIGEST" "$DPF_RELEASE_CHANNEL_DIGEST" >&2
    exit 1
  fi
  if [[ "$_release_identity_mode" == "full" && "$_candidate_engine_digest" != "$DPF_RELEASE_CONFIG_DIGEST" ]]; then
    _candidate_repository="ghcr.io/${GHCR_OWNER}/dpf-portal"
    _candidate_immutable_ref="${_candidate_repository}@${_candidate_engine_digest}"
    _candidate_resolved_config_digest="$(_resolve_immutable_release_config_digest "$_candidate_immutable_ref" "$_candidate_platform_os" "$_candidate_platform_architecture")" || {
      printf 'error: release portal engine digest %s could not resolve the frozen %s/%s config\n' \
        "$_candidate_engine_digest" "$DPF_RELEASE_PLATFORM_OS" "$DPF_RELEASE_PLATFORM_ARCHITECTURE" >&2
      exit 1
    }
    [[ "$_candidate_resolved_config_digest" == "$DPF_RELEASE_CONFIG_DIGEST" ]] || {
      printf 'error: release portal resolved config digest %s does not match frozen release config %s\n' \
        "$_candidate_resolved_config_digest" "$DPF_RELEASE_CONFIG_DIGEST" >&2
      exit 1
    }
  fi
  if [[ "$_release_identity_mode" == "config-only" && "$_candidate_engine_digest" != "$DPF_RELEASE_CONFIG_DIGEST" ]]; then
    [[ "$_candidate_platform_os" == "linux" && "$_candidate_platform_architecture" =~ ^(amd64|arm64)$ ]] || {
      printf 'error: release portal legacy platform %s/%s is unsupported\n' "${_candidate_platform_os:-missing}" "${_candidate_platform_architecture:-missing}" >&2
      exit 1
    }
    _candidate_repository="ghcr.io/${GHCR_OWNER}/dpf-portal"
    _candidate_immutable_ref="${_candidate_repository}@${_candidate_engine_digest}"
    _candidate_repo_digests="$(docker image inspect "$_candidate_portal" --format '{{range .RepoDigests}}{{println .}}{{end}}' | tr -d '\r')"
    grep -Fxq "$_candidate_immutable_ref" <<<"$_candidate_repo_digests" || {
      printf 'error: release portal engine digest %s is not a pulled repository digest for %s\n' "$_candidate_engine_digest" "$_candidate_repository" >&2
      exit 1
    }
    _candidate_resolved_config_digest="$(_resolve_immutable_release_config_digest "$_candidate_immutable_ref" "$_candidate_platform_os" "$_candidate_platform_architecture")" || {
      printf 'error: release portal engine digest %s could not resolve an immutable %s/%s config\n' "$_candidate_engine_digest" "$_candidate_platform_os" "$_candidate_platform_architecture" >&2
      exit 1
    }
    [[ "$_candidate_resolved_config_digest" == "$DPF_RELEASE_CONFIG_DIGEST" ]] || {
      printf 'error: release portal resolved config digest %s does not match legacy caller %s\n' "$_candidate_resolved_config_digest" "$DPF_RELEASE_CONFIG_DIGEST" >&2
      exit 1
    }
  fi
  if [[ "$_release_identity_mode" == "config-only" ]]; then
    printf 'step=release-identity mode=config-only engine-digest=%s config-digest=%s platform=%s/%s\n' \
      "$_candidate_engine_digest" "$DPF_RELEASE_CONFIG_DIGEST" "$_candidate_platform_os" "$_candidate_platform_architecture"
  fi
  _candidate_revision="$(docker image inspect "$_candidate_portal" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' | tr -d '[:space:]')"
  [[ "$_candidate_revision" == "$PROMOTE_TARGET_SHA" ]] || {
    printf 'error: release portal revision %s does not match promote target %s\n' "${_candidate_revision:-missing}" "$PROMOTE_TARGET_SHA" >&2
    exit 1
  }
  _candidate_version="$(docker image inspect "$_candidate_portal" --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' | tr -d '[:space:]')"
  [[ "$_candidate_version" == "$DPF_RELEASE_TAG" ]] || {
    printf 'error: release portal version %s does not match release tag %s\n' "${_candidate_version:-missing}" "$DPF_RELEASE_TAG" >&2
    exit 1
  }
  mkdir -p "$PROMOTE_BACKUP_PATH"
  _release_assets="$(mktemp -d "$PROMOTE_BACKUP_PATH/candidate-release-assets.XXXXXX")"
  _asset_container="$(docker create "$_candidate_portal")"
  if ! docker cp "${_asset_container}:/dpf-release-assets/." "$_release_assets"; then
    docker rm -f "$_asset_container" >/dev/null 2>&1 || true
    exit 1
  fi
  docker rm "$_asset_container" >/dev/null
  _asset_container=""
  (cd "$_release_assets" && sha256sum -c SHA256SUMS >/dev/null)
  _compose_root="$_release_assets"
  export DPF_IMAGE_TAG="$DPF_RELEASE_TAG"
  export GHCR_OWNER
fi
_profile_adapter="$_compose_root/scripts/lib/resolve-capability-compose-profiles.mjs"
[[ -f "$_install_state" && -f "$_profile_adapter" ]] || { printf 'error: capability_state_stale\n' >&2; exit 1; }
_capability_projection="$(node "$_profile_adapter" --state "$_install_state" --overlay promote --migrate)" || exit $?
export COMPOSE_PROFILES="$(printf '%s' "$_capability_projection" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).composeProfiles.join(",")))')"
_capability_recovery="$PROMOTE_BACKUP_PATH/install-state.json"
_restore_capability_snapshot() {
  if [[ -f "$_capability_recovery" ]]; then
    node "$_promoter_dir/installer/install-state-transaction.mjs" restore \
      --state "$_install_state" --recovery-path "$_capability_recovery"
  fi
}
if [[ $_dry_run -eq 0 ]]; then
  mkdir -p "$PROMOTE_BACKUP_PATH"
  cp "$_install_state" "$_capability_recovery"
  trap '_rc=$?; if [[ $_rc -ne 0 ]]; then _restore_capability_snapshot; fi' EXIT
fi

# Compose chain used to rebuild/recreate the portal. The orchestrator passes
# PROMOTE_COMPOSE_FILES (space-separated, relative to PROMOTE_SOURCE) carrying
# the platform-correct chain the install was created with — base + the host
# platform overlay (docker-compose.linux.yml / .macos.yml) + edge, recorded in
# install-state.json's composeFiles. The fallback is BASE-ONLY: it must never be
# a platform overlay, because force-applying e.g. docker-compose.macos.yml on a
# Windows/Linux host overrides portal env (TTS_PROVIDER=mlx, DPF_TTS_URL=:8771,
# ollama LLM_BASE_URL) with values for the wrong substrate. Base-only is the only
# safe platform-agnostic default; the recorded chain is what makes overlays apply
# where the install actually needs them.
_project="${PROMOTE_COMPOSE_PROJECT:-dpf}"
# shellcheck disable=SC2206
_compose_files=(${PROMOTE_COMPOSE_FILES:-docker-compose.yml})
_f_args=()
for _f in "${_compose_files[@]}"; do
  _f_args+=(-f "$_compose_root/$_f")
done
_env_args=()
if [[ -n "${PROMOTE_COMPOSE_ENV_FILE:-}" ]]; then
  [[ -f "$PROMOTE_COMPOSE_ENV_FILE" ]] || {
    printf 'error: PROMOTE_COMPOSE_ENV_FILE is not readable\n' >&2
    exit 1
  }
  _env_args+=(--env-file "$PROMOTE_COMPOSE_ENV_FILE")
fi

# BI-55A30F8B: compose publishes every host port through DPF_HOST_BIND_ADDRESS
# (default 127.0.0.1, BI-FEE77B68). The portal is recreated in step 4, but the
# installer only writes the key into the install .env in step 7, so the first
# promotion after that change served a LAN install on loopback only and the
# host went dark for every peer (production, 2026-09-05). Mirror the installer
# rule here, before any compose command runs: an env file that predates the key
# keeps the all-interfaces exposure it already has. Process environment wins
# over --env-file in compose interpolation, and an operator who already set the
# variable, or an env file that carries it, is left alone.
if [[ -z "${DPF_HOST_BIND_ADDRESS:-}" && -n "${PROMOTE_COMPOSE_ENV_FILE:-}" ]] \
  && grep -q '[^[:space:]]' "$PROMOTE_COMPOSE_ENV_FILE" \
  && ! grep -q '^DPF_HOST_BIND_ADDRESS=' "$PROMOTE_COMPOSE_ENV_FILE"; then
  export DPF_HOST_BIND_ADDRESS=0.0.0.0
  _host_bind_preserved=1
else
  _host_bind_preserved=0
fi

# Emit a tagged step line; always prints in both dry-run and real modes.
# Only the step name and target SHA are printed — never source/backup/health
# paths — so logs are safe to surface to operators.
emit_step() {
  if [[ $_dry_run -eq 1 ]]; then
    printf 'dry-run: step=%s target=%s\n' "$1" "$PROMOTE_TARGET_SHA"
  else
    printf 'step=%s target=%s\n' "$1" "$PROMOTE_TARGET_SHA"
  fi
}
if [[ $_host_bind_preserved -eq 1 ]]; then
  emit_step host-bind-address-preserved
fi

# BET-5 (BI-A1E864A5): does this Postgres container's IMAGE provide the pgvector
# extension? Image-agnostic — query pg_available_extensions (which reflects the
# on-disk control file wherever it lives) instead of probing a hard-coded path.
# The Debian-based pgvector/pgvector image keeps vector.control at
# /usr/share/postgresql/16/extension, NOT /usr/local/share/postgresql/extension
# (a source build's path), so a path probe wrongly reports "absent" on the very
# image we recreate onto — making the idempotent skip never fire and recreating
# Postgres on every upgrade. `psql -U` connects over the local socket (trust), so
# no password is needed. Returns 0 (yes) / non-zero (no).
_pg_provides_vector() {
  local _c="$1" _out
  _out="$(docker exec "$_c" psql -U "${POSTGRES_USER:-dpf}" -d "${POSTGRES_DB:-dpf}" -tAc \
    "select 1 from pg_available_extensions where name = 'vector' limit 1" 2>/dev/null | tr -d '[:space:]')"
  [[ "$_out" == "1" ]]
}

# BET-5 (BI-A1E864A5): recreate a Postgres service onto the pgvector image WITHOUT
# dragging any host bind mount. The promoter runs compose with
# --project-directory="$PROMOTE_SOURCE" (its in-container /host-source mount), so a
# service's RELATIVE host bind — the main postgres mounts ./scripts/init-inngest-db.sh
# — resolves to /host-source/scripts/..., a path the HOST docker daemon cannot share,
# stranding the container in `Created` (DB offline, migrate never runs). The init
# script only runs on an EMPTY data dir (never on an upgrade), so recreate with a
# compose override that pins the pgvector image and replaces the service volumes with
# only its named data volume. Data-preserving: the named volume is never touched.
# Args: <service> <named-data-volume>.
_recreate_pg_onto_pgvector() {
  local _svc="$1" _datavol="$2" _ov _rc=0
  _ov="$(mktemp)" || return 1
  cat > "$_ov" <<YAML
services:
  ${_svc}:
    image: pgvector/pgvector:pg16
    volumes: !override
      - ${_datavol}:/var/lib/postgresql/data
YAML
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
    "${_f_args[@]}" -f "$_ov" up -d --no-deps --force-recreate "$_svc" || _rc=1
  rm -f "$_ov"
  return "$_rc"
}

# --- Step 1: prepare ---
# Ensure backup parent directory exists and source is present.
emit_step prepare
if [[ $_dry_run -eq 0 ]]; then
  mkdir -p "$PROMOTE_BACKUP_PATH" 2>/dev/null || true
  [[ -d "$PROMOTE_SOURCE" ]] || {
    printf 'error: PROMOTE_SOURCE is not a directory\n' >&2
    exit 1
  }
fi

# --- Step 2: backup ---
# Record the currently-deployed SHA so a rollback target is captured before the
# swap. Lightweight (no full tree copy); best-effort.
emit_step backup
if [[ $_dry_run -eq 0 ]]; then
  _prev_sha=$(curl -fsS "${PROMOTE_HEALTH_URL}/sha" 2>/dev/null | tr -d '[:space:]' || true)
  printf '%s\n' "${_prev_sha:-unknown}" > "$PROMOTE_BACKUP_PATH/previous-sha.txt" 2>/dev/null || true
fi

# Persist the exact projection approved during candidate readiness. The portal
# has already quiesced before launching this promoter, and the byte-for-byte
# recovery copy above is durable. Reverify the signed, run- and digest-bound
# carrier against the current source bytes, then let the canonical migrator and
# shared lock/CAS transaction perform the only write. Any later nonzero exit is
# handled by the existing EXIT trap, which restores these exact legacy bytes
# before the baseline is resumed.
emit_step install-state-migrate
if [[ $_dry_run -eq 0 ]]; then
  _migration_envelope="$(node "$_promoter_dir/promoter-migration-envelope.mjs")" || exit $?
  _migration_field() {
    printf '%s' "$_migration_envelope" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);const p=process.argv[1].split(".");let x=v;for(const k of p)x=x?.[k];if(typeof x!=="string"&&typeof x!=="number")process.exit(2);process.stdout.write(String(x))})' "$1"
  }
  # The migrator itself decides whether there is anything to write - it no-ops
  # unless its own projection reports migrationRequired, under the same lock and
  # CAS the expected-hash flags below bind. Gating the call on a schema-version
  # bump duplicated that decision in the shell and got it wrong: a capability
  # catalog that moves WITHIN schema v2 is a real migration, and skipping the
  # write left every install re-deriving the same restamp on every upgrade,
  # never persisting it (BI-AA6FBAD0).
  node "$_promoter_dir/installer/migrate-install-state.mjs" \
    --state "$_install_state" \
    --catalog "$_promoter_dir/capability-service-catalog.generated.json" \
    --host-platform "$(_migration_field hostIdentity.platform)" \
    --host-arch "$(_migration_field hostIdentity.arch)" \
    --expected-source-hash "$(_migration_field sourceHash)" \
    --expected-projection-hash "$(_migration_field projectionHash)" \
    --recovery-path "$_capability_recovery" \
    --write >/dev/null
fi

# Real platform version from the source's git release tags, baked into the new
# image so the portal keeps showing a real version (not version.json) after a
# self-upgrade. safe.directory: the mounted source is owned by the host user,
# not root, so git refuses to read it without this.
export DPF_PLATFORM_VERSION=""
if [[ $_dry_run -eq 0 ]]; then
  if [[ $_release_mode -eq 1 ]]; then
    DPF_PLATFORM_VERSION="${DPF_RELEASE_TAG#v}"
    export DPF_PLATFORM_VERSION
  else
  git config --global --add safe.directory '*' 2>/dev/null || true
  # BI-145214F0 — refresh tags before describe (same root cause as
  # install-dpf.sh). PROMOTE_SOURCE is the host source mount inside the
  # dpf-promoter container; without this the promoter inherits whatever
  # stale tag cache the host had and stamps every rebuilt portal image
  # with an out-of-date release-line label. Best-effort: failure (offline,
  # auth, etc.) must not abort the upgrade — the SHA stamp is still honest.
  git -C "$PROMOTE_SOURCE" fetch --tags --force origin 2>/dev/null || true
  DPF_PLATFORM_VERSION="$(git -C "$PROMOTE_SOURCE" describe --tags --always 2>/dev/null | sed 's/^v//' || true)"
  export DPF_PLATFORM_VERSION
  fi
fi

# --- Step 3: docker-build ---
# Rebuild the portal image from the host source. The DPF_VERSION stamp is
# derived from the ACTUAL bytes being built — `rev-parse HEAD` of the build
# source (plus a `-dirty` suffix when the tree has uncommitted changes) — NOT
# from the caller-supplied target. This is the load-bearing truth fix: the
# image can only ever report the identity of the code it actually contains, so
# the later sha-verify is a real check rather than reading back a value we set.
#
# PROMOTE_TARGET_SHA is the orchestrator's intended identity (the stamp it
# computed after preparing/merging the source). The spec §4.3 / BI-5B6C1C35
# invariant is stamp == built HEAD == target, asserted PRE-SWAP. A divergence
# here means the bytes about to be deployed are NOT the bytes the orchestrator
# resolved — exactly the stale-image class of bug — so we FAIL LOUD before
# building rather than recreating the portal under a label that lies about its
# contents. (A dirty build tree is also rejected: a `-dirty` stamp can never
# equal a clean target SHA, and promoting uncommitted bytes is never intended.)
# The real platform version (DPF_PLATFORM_VERSION, from git tags) is baked in
# the same build.
emit_step docker-build
if [[ $_dry_run -eq 0 ]]; then
  if [[ $_release_mode -eq 1 ]]; then
    _built_sha="$PROMOTE_TARGET_SHA"
    export DPF_VERSION="$_built_sha"
    docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
      "${_f_args[@]}" pull portal postgres
    _built_hash=$(docker run --rm "$_candidate_portal" cat /app/.dpf-source-content-hash 2>/dev/null | tr -d '[:space:]' || true)
    [[ -n "$_built_hash" ]] || { printf 'error: candidate release image has no source content hash\n' >&2; exit 1; }
  else
  _built_sha=$(git -C "$PROMOTE_SOURCE" rev-parse HEAD 2>/dev/null | tr -d '[:space:]' || true)
  [[ -n "$_built_sha" ]] || {
    printf 'error: cannot resolve HEAD of build source %s\n' "$PROMOTE_SOURCE" >&2
    exit 1
  }
  if [[ -n "$(git -C "$PROMOTE_SOURCE" status --porcelain 2>/dev/null || true)" ]]; then
    _built_sha="${_built_sha}-dirty"
  fi
  if [[ "$PROMOTE_TARGET_SHA" != "$_built_sha" ]]; then
    printf 'error: build source identity %s does not match promote target %s — refusing to build an image whose bytes diverge from the intended target (BI-5B6C1C35)\n' \
      "$_built_sha" "$PROMOTE_TARGET_SHA" >&2
    exit 1
  fi
  export DPF_VERSION="$_built_sha"
  # The promoter carries the Buildx plugin as part of its immutable toolchain.
  # Use Compose Bake so current daemons never fall back to the legacy builder,
  # whose image export can reference layers already absent from its store.
  export COMPOSE_BAKE=true
  # Build portal AND postgres. postgres is now a first-party built image
  # (docker/postgres/Dockerfile — pgvector + baked init script, BI-4796D52B);
  # building it here guarantees the image exists before any recreate, and the
  # build context is streamed to the daemon so it works from /host-source where
  # a host bind mount could not. The build is a single COPY over the cached
  # pgvector base — negligible cost.
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
    "${_f_args[@]}" build portal postgres
  # Capture the source content hash baked into the FRESHLY BUILT image. It is
  # computed from the actual bundled source bytes (Dockerfile) independent of
  # the DPF_VERSION label, so the content-verify step can prove the recreated
  # container is this image and not a stale one. Portal has no `image:` field,
  # so compose tags the built image ${_project}-portal.
  _built_hash=$(docker run --rm "${_project}-portal" cat /app/.dpf-source-content-hash 2>/dev/null | tr -d '[:space:]' || true)
  [[ -n "$_built_hash" ]] || {
    printf 'error: freshly built image has no /app/.dpf-source-content-hash\n' >&2
    exit 1
  }
  fi
fi

# --- Step 3a: ensure Postgres provides pgvector ---
# BET-5 (BI-A1E864A5): the vector migration runs `CREATE EXTENSION vector`, which the plain
# `postgres:16` image does not ship. A self-upgrade recreates ONLY the portal (step 4, --no-deps),
# so an existing install's postgres container keeps whatever image it launched with — and the
# Phase-0 compose bump to `pgvector/pgvector:pg16` never reaches it. Without this step, step 3b
# `migrate deploy` fails with "extension \"vector\" is not available" and the upgrade aborts
# before the swap. Recreate postgres onto the compose-pinned pgvector image BEFORE migrate.
#
# IDEMPOTENT: skips when the running container's image already provides pgvector (a fresh install
# built from the new compose, or an install already upgraded), detected image-agnostically via
# pg_available_extensions. DATA-PRESERVING: pgvector/pgvector is the same PG16 engine as postgres:16
# on the same pgdata volume (a strict superset image), so the recreate keeps all data — no
# dump/restore. FAIL-CLOSED like migrate: if the recreate or the readiness wait fails, abort before
# the swap so the old portal keeps serving the old code.
emit_step ensure-pgvector
if [[ $_dry_run -eq 0 ]]; then
  _pg_container="${DPF_PRODUCTION_DB_CONTAINER:-${_project}-postgres-1}"
  if _pg_provides_vector "$_pg_container"; then _has_vector=yes; else _has_vector=no; fi
  if [[ "$_has_vector" != "yes" ]]; then
    printf 'step=ensure-pgvector-recreate target=%s\n' "$PROMOTE_TARGET_SHA"
    _recreate_pg_onto_pgvector postgres pgdata || {
        printf 'error: could not recreate postgres onto the pgvector image — the BET-5 vector migration cannot apply\n' >&2
        exit 1
      }
    # Wait for the recreated postgres to accept connections before migrate.
    _pg_ready=0
    for _i in $(seq 1 30); do
      if docker exec "$_pg_container" pg_isready -U "${POSTGRES_USER:-dpf}" >/dev/null 2>&1; then _pg_ready=1; break; fi
      sleep 2
    done
    [[ $_pg_ready -eq 1 ]] || { printf 'error: postgres did not become ready after the pgvector recreate\n' >&2; exit 1; }
  fi
  # P3009 recovery (BET-5): an install that attempted this upgrade on a pre-fix promoter (no
  # pgvector) left the pgvector-foundation migration in a FAILED state, which then blocks ALL
  # subsequent `migrate deploy` with P3009 — even after pgvector is present. Now that pgvector
  # is guaranteed available above, clear that ONE failed record so deploy can re-apply it.
  # Scoped to this single migration, which fails at its first statement (CREATE EXTENSION), so
  # nothing was applied and rolling it back is a no-op on data. Best-effort (`|| true`): a
  # clean install has no such record and this is a harmless miss.
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
    "${_f_args[@]}" run --rm -T --no-deps --entrypoint sh portal \
    -c 'cd /app && pnpm --filter @dpf/db exec prisma migrate resolve --rolled-back 20260714110000_bet5_pgvector_foundation' >/dev/null 2>&1 || true

  # BI-2BD99239: a pre-fix upgrade can leave the human-principal backfill
  # failed at zero steps on the PrincipalAlias uniqueness collision. The
  # candidate-owned checker proves the exact migration bytes, SQLSTATE,
  # constraint, zero-step ledger state, and the exact preceding corrective
  # migration bytes. Only that state may be rolled back so normal deploy can
  # apply the preparation migration first and then retry the immutable backfill.
  _human_principal_recovery="$(
    docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
      "${_f_args[@]}" run --rm -T --no-deps --entrypoint sh portal \
      -c 'cd /app && node packages/db/scripts/recover-human-principal-backfill-migration.mjs'
  )" || {
    printf 'error: human-principal migration recovery did not prove a safe state\n' >&2
    exit 1
  }
  case "$_human_principal_recovery" in
    recover:*)
      _human_principal_migration_id="${_human_principal_recovery#recover:}"
      docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
        "${_f_args[@]}" run --rm -T --no-deps --entrypoint sh portal \
        -c 'cd /app && pnpm --filter @dpf/db exec prisma migrate resolve --rolled-back 20260812110000_backfill_missing_human_principals'
      docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
        "${_f_args[@]}" run --rm -T --no-deps --entrypoint sh portal \
        -c 'cd /app && node packages/db/scripts/recover-human-principal-backfill-migration.mjs --verify-rolled-back "$1"' \
        sh "$_human_principal_migration_id"
      ;;
    not-needed) ;;
    *)
      printf 'error: human-principal migration recovery returned an unknown decision\n' >&2
      exit 1
      ;;
  esac

  # BI-B92CFED7: a pre-fix self-upgrade can leave the 11:59 observation
  # snapshot failed at its first UPDATE because a corrupted unique index still
  # contains duplicate heap keys. The candidate-owned checker proves the exact
  # allowlisted failure, zero applied steps, zero durable snapshot effects, and
  # the exact pre-snapshot quarantine guard. Any mismatch aborts before the
  # portal swap.
  _inventory_snapshot_recovery="$(
    docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
      "${_f_args[@]}" run --rm -T --no-deps --entrypoint sh portal \
      -c 'cd /app && node packages/db/scripts/recover-inventory-snapshot-migration.mjs'
  )" || {
    printf 'error: inventory snapshot migration recovery did not prove a safe state\n' >&2
    exit 1
  }
  case "$_inventory_snapshot_recovery" in
    recover:*)
      _inventory_snapshot_migration_id="${_inventory_snapshot_recovery#recover:}"
      docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
        "${_f_args[@]}" run --rm -T --no-deps --entrypoint sh portal \
        -c 'cd /app && pnpm --filter @dpf/db exec prisma migrate resolve --rolled-back 20260728115900_snapshot_inventory_observation_facts'
      docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
        "${_f_args[@]}" run --rm -T --no-deps --entrypoint sh portal \
        -c 'cd /app && node packages/db/scripts/recover-inventory-snapshot-migration.mjs --verify-rolled-back "$1"' \
        sh "$_inventory_snapshot_migration_id"
      ;;
    not-needed) ;;
    *)
      printf 'error: inventory snapshot migration recovery returned an unknown decision\n' >&2
      exit 1
      ;;
  esac
fi

# --- Step 3b: migrate ---
# Apply DB migrations using the FRESHLY BUILT portal image BEFORE recreating the
# long-running portal. The swap in step 4 recreates ONLY `portal` (--no-deps),
# so it never runs the one-shot `portal-init` service that a normal
# `docker compose up` runs to migrate the DB. Without this step a self-upgrade
# that ships a migration leaves the live DB drifted, and every query for a new
# column throws Prisma P2022 ColumnNotFound — the 2026-06-07 crash incident
# (BI-D9BAB4FA) where /ops/self-upgrade, /build, /platform and /workbooks all
# died after a swap. Running `prisma migrate deploy` from the new image's own
# bytes is forward-only and FAIL-CLOSED: `set -e` aborts the upgrade on a
# migration error BEFORE the swap, so the OLD portal keeps serving the OLD code
# against a consistent DB rather than a new image landing on an un-migrated one.
# DPF migrations are additive (expand), so applying them while the old portal is
# still running is safe — it simply ignores the new columns until it is replaced.
# NOTE: step 4b (seed) re-runs the full /docker-entrypoint.sh AFTER the swap,
# which includes migrations as part of its retry loop — safe because migrate
# deploy is idempotent. Step 3b is still needed as the pre-swap schema guard.
emit_step migrate
if [[ $_dry_run -eq 0 ]]; then
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
    "${_f_args[@]}" run --rm -T --no-deps --entrypoint sh portal \
    -c 'cd /app && pnpm --filter @dpf/db exec prisma migrate deploy'
fi

# --- Step 4: docker-up ---
# Recreate ONLY the portal from the freshly built image. --no-deps leaves
# postgres/neo4j/etc. running. DEPLOYED_SHA resolves to DPF_VERSION (the
# derived built identity) via compose, so the new portal reports exactly the
# SHA of the code it is running at /api/health/sha.
emit_step docker-up
if [[ $_dry_run -eq 0 ]]; then
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
    "${_f_args[@]}" up -d --no-deps --force-recreate portal
fi  # DPF_PLATFORM_VERSION stays exported from above so any rebuild keeps the stamp

# --- Step 4b: seed ---
# Re-run /docker-entrypoint.sh from the freshly swapped portal image so that
# any new reference data (archetypes, regulatory entries, EA reference models,
# capability perspectives, provider registries, catalog reconciliation) ships
# atomically with the code that expects it.
#
# promote.sh step 4 uses --no-deps, so portal-init (the one-shot service that
# normally runs the full entrypoint at install time) never runs. The running
# portal's CMD is the app server, not /docker-entrypoint.sh. Without this step
# a self-upgrade that ships new seed rows leaves the live DB at the previous
# seed state — features that depend on the new rows silently degrade or throw
# missing-row errors. This was the root cause of the banking archetype
# post-upgrade invisibility that required a manual seed recovery (BI-86FC0336).
#
# All seed operations use upsert, so re-running is IDEMPOTENT. This step is
# FAIL-CLOSED: set -e aborts the upgrade here if the seed fails, keeping the
# stale-data failure visible rather than letting it silently pass health checks.
# The seed runs in a one-shot sibling container (--rm) that talks directly to
# postgres; the portal is already started and the two containers run concurrently,
# which is safe because all seed writes are additive. The -T flag drops the
# pseudo-tty so structured log output reaches the promoter's stdout cleanly.
emit_step seed
if [[ $_dry_run -eq 0 ]]; then
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
    "${_f_args[@]}" run --rm -T --no-deps --entrypoint /docker-entrypoint.sh portal
fi

# --- Step 5: health ---
# Wait for the recreated portal to report healthy (it takes time to boot).
emit_step health
if [[ $_dry_run -eq 0 ]]; then
  _healthy=0
  for _i in $(seq 1 60); do
    if curl -fsS "$PROMOTE_HEALTH_URL" >/dev/null 2>&1; then _healthy=1; break; fi
    sleep 5
  done
  [[ $_healthy -eq 1 ]] || {
    printf 'error: portal did not become healthy within timeout\n' >&2
    exit 1
  }
fi

# --- Step 6: sha-verify ---
# Confirm the running deployment reports the SHA of the code we actually built
# ($_built_sha from step 3). Step 3 already asserted _built_sha == target, so a
# match here closes the three-way identity loop required by spec §4.3:
# stamp(/sha) == built HEAD == target. The stamp is derived from the build
# source's own HEAD (baked → DEPLOYED_SHA → /api/health/sha), so this genuinely
# proves the running runtime is at the built commit rather than echoing a value
# we chose. An EMPTY /sha is a hard failure, not a retry-until-timeout: it means
# DEPLOYED_SHA was never populated in the running portal (the BI-5B6C1C35
# symptom), so the runtime cannot prove its own identity and must not pass.
emit_step sha-verify
if [[ $_dry_run -eq 0 ]]; then
  _match=0
  _deployed_sha=""
  for _i in $(seq 1 30); do
    _deployed_sha=$(curl -fsS "${PROMOTE_HEALTH_URL}/sha" 2>/dev/null | tr -d '[:space:]' || true)
    # An EMPTY /sha is a hard failure, not a transient miss to retry: DEPLOYED_SHA
    # is unpopulated in the running image, so it can never report an identity no
    # matter how long we wait. Break immediately and fail loud below rather than
    # spinning the full retry budget (which would blow the verify timeout).
    [[ -z "$_deployed_sha" ]] && break
    if [[ "$_deployed_sha" == "$_built_sha" ]]; then _match=1; break; fi
    sleep 3
  done
  if [[ -z "$_deployed_sha" ]]; then
    printf 'error: running portal reported an EMPTY deployed SHA at /sha — DEPLOYED_SHA is not populated in the running image, so it cannot prove it carries the built bytes (BI-5B6C1C35)\n' >&2
    exit 1
  fi
  [[ $_match -eq 1 ]] || {
    printf 'error: deployed SHA %s does not match built/target SHA %s — running portal does not carry the bytes that were built (BI-5B6C1C35)\n' \
      "${_deployed_sha:-unknown}" "$_built_sha" >&2
    exit 1
  }
fi

# --- Step 7: content-verify ---
# Structural-verification-is-not-functional guard (BI-C8E90A79): prove the
# RUNNING container is the image we just built by comparing the source content
# hash baked into each. This catches a recreate that silently kept a STALE
# image — which sha-verify cannot, because a stale image left from a prior
# (broken) upgrade can carry the same SHA label. Neither hash is the
# DPF_VERSION we set; both are computed from actual source bytes, so the check
# is capable of failing.
emit_step content-verify
if [[ $_dry_run -eq 0 ]]; then
  _running_hash=$(docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
    "${_f_args[@]}" exec -T portal cat /app/.dpf-source-content-hash 2>/dev/null | tr -d '[:space:]' || true)
  [[ -n "$_running_hash" && "$_running_hash" == "$_built_hash" ]] || {
    printf 'error: running content hash %s does not match freshly built %s — recreate did not deploy the new image\n' \
      "${_running_hash:-unknown}" "$_built_hash" >&2
    exit 1
  }
fi

# A verified release runtime and its restart identity are one transaction. Only
# commit the candidate's manifest-covered lifecycle assets, .env tag, and
# install-state after the running portal proves both health and source/content
# identity. The installer helper restores every managed byte on failure; then
# compose is rerun against the restored old tag to put the portal back too.
emit_step release-identity-commit
if [[ $_release_mode -eq 1 && $_dry_run -eq 0 ]]; then
  [[ -d "$PROMOTE_INSTALL_ROOT" && -w "$PROMOTE_INSTALL_ROOT" ]] || {
    printf 'error: canonical install root %s is not a writable directory\n' "${PROMOTE_INSTALL_ROOT:-<unset>}" >&2
    exit 1
  }
  if ! node "$_promoter_dir/installer/install-release-assets.mjs" \
    --source "$_release_assets" \
    --install "$PROMOTE_INSTALL_ROOT" \
    --state "$_install_state" \
    --tag "$DPF_RELEASE_TAG" \
    --owner "$GHCR_OWNER" \
    --recovery "$PROMOTE_BACKUP_PATH/release-identity"; then
    printf 'error: release identity commit failed; restoring the prior portal tag\n' >&2
    _rollback_f_args=()
    for _f in "${_compose_files[@]}"; do _rollback_f_args+=(-f "$PROMOTE_SOURCE/$_f"); done
    docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$PROMOTE_SOURCE" -p "$_project" \
      "${_rollback_f_args[@]}" up -d --no-deps --force-recreate portal || true
    exit 1
  fi
fi

# --- Step 7b: sandbox-refresh ---
# Rebuild + recreate the dpf-sandbox image the same way step 3/4 do the portal
# (BI-A8686CFC). The promote chain historically rebuilt ONLY the portal, so
# every improvement to Dockerfile.sandbox — the opencode coding agent that the
# Build Studio build phase shells into, the macOS TTS env wiring, provisioned
# build engines — never reached an installed sandbox via self-upgrade. Its
# image would sit at whatever was built at install time (a month stale on the
# install that surfaced this), so BS builds died at the coding phase (exit 127,
# `opencode` not found) and env-only compose fixes never took effect until a
# manual `--force-recreate`. Kernel decision: mirror the portal contract
# exactly — unconditional build every upgrade, letting the BuildKit layer cache
# make an unchanged Dockerfile.sandbox near-instant, rather than a git-diff gate
# whose missed input would silently reintroduce the very staleness this fixes.
#
# Sequenced AFTER the portal is fully verified and deliberately fail-LOUD but
# NOT fail-ABORT: the portal swap already happened at step 4 and the
# orchestrator process died with it, so a non-zero exit here reverts nothing —
# it would only mislabel a genuinely-promoted portal as a failed upgrade. A
# stale sandbox is a recoverable degraded state (recover_sandbox tool, the
# health-alert surface) so we emit an explicit sandbox-refresh-failed marker and
# continue to cleanup + done rather than aborting. This is the opposite of the
# original silent bug: the rebuild always runs, and its failure is never hidden.
emit_step sandbox-refresh
if [[ $_dry_run -eq 0 ]]; then
  _sandbox_required="$(printf '%s' "$_capability_projection" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).requiredServices.includes("sandbox")?"yes":"no"))')"
  if [[ "$_sandbox_required" != "yes" ]]; then
    printf 'step=sandbox-refresh-optional-inactive target=%s\n' "$_built_sha"
  else
  _sandbox_ok=1
  # BET-5 (BI-A1E864A5): the sandbox runs the same schema, so its Postgres also needs pgvector
  # for `CREATE EXTENSION vector`. Recreate sandbox-postgres onto the pgvector image first — same
  # image-agnostic idempotency check (pg_available_extensions) and host-bind-safe recreate as
  # step 3a. Fail-LOUD-not-ABORT like the rest of 7b: a sandbox-postgres it cannot upgrade degrades
  # Build Studio, it never reverts the already-promoted portal.
  _sbx_pg="${_project}-sandbox-postgres-1"
  if docker inspect "$_sbx_pg" >/dev/null 2>&1; then
    if _pg_provides_vector "$_sbx_pg"; then _sbx_has_vector=yes; else _sbx_has_vector=no; fi
    if [[ "$_sbx_has_vector" != "yes" ]]; then
      _recreate_pg_onto_pgvector sandbox-postgres sandbox_pgdata || _sandbox_ok=0
    fi
  fi
  if [[ $_sandbox_ok -eq 1 ]]; then
    if [[ $_release_mode -eq 1 ]]; then
      docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
        "${_f_args[@]}" pull sandbox || _sandbox_ok=0
    else
      docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
        "${_f_args[@]}" build sandbox || _sandbox_ok=0
    fi
  fi
  if [[ $_sandbox_ok -eq 1 ]]; then
    docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$_compose_root" -p "$_project" \
      "${_f_args[@]}" up -d --no-deps --force-recreate sandbox || _sandbox_ok=0
  fi
  if [[ $_sandbox_ok -eq 0 ]]; then
    printf 'step=sandbox-refresh-failed target=%s\n' "$_built_sha"
    printf 'warning: dpf-sandbox rebuild/recreate failed after a successful portal promotion — the portal upgrade stands, but the sandbox may be stale (Build Studio builds can fail at the coding phase until it is refreshed via recover_sandbox or a manual `docker compose build sandbox && docker compose up -d --force-recreate sandbox`) (BI-A8686CFC)\n' >&2
  fi
  fi
fi

# --- Step 7c: legacy-datastore decommission ---
# BET-5 (BI-922EBB99 / BI-2A3BE4D7): the portal now runs on Postgres only (pgvector for
# vectors, a graph mirror for the graph). The one-time boot backfill that staged legacy data
# into Postgres was retired once the fleet finished migrating; the platform is Postgres-only
# and new installs never provision Neo4j/Qdrant. This teardown remains DATA-SAFETY GATED (it
# refuses to delete a store until its data is confirmed in the mirror) and IDEMPOTENT — now a
# no-op on every current install (containers already gone, or never present), kept as a safety
# net that removes any lingering legacy container/volume it finds.
#
# Fail-LOUD but NOT fail-ABORT, exactly like sandbox-refresh: the portal swap already
# succeeded, so a hiccup here (or data not yet mirrored) must never mislabel a good upgrade. A
# store left standing is a recoverable degraded state — the next upgrade retries, or the
# operator runs scripts/decommission-neo4j-qdrant.{sh,ps1} directly.
emit_step decommission-legacy-stores
if [[ $_dry_run -eq 0 ]]; then
  if [[ -f "$PROMOTE_SOURCE/scripts/decommission-neo4j-qdrant.sh" ]]; then
    DPF_POSTGRES_CONTAINER="${DPF_PRODUCTION_DB_CONTAINER:-${_project}-postgres-1}" \
    DPF_NEO4J_CONTAINER="${_project}-neo4j-1" \
    DPF_NEO4J_VOLUME="${_project}_neo4jdata" \
    DPF_QDRANT_CONTAINER="${_project}-qdrant-1" \
    DPF_QDRANT_VOLUME="${_project}_qdrant_data" \
      sh "$PROMOTE_SOURCE/scripts/decommission-neo4j-qdrant.sh" || {
        printf 'step=decommission-legacy-stores-deferred target=%s\n' "$_built_sha"
        printf 'warning: Neo4j/Qdrant decommission did not complete (data not yet mirrored or a docker hiccup) — the portal upgrade stands; it retries on the next upgrade or via scripts/decommission-neo4j-qdrant.sh (BI-922EBB99)\n' >&2
      }
  fi
fi

# --- Step 8: cleanup ---
# A successful swap leaves the PREVIOUS portal image untagged (dangling) plus BuildKit
# cache layers from step 3's rebuild. Nothing else sweeps them, so across upgrades they
# pile into tens of GB of dead disk on Docker's fixed VM disk — and once it fills, the
# NEXT `docker compose build` (step 3) fails with "no space left on device", i.e. the
# accumulation eventually breaks the very upgrade that produced it. Reclaim it now, but
# ONLY after every verify above has passed (so a still-needed rollback image is never
# pruned) and BEST-EFFORT (a cleanup hiccup must never fail an upgrade that succeeded).
#
# The two piles are treated differently on purpose:
#   * Dangling images — the superseded previous portal version, zero value once the tag
#     moved to the new build. Removed outright (never `docker image prune -a`, which
#     would delete tagged images the compose stack still needs).
#   * Build cache — a PERFORMANCE asset: those layers make the next rebuild fast, so we
#     BOUND it (keep ~10GB; Docker evicts the oldest beyond that) rather than wiping it.
#     Capping reclaims runaway disk without making every future upgrade rebuild cold.
# Volumes are NEVER touched here — operator DB/state lives in volumes.
emit_step cleanup
if [[ $_dry_run -eq 0 ]]; then
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --keep-storage "${PROMOTE_BUILD_CACHE_KEEP:-10GB}" >/dev/null 2>&1 || true
  # BI-9B7FC928: `image prune` above only removes DANGLING images. The TAGGED
  # throwaway images left by Build Studio's content-verify / main-compare /
  # local-integration flows (dpf-*-build-test:*, dpf-*-build-compare:*,
  # dpf-*:verify) survive it and leaked ~3.7 GB per successful upgrade until the
  # disk filled. Reclaim them by exact ephemeral naming: the running
  # dpf-portal / dpf-promoter images NEVER carry a -build-test / -build-compare
  # suffix or a :verify tag, so removing these cannot touch the already-deployed
  # portal (and this runs only after every verify passed). Best-effort — never
  # fails the upgrade. Volumes are still never touched.
  for _ref in 'dpf-*-build-test' 'dpf-*-build-compare' 'dpf-*:verify'; do
    _imgs="$(docker images --filter "reference=${_ref}" -q 2>/dev/null | sort -u)"
    [[ -n "${_imgs}" ]] && docker rmi -f ${_imgs} >/dev/null 2>&1 || true
  done
fi

# Terminal success marker — emitted only after every verify AND the cleanup sweep, so
# `step=done` continues to mean "fully promoted" for the orchestrator.
if [[ $_dry_run -eq 0 ]]; then
  printf 'step=done target=%s\n' "$_built_sha"
fi
trap - EXIT
