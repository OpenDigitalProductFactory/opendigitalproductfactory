# Security Policy

## Supported versions

Only the `main` branch receives security updates. Published container images follow the tagged release on `main`; older tags are not back-patched.

## Reporting a vulnerability

**Do not open a public issue for security reports.** Public issues expose other installs to the same vulnerability before a fix is available.

Use GitHub's private security advisory process instead:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Fill in the advisory with reproduction steps, affected version or commit, impact, and any relevant logs.

A maintainer will acknowledge the report within 7 days and work with you on triage, fix, and disclosure timing.

## What to include

A useful report typically includes:

- The installer mode (`Ready to go` or `Customizable`) and install directory layout.
- Relevant versions: OS, Docker Desktop, the repository commit SHA or release tag you're running.
- A minimal reproduction — commands, screenshots, or a diff that demonstrates the issue.
- Impact: what an attacker can do, and under what preconditions.
- Any mitigations you've already identified.

## Scope

In scope:

- The portal web application and its API routes
- The AI routing, credential handling, and governance paths (Trusted AI Kernel)
- The Windows installer, Docker images, and the promotion pipeline
- The sandbox build loop and any code it executes or exposes

Out of scope:

- Denial-of-service attacks against a single self-hosted install's own infrastructure
- Vulnerabilities in third-party AI providers or their APIs (report directly to the provider)
- Issues that require an attacker to already have valid credentials with an administrative role (report these as regular bugs unless they enable privilege escalation)

## Coordinated disclosure

Once a fix is merged and published images are updated, the security advisory will be made public with credit to the reporter (unless anonymity is requested). Please do not disclose details publicly until the advisory is published.
