# Notification Fatigue Fix Design

## Background
The Notification table holds 5199 unread rows of type `taskrun.stalled`, leading to an overloaded inbox (Attention Surface). The `notifyAttention` function dedupes only while a notification is UNREAD. Any producer that pushes per-cycle mints a fresh row when the operator reads one. We need to cap these notifications per-type and clean up the existing backlog.

## Goals
1. Audit `notifyAttention` in `apps/web/` and its `taskrun.stalled` callers.
2. Add a per-type dedup/cap: when a notification of type X already exists as UNREAD for the same threadId/agentId, skip creating a new one (or replace + reset timestamp).
3. Add a one-time migration/DB script to mark existing stale `taskrun.stalled` rows as read.
4. Write a unit test covering the dedup logic.

## Design
- We will update the dedup logic in `notifyAttention` or the repository layer to consider existing `taskrun.stalled` alerts.
- Migration script will find all unread `taskrun.stalled` notifications older than a certain threshold or in bulk and set them to read.
- We will verify using unit tests.
