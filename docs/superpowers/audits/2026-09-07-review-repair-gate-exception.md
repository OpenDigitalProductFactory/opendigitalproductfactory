# Review repair gate exception

The operator explicitly authorized publishing the gate repair without all process gates because the broken gates prevent their own repair.

Scope: the immutable split-line review validator and incorrect task approval projection, with regression tests and the reviewed ordered fix design. The live coverage adapter rejects the required fix-design location under `specs/` while readiness requires that location. The existing planning recovery PR addresses this prerequisite.

This exception permits implementation and publication despite that planning admission failure and unavailable local process gates. It does not waive DCO, protected GitHub checks, independent review, authorization checks, or receipt integrity. Unrun gates must be reported as unrun. Focused before/after regression tests must run before publication. Runtime recovery is verified only after canonical deployment.
