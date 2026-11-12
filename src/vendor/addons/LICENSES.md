# Vendored three.js add-ons (r169)

Copied unchanged from the `three@0.169.0` npm package (`examples/jsm/`), except
that their `import ... from 'three'` and relative paths point at the copies here
(`../three.module.js`, `./WorkerPool.js`, ...). Loaded only on demand, for a
packed real model (`src/aircraft/real-packed.js`, `real-detail.js`).

| File | From | Licence |
| --- | --- | --- |
| `KTX2Loader.js` | three.js `examples/jsm/loaders/` | MIT, three.js authors (see `../three.LICENSE`) |
| `WorkerPool.js` | three.js `examples/jsm/utils/` | MIT, three.js authors |
| `ktx-parse.module.js` | ktx-parse by Don McCurdy, as bundled by three.js | MIT |
| `zstddec.module.js` | zstddec by Don McCurdy, as bundled by three.js | MIT |
| `meshopt_decoder.module.js` | meshoptimizer by Arseny Kapoulkine, as bundled by three.js | MIT (header in the file) |
| `../basis/basis_transcoder.js`, `.wasm` | Basis Universal by Binomial LLC, as bundled by three.js | Apache-2.0 |
