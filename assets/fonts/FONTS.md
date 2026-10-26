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

`src/render/airline-fonts.js` declares the faces (@font-face) and `loadAirlineFonts()` asks
`document.fonts` for each one; `main.js` waits for it (2 s at most) before the world and the first
aeroplane are built. A titling canvas drawn before its face is in is drawn again when it arrives.
`sw.js` precaches every file here.

Each parody airline (`src/aircraft/liveries.js`, `style.titleFont`) is lettered in the face nearest
the FEEL of the lettering of the airline it is styled after — never that airline's own typeface:

| Airline | Face | Feel |
|---|---|---|
| Abyssinia Air | Kanit 600 | warm, slightly flared bold sans |
| Ununited | Montserrat 700 | clean, wide geometric |
| Liberty Air | Titillium Web 700 | squared, technical sans |
| Bleu Ciel | Jost 600 | Parisian geometric |
| Bharat Air | Lora 600 italic | flowing italic of the old titling |
| Night Freight | Oswald 600 | condensed cargo |
| Kanal Royal Dutch | League Spartan 700 | bold round geometric |
| Riverdelta | Montserrat 800 | heavy, square-shouldered |
| Desert Pearl | Playfair Display 700 | high-contrast elegant serif |
| Sandline | Cinzel 700 | classical capitals |
| Dash Freight | Exo 2 700 italic | fast heavy italic |
| FlexShip | Archivo Black | black tight grotesque |
| Parcel Brown | Barlow Condensed 700 | sturdy condensed |
| Royal Isles | Jost 700 | crisp upright geometric |
| Bosphorus | League Spartan 700 | bold even geometric |
| Pearl Gulf | Playfair Display 700 | refined serif, wide spacing |
| Rising Crane | Kanit 600 | firm sans |
| Spit Air | Archivo Black | black, loud |
| OverSea | Exo 2 700 italic | sporty, forward-leaning |
| Air Force One | Playfair Display 700 | Caslon-style serif |
