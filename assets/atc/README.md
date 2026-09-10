# Your own ATC recordings

The game ships with **no** voice recordings. Its default radio is synthesised
in Web Audio — no text-to-speech, no AI voices. If you would rather hear real
people, put your own clips here and choose **Settings → Sound → ATC voices →
"Recordings I have added myself"**.

## How

1. Drop audio files in this folder (`.mp3`, `.ogg` or `.wav`).
2. List them in `manifest.json` next to this file:

```json
[
  { "key": "kestrel-tower-cleared-for-take-off-runway-zero-nine",
    "file": "cleared-takeoff.mp3",
    "credit": "Name of the person who recorded it",
    "licence": "CC0 / CC BY 4.0 / your own recording",
    "source": "https://where-you-got-it" }
]
```

The `key` is the transmission's text, lowercased, with every run of
non-alphanumeric characters replaced by `-`, trimmed to 60 characters. Anything
you have not recorded falls back to the synthesised voice automatically, so a
partial set is fine.

3. Add each filename to `PRECACHE` in `sw.js` so it still works offline.
4. Add the credit, licence and source URL to `src/ui/credits.js`.

## Please only use audio you are allowed to use

Your own recordings, public-domain audio, or Creative Commons material whose
licence permits redistribution. Live ATC feeds are generally **not** free to
redistribute, and recordings of real controllers may carry privacy obligations
depending on where you are. Credit everything.
