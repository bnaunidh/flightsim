# Airline lettering fonts

Staged 2026-10-25 (owner-approved download), moved here in wave 14.
Source: Fontsource packages via cdn.jsdelivr.net (`@fontsource/<family>@5`, latin subset woff2).
All **SIL Open Font License 1.1 (OFL)** — free to bundle and redistribute with the game, never sold
on their own. Credited in the game's Credits screen (`src/ui/credits.js`, Typography).

| File | Family | Designers |
|---|---|---|
| montserrat-700/800-normal.woff2 | Montserrat 700, 800 | Julieta Ulanovsky and the Montserrat Project Authors |
| jost-600/700-normal.woff2 | Jost 600, 700 | Owen Earl (indestructible type*) |
| league-spartan-700-normal.woff2 | League Spartan 700 | The League of Moveable Type and the League Spartan Project Authors |
| playfair-display-700-normal.woff2 | Playfair Display 700 | Claus Eggers Sørensen and the Playfair Project Authors |
| cinzel-700-normal.woff2 | Cinzel 700 | Natanael Gama and the Cinzel Project Authors |
| oswald-600-normal.woff2 | Oswald 600 | Vernon Adams, Kalapi Gajjar, Cyreal and the Oswald Project Authors |
| barlow-condensed-700-normal.woff2 | Barlow Condensed 700 | Jeremy Tribby and the Barlow Project Authors |
| exo-2-700-italic.woff2 | Exo 2 700 italic | Natanael Gama and the Exo 2 Project Authors |
| titillium-web-700-normal.woff2 | Titillium Web 700 | Accademia di Belle Arti di Urbino and the Titillium Web Project Authors |
| archivo-black-400-normal.woff2 | Archivo Black 400 | Omnibus-Type and the Archivo Project Authors |
| kanit-600-normal.woff2 | Kanit 600 | Cadson Demak and the Kanit Project Authors |
| lora-600-italic.woff2 | Lora 600 italic | Cyreal and the Lora Project Authors |

## How the game uses them

**The interface.** One system, on every machine: **Jost** (`--font`, 600 and 700) for everything you read,
**Barlow Condensed** (`--mono`, 700) for numbers and read-outs, tabular so they hold still. `styles/main.css`
declares them with `font-display: swap`; `index.html` preloads Jost so the menu paints in it. Instruments and
other canvas text in the cockpit use **Titillium Web** (its digits are all one width); map labels use Jost and
Barlow Condensed; heavy painted signs Archivo Black.

**The airlines' names** are drawn, not typed: `src/fleet/extra/wordmarks.js` holds one wordmark per airline
(its own case, tracking, kerning, slant, inks and one idea: a lockup, a stencil, a cut), placed letter by
letter on its own transparent canvas, and a stacked version for a short room. `src/fleet/extra/title-slot.js`
works out the room on each type from its doors, windows, wing and engines: behind the first door, in the band
over the windows, running back over the wing root as far as the wing stays under it from a chase camera. On a real model the name is a patch of that hull's own triangles
(`decalPatch` in `src/fleet/extra/real-paint.js`), with its own texels.

`src/render/airline-fonts.js` declares the faces (@font-face) and `loadAirlineFonts()` asks
`document.fonts` for each one; `main.js` waits for it (2 s at most) before the world and the first
aeroplane are built. A wordmark drawn before its face is in is drawn again when it arrives.
`sw.js` precaches every file here.

Each parody airline (`src/aircraft/liveries.js`, `style.titleFont`) is lettered in the face nearest
the FEEL of the lettering of the airline it is styled after — never that airline's own typeface:

| Airline | Face | Feel |
|---|---|---|
| Abyssinia Air | Kanit 600 | warm, slightly flared bold sans |
| Ununited | Montserrat 700 | clean, wide geometric |
| Liberty Air | Titillium Web 700 | squared, technical sans |
| Bleu Ciel | Jost 700 | Parisian geometric, two words of capitals |
| Bharat Air | Lora 600 italic | flowing italic of the old titling |
| Night Freight | Oswald 600 | condensed cargo |
| Kanal Royal Dutch | League Spartan 700 | bold round geometric, white on the blue crown |
| Riverdelta | Montserrat 800 | heavy, square-shouldered |
| Desert Pearl | Playfair Display 700 | high-contrast elegant serif, one tall gold line |
| Sandline | Cinzel 700 | classical capitals |
| Dash Freight | Exo 2 700 italic | fast heavy italic |
| FlexShip | Montserrat 700 | round geometric, open and spaced |
| Parcel Brown | Barlow Condensed 700 | sturdy condensed |
| Royal Isles | Jost 700 | crisp upright geometric |
| Bosphorus | League Spartan 700 | bold even geometric capitals, spaced |
| Pearl Gulf | Playfair Display 700 | refined serif, wide spacing |
| Rising Crane | Kanit 600 | firm sans, one black line |
| Spit Air | Archivo Black | black, loud, lowercase, painted tall |
| OverSea | Exo 2 700 italic | sporty, forward-leaning |
| Air Force One | Playfair Display 700 | Caslon-style serif |
