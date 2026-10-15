# Rylaide UI

UI-only workspace for the Rylaide app: screens from Figma, animations and app branding, kept separate from the main app code.

## App icon ("Linked Riders", dark)

The master icon is a vector redraw of the dark-background concept, so it stays sharp at every size.

| Path | Use |
|---|---|
| `assets/brand/rylaide-icon.svg` | Master icon (rounded dark tile) |
| `assets/brand/rylaide-icon-square.svg` | Full-bleed square for stores and OS-masked icons |
| `assets/brand/rylaide-icon-foreground.svg` | Rings + signal only, transparent, for adaptive icons |
| `assets/icons/android/res/` | Drop into `android/app/src/main/res/` (legacy, round and adaptive mipmaps, background `#232B36`) |
| `assets/icons/android/play_store_512.png` | Google Play listing icon |
| `assets/icons/ios/AppIcon.appiconset/` | Replace `ios/Runner/Assets.xcassets/AppIcon.appiconset` (or your app's equivalent) |
| `assets/icons/web/` | Favicons, Apple touch icon and PWA icons (192, 512, maskable 512) |

### Colors

| Token | Hex |
|---|---|
| Background | `#232B36` (gradient `#3A434D` → `#1A222C`) |
| Orange | `#FFB13B` → `#F57C1F` |
| Teal | `#22B8B8` → `#3FD9CF` |
