"""URL navigation policy for browser-driving sessions.

EP-BROWSER-DRIVE, spec 2026-06-05 §8.10 / §11. Pure, stdlib-only so it is unit-
testable without the heavy browser_use deps. Two jobs:

  1. SSRF guard inherited from External Site Access: block non-http(s) schemes,
     localhost, private / loopback / link-local IPs, and the cloud metadata
     endpoint (169.254.169.254, a link-local address).
  2. Per-session target-domain allowlist: a service-account session may only
     navigate to the domains it was provisioned for.

DNS-rebinding (a public hostname that resolves to a private IP) is a network-
layer concern not handled here; this module operates on the URL's literal host.
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlparse


def extract_host(url: str) -> str | None:
    """Return the lowercased hostname of an http(s) URL, or None if unparseable
    or not http(s)."""
    try:
        parsed = urlparse(url.strip())
    except (ValueError, AttributeError):
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    if not parsed.hostname:
        return None
    return parsed.hostname.lower()


def is_blocked_host(host: str) -> bool:
    """True if the host is an SSRF-blocked target (loopback / private / link-local
    / reserved IP, or a localhost name)."""
    h = host.lower().rstrip(".")
    if h == "localhost" or h.endswith(".localhost"):
        return True
    try:
        ip = ipaddress.ip_address(h)
    except ValueError:
        # Not a literal IP — a hostname. Allowed at this layer (network layer
        # handles DNS-rebinding); only explicit localhost names are blocked above.
        return False
    return (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local  # covers 169.254.0.0/16, incl. the metadata IP
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def host_allowed(host: str, target_domains: list[str] | None) -> bool:
    """True if host is permitted by the allowlist. An empty/None allowlist means
    'unrestricted' (caller decides whether that is acceptable — service-account
    sessions always pass a non-empty list). Matches the exact domain or any
    subdomain of it."""
    if not target_domains:
        return True
    h = host.lower().rstrip(".")
    for raw in target_domains:
        d = raw.lower().strip().rstrip(".")
        if not d:
            continue
        if h == d or h.endswith("." + d):
            return True
    return False


def check_navigation(url: str, target_domains: list[str] | None) -> tuple[bool, str]:
    """Validate a navigation target. Returns (ok, reason). reason is empty when ok."""
    host = extract_host(url)
    if host is None:
        return False, "only http(s) URLs with a host are allowed"
    if is_blocked_host(host):
        return False, f"host {host!r} is blocked (localhost / private / link-local / reserved)"
    if not host_allowed(host, target_domains):
        return False, f"host {host!r} is not in the session target-domain allowlist"
    return True, ""
