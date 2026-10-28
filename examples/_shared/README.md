# Standalone consumer file reads

The seven reusable-component runners share `read-regular-file.mjs` for source
reads. It opens a descriptor without following a leaf symlink where supported,
checks the opened regular file against the pathname identity, reads that same
descriptor and always closes it. Replacing the pathname after validation cannot
substitute different bytes into that read. This does not provide a transaction
over an entire source tree or prevent concurrent in-place changes by its owner.

Run the filesystem regressions from the repository root with the supported Node:

```sh
node --test examples/_shared/read-regular-file.test.mjs
```

The cases exercise actual pathname replacement before and after identity checking,
regular text/byte reads, symlink/directory refusal and cleanup after a read error.
Each example retains its own compiler, import-closure and behavior checks.
The helper is runner infrastructure; it adds no dependency to the portable kernels.
Source-copy handoffs that include these runners must include this shared directory.
