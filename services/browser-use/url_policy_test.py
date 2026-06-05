"""Tests for url_policy. Stdlib-only — run with `python url_policy_test.py`
(also collectable by pytest). EP-BROWSER-DRIVE Phase 2."""

from url_policy import extract_host, is_blocked_host, host_allowed, check_navigation


def test_extract_host():
    assert extract_host("https://substack.com/publish") == "substack.com"
    assert extract_host("HTTP://Example.COM/x") == "example.com"
    assert extract_host("ftp://example.com") is None  # non-http(s)
    assert extract_host("file:///etc/passwd") is None
    assert extract_host("not a url") is None


def test_is_blocked_host_ssrf():
    for blocked in [
        "localhost",
        "foo.localhost",
        "127.0.0.1",
        "10.0.0.5",
        "192.168.1.10",
        "172.16.0.1",
        "169.254.169.254",  # cloud metadata
        "0.0.0.0",
        "::1",
    ]:
        assert is_blocked_host(blocked), f"{blocked} should be blocked"
    for ok in ["substack.com", "8.8.8.8", "api.linkedin.com"]:
        assert not is_blocked_host(ok), f"{ok} should not be blocked"


def test_host_allowed_exact_and_subdomain():
    allow = ["substack.com", "linkedin.com"]
    assert host_allowed("substack.com", allow)
    assert host_allowed("www.substack.com", allow)  # subdomain
    assert host_allowed("api.linkedin.com", allow)
    assert not host_allowed("evil.com", allow)
    assert not host_allowed("notsubstack.com", allow)  # not a subdomain of substack.com
    # empty/None allowlist = unrestricted
    assert host_allowed("anything.com", [])
    assert host_allowed("anything.com", None)


def test_check_navigation():
    allow = ["substack.com"]
    ok, reason = check_navigation("https://substack.com/publish", allow)
    assert ok and reason == ""
    ok, reason = check_navigation("https://evil.com", allow)
    assert not ok and "allowlist" in reason
    ok, reason = check_navigation("http://127.0.0.1:8500/mcp", allow)
    assert not ok and "blocked" in reason
    ok, reason = check_navigation("ftp://substack.com", allow)
    assert not ok and "http" in reason


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
