#!/usr/bin/env node
// BI-BDC94789: Claude Code's headersHelper for the dpf connector.
//
// Claude Code files a server's stored OAuth sign-in under a hash of the
// server's type, url and headers. A declaration header written into
// claude.mcp.json changed with every pack, digest and convergence status, so
// each toolchain update signed the owner out. The descriptor now names this
// script, whose command line never changes, and the script prints the
// declaration the updater wrote beside it (toolchain-declaration.json, see
// toolchain_convergence.DECLARATION_SIDECAR). headersHelper output is merged
// over the static headers on each connection and is not part of the key.
//
// It never fails the connection: anything missing or malformed prints `{}`,
// which leaves the connection undeclared, exactly as before a declaration
// existed. Only the declaration header is relayed, whatever the file holds.

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DECLARATION_HEADER = "X-DPF-Toolchain";
export const SIDECAR = "toolchain-declaration.json";
// Printable ASCII without quotes or backslashes, as header_value() writes it.
const VALUE = /^[\x20-\x21\x23-\x5b\x5d-\x7e]{1,256}$/;

/** The headers to send for a sidecar file's text: the declaration or nothing. */
export function headersFor(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  const value = data?.headers?.[DECLARATION_HEADER];
  return typeof value === "string" && VALUE.test(value) ? { [DECLARATION_HEADER]: value } : {};
}

export function main(packRoot = join(dirname(fileURLToPath(import.meta.url)), "..")) {
  let text = "";
  try {
    text = readFileSync(join(packRoot, SIDECAR), "utf8");
  } catch {
    // No sidecar: an undeclared copy (source checkout, or not yet converged).
  }
  process.stdout.write(`${JSON.stringify(headersFor(text))}\n`);
}

function invokedDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
