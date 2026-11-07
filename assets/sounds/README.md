# Recorded sounds

Empty on purpose. A slot in `manifest.json` with a file plays that recording; a slot
with no file plays the synthesised sound, so a partial set is always fine. The list of
slots and what to buy for them is `flightsim-models-inbox/BATCH-8-SOUNDS.md`.

    "touchdown.paved": { "file": "touchdown-paved.m4a", "gain": 0.9, "vary": 0.05 }
    "loop.cabin": { "file": "cabin.m4a", "loop": true, "start": 0.05, "end": 6.2 }

- `file`: one name, or a list to pick from at random.
- `.m4a` (AAC) or `.mp3`, mono, 44.1 kHz. **Not .ogg**: an iPad's Safari may not decode it.
- Trim the ends. A loop needs `start` and `end` in seconds: both formats pad the file.
- Under 200 KB each, 600 KB in all. Anything past that is skipped, not loaded.
- Credit, licence and source go in `src/ui/credits.js`. Only CC0 or CC BY.
- `sw.js` caches each file the first time it is fetched. Do not add them to the precache.
