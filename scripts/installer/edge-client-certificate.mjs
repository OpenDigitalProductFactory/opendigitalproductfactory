import {constants} from 'node:fs';
import {lstat, open} from 'node:fs/promises';
import {X509Certificate, createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {isAbsolute} from 'node:path';
import {isEntryModule} from '../lib/entry-module.mjs';

const check = (ok, code) => { if (!ok) throw new Error('edge_client_' + code); };
const validAt = (certificate, now) => Date.parse(certificate.validFrom) <= now && now < Date.parse(certificate.validTo);
function certificates(bytes) {
  const text = bytes.toString();
  const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  check(blocks.length > 0 && blocks.length <= 8 && text.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim() === '', 'certificate');
  try { return blocks.map(block => new X509Certificate(block)); } catch { throw new Error('edge_client_certificate'); }
}

// Expired inspection establishes the old public identity for an already
// authorized issuer. It never authenticates a request or changes CA policy.
// The caller additionally runs the pinned Step RFC5280 verifier before publish.
export function inspectEdgeClientCertificate({certificatePem, rootPem, subject, nowMs = Date.now(), allowExpired = false}) {
  check(Number.isSafeInteger(nowMs) && /^[A-Za-z0-9._-]+$/.test(subject), 'identity');
  const chain = certificates(certificatePem), roots = certificates(rootPem);
  check(roots.length === 1 && roots[0].ca && roots[0].verify(roots[0].publicKey)
    && validAt(roots[0], nowMs), 'root');
  const root = roots[0], leaf = chain[0];
  check(!leaf.ca && leaf.subject === 'CN=' + subject, 'identity');
  check(leaf.keyUsage?.length === 1 && leaf.keyUsage[0] === '1.3.6.1.5.5.7.3.2', 'usage');
  const end = Date.parse(leaf.validTo), start = Date.parse(leaf.validFrom);
  check(Number.isFinite(start) && Number.isFinite(end) && start < end && start <= nowMs, 'validity');
  check(allowExpired || nowMs < end, 'expired');
  const used = new Set();
  let current = leaf;
  while (current.fingerprint256 !== root.fingerprint256) {
    check(!used.has(current.fingerprint256), 'issuer');
    used.add(current.fingerprint256);
    const issuers = [...chain.slice(1), root].filter(candidate => candidate.fingerprint256 !== current.fingerprint256
      && candidate.ca && current.checkIssued(candidate) && current.verify(candidate.publicKey));
    const unique = [...new Map(issuers.map(certificate => [certificate.fingerprint256, certificate])).values()];
    check(unique.length === 1 && validAt(unique[0], nowMs), 'issuer');
    current = unique[0];
  }
  check(chain.every(certificate => certificate.fingerprint256 === root.fingerprint256 || used.has(certificate.fingerprint256)), 'issuer');
  return {disposition: nowMs >= end ? 'issue' : 'renew', rootSha256: createHash('sha256').update(rootPem).digest('hex')};
}

async function publicCertificateFile(path) {
  check(isAbsolute(path), 'path');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    check(before.isFile() && before.nlink === 1 && before.size > 0 && before.size <= 65536, 'file');
    check((before.mode & 0o022) === 0 || process.platform === 'win32', 'permissions');
    const buffer = Buffer.alloc(65537);
    let count = 0;
    while (count < buffer.length) {
      const {bytesRead} = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    check(count <= 65536, 'file');
    const bytes = buffer.subarray(0, count);
    const after = await handle.stat(), current = await lstat(path);
    check(current.isFile() && !current.isSymbolicLink() && bytes.length === before.size
      && [after, current].every(stat => stat.dev === before.dev && stat.ino === before.ino
        && stat.size === before.size && stat.mtimeMs === before.mtimeMs && stat.ctimeMs === before.ctimeMs), 'changed');
    return bytes;
  } finally { await handle.close(); }
}

if (isEntryModule(import.meta.url)) {
  try {
    const {values} = parseArgs({strict: true, allowPositionals: false, options: {
      certificate: {type: 'string'}, root: {type: 'string'}, subject: {type: 'string'}, 'allow-expired': {type: 'boolean', default: false},
    }});
    const result = inspectEdgeClientCertificate({certificatePem: await publicCertificateFile(values.certificate),
      rootPem: await publicCertificateFile(values.root), subject: values.subject, allowExpired: values['allow-expired']});
    process.stdout.write(result.disposition + ' ' + result.rootSha256 + '\n');
  } catch {
    process.stderr.write('Edge client certificate identity, trust or validity could not be verified.\n');
    process.exitCode = 1;
  }
}
