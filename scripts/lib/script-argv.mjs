// scripts/lib/script-argv.mjs — the argv a `pnpm <script>` actually meant.
//
// pnpm 10 forwards the `--` in `pnpm gate:local -- --message-file m` to the
// script LITERALLY: argv is ["--", "--message-file", "m"]. node:util parseArgs
// then treats everything after `--` as positionals, so with
// `allowPositionals: true` or `strict: false` the flag is not an error — it is
// silently ignored. That is how a present trailer reported as missing: the
// message file never reached gate:local.
//
// Drop ONE leading `--` and hand the rest to parseArgs unchanged. A `--` that
// is not first still ends option parsing, as it should.

/** @param {string[]} [argv] defaults to process.argv.slice(2) */
export function scriptArgv(argv = process.argv.slice(2)) {
  return argv[0] === "--" ? argv.slice(1) : argv;
}
