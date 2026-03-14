# Password Reset Recovery Design

Date: 2026-03-14
Branch: `feature/password-reset-recovery`

## Overview

The platform currently supports credential login, but it does not provide a self-service password recovery flow. The only existing reset path is an admin-only action that directly overwrites a user's password. That is not sufficient for normal users, creates avoidable operational risk, and blocks recovery when a user forgets a password.

This design adds a proper token-based password reset workflow with two delivery modes:

- preferred: real email delivery when outbound mail is configured
- fallback: admin-assisted manual recovery when outbound mail is not configured

The reset workflow is the same in both modes. Only the delivery method changes.

## Goals

- Provide a user-facing `Forgot password` flow.
- Keep recovery secure with one-time expiring tokens.
- Support real email delivery once outbound mail is configured.
- Support early-stage deployments with a manual non-email fallback.
- Avoid revealing whether an email address exists in the system.
- Preserve auditability of password recovery events.

## Non-Goals

- Full authentication subsystem redesign.
- MFA or passwordless login.
- Customer-contact recovery flows.
- Replacing credentials login.
- Full outbound mail-provider implementation beyond the seam and configuration checks needed for MVP.

## Current State

- Login exists via NextAuth credentials.
- User passwords are stored as `passwordHash`.
- Admins can directly reset a user password through the admin panel.
- There is no reset token model, no forgot-password page, no reset-password page, and no delivery channel.

## Recommended Approach

Implement one secure password reset workflow with delivery adapters:

1. User requests reset.
2. System creates a short-lived one-time token.
3. If outbound email is configured, send a reset link by email.
4. If outbound email is not configured, allow an admin to issue and reveal a one-time manual recovery link.
5. User redeems the token and sets a new password.
6. Token is consumed and cannot be reused.

This keeps email and fallback on one recovery path instead of creating separate reset systems.

## Data Model

Add a new model for reset tokens.

### `PasswordResetToken`

- `id`
- `userId`
- `tokenHash`
- `deliveryChannel`
  - `email`
  - `manual`
- `requestedByUserId nullable`
  - null for self-service request
  - populated for admin-issued recovery
- `expiresAt`
- `consumedAt nullable`
- `createdAt`

### Storage Rules

- Never store the raw token.
- Generate a raw token once at issuance.
- Store only a cryptographic hash in the database.
- Compare hashed candidate tokens during redemption.

## Delivery and Platform Configuration

The workflow must support a capability check for outbound email.

### Delivery Modes

- `email`
  - used when platform mail configuration is available
- `manual`
  - used when email is unavailable and an admin must assist

### Configuration Expectations

For real email delivery, the platform will eventually need:

- sender email address
- provider type or SMTP mode
- provider credentials or SMTP credentials

For MVP, the implementation only needs:

- a reliable way to detect whether outbound email is configured
- an email-delivery interface seam
- a safe fallback when email is unavailable

## User Experience

### Login Page

Add:

- `Forgot password?` link
- neutral recovery messaging

Keep the existing credentials login flow otherwise unchanged.

### Forgot Password Page

Fields:

- email

Behavior:

- accept an email address
- always return a neutral success-style message
- never reveal whether the account exists
- if email delivery is configured:
  - queue or send reset email
  - show "If an account exists, check your email"
- if email delivery is not configured:
  - still issue a recovery request internally when appropriate
  - show that recovery requires local/admin assistance

### Reset Password Page

Route:

- tokenized reset link or manual recovery link

Fields:

- new password
- confirm password

Behavior:

- validate token server-side
- enforce current password policy
- consume token on success
- redirect back to login with success message

## Admin Experience

Replace the current "directly set password" recovery posture with an issued reset flow.

### Admin Recovery

Admins can:

- issue a reset for a selected user
- if email is configured:
  - send the recovery email
- if email is unavailable:
  - reveal a one-time manual recovery link or code in the admin UI

This keeps the user responsible for setting the new password while still allowing bootstrap recovery in early installs.

Direct admin password overwrite should no longer be the primary recovery path.

## Security Requirements

- Password reset requests must not disclose account existence.
- Tokens must be one-time use.
- Tokens must expire.
- Tokens must be invalid after successful redemption.
- Password policy remains enforced during reset.
- Recovery request and completion events should be auditable.
- Invalid, expired, or reused tokens must fail safely with a generic invalid-link response.

## Audit and Logging

At minimum, record:

- reset requested
- reset issued by admin
- reset completed
- invalid or expired token redemption attempt

These can initially use existing audit or governance logging seams if available. If no suitable runtime audit structure exists, add a minimal application log event now and evolve later.

## Components

### Server Actions / Services

- request password reset
- validate reset token
- complete reset with new password
- admin issue recovery reset
- delivery-mode resolution
- outbound-email capability check

### UI Routes / Components

- login page update
- forgot-password page
- reset-password page
- admin recovery panel update

### Mail Adapter Seam

Provide an interface boundary for delivery:

- `sendPasswordResetEmail(...)`

For MVP:

- real provider implementation may be stubbed behind config detection if needed
- manual flow must still work fully

## Error Handling

### User-Facing

- always neutral on request submission
- invalid token and expired token collapse into one user-safe message
- password policy failures show actionable guidance

### Admin-Facing

- clearly show whether recovery was delivered by email or manual link
- clearly show when outbound email is not configured

## Testing

Required coverage:

- request flow does not reveal account existence
- valid token can reset password
- expired token is rejected
- consumed token is rejected
- password policy still applies on reset
- admin-issued manual reset link can be redeemed
- login page exposes forgot-password path
- email-enabled and email-disabled paths resolve correctly

## MVP Delivery Slice

1. Add `PasswordResetToken` schema and migration.
2. Add token creation, validation, and consumption helpers.
3. Add forgot-password page and reset-password page.
4. Add login-page link and messaging.
5. Add admin-issued recovery flow that generates manual links when email is unavailable.
6. Add outbound mail capability check and adapter seam.
7. Add tests for both self-service and manual fallback flows.

## Future Enhancements

- full SMTP/provider configuration UI
- customer-contact password recovery
- MFA-aware recovery flow
- recovery event dashboards and security alerts
- forced password change after manual bootstrap recovery if desired
