#!/usr/bin/env node
import { verifyPackage } from './package.mjs';
try {
  if (process.argv.length !== 3) throw new Error('Usage: node verify-package.mjs <package-directory>');
  const v = await verifyPackage(process.argv[2]);
  console.log(JSON.stringify({packageName:v.packageName,version:v.version,manifestSha256:v.manifestSha256,fileCount:v.fileCount,requiredRuntimeLibrariesVerified:v.requiredRuntimeLibrariesVerified,qualification:v.qualification}));
} catch(error) { console.error(error.message);process.exitCode=1; }
