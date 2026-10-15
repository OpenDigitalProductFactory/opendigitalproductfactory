// @dpf/i18n — the framework-free core of DPF localization (EP-6B33A840).
// Design: docs/superpowers/specs/2026-09-25-localization-foundation-design.md.
// No npm dependencies: everything here sits on the native ECMAScript Intl API.
export * from "./locales";
export * from "./direction";
export * from "./negotiate";
export * from "./catalog";
export * from "./pseudo";
export { parseMessage } from "./mf2/parse";
export { formatMessage, messageVariables, type MessageArgs } from "./mf2/format";
export { MessageSyntaxError, type Message } from "./mf2/ast";
export { formatSource } from "./runtime";
