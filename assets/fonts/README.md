# assets/fonts/

Bundled font files for card text rendered in code (`lib/cards/`, slice E). All are SIL Open Font
License 1.1 (licence texts beside the files). Static TTF instances, copied from the
`@expo-google-fonts/inter@0.4.2` and `@expo-google-fonts/playfair-display@0.4.2` npm packages
(Google Fonts builds).

| File | Family | Weight | Licence |
|---|---|---|---|
| `Inter_400Regular.ttf` | Inter | 400 | `OFL-Inter.txt` |
| `Inter_500Medium.ttf` | Inter | 500 | `OFL-Inter.txt` |
| `Inter_600SemiBold.ttf` | Inter | 600 | `OFL-Inter.txt` |
| `Inter_700Bold.ttf` | Inter | 700 | `OFL-Inter.txt` |
| `Inter_800ExtraBold.ttf` | Inter | 800 | `OFL-Inter.txt` |
| `PlayfairDisplay_400Regular.ttf` | Playfair Display | 400 | `OFL-PlayfairDisplay.txt` |
| `PlayfairDisplay_700Bold.ttf` | Playfair Display | 700 | `OFL-PlayfairDisplay.txt` |

Use with sharp: `sharp({ text: { text, fontfile: "assets/fonts/Inter_700Bold.ttf", font: "Inter Bold" } })`.
