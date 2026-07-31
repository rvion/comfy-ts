# Philosophy

- **The schema is the source of truth.** Everything typed flows from the host's live `object_info` — never hand-maintain node types. Codegen or nothing.
- **Types are the product.** The reason this lib exists over raw HTTP calls is autocomplete on 700+ nodes and literal unions of the models actually installed. Any feature that weakens type precision is a regression.
- **Content addressing over bookkeeping.** Hash the bytes, name things by hash, dedupe by hash. Nothing gets uploaded or regenerated that already exists.
- **Loud failures.** A silent fallback in a generative pipeline wastes GPU-hours. Fail fast, log with context, keep errors observable to humans AND LLMs.
- **Boring wins.** Few deps, each earning its place. 20 lines of obvious code beat a clever abstraction.
- **Spec-first.** agent/ docs are the contract; code follows.
