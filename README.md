# Project Zero

A multi-game Roblox script hub with a shared Cascade UI.  
Supports multiple games through a single loader.

## Supported Games

- 99 Nights in the Forest
- Blox Fruits
- Death Ball
- Murder Mystery 2
- Survive Zombie Arena

## Usage

1. Execute the loader in your Roblox executor:
   ```
   loadstring(game:HttpGet("https://raw.githubusercontent.com/xphuphirayy-hue/Projact-Zero/refs/heads/main/load.lua"))()
   ```
2. The loader auto-detects the game by PlaceId and loads the matching script.
3. UI is shared across all games via `ui_shared.lua`.

## Files

| File | Description |
|------|-------------|
| `99n.lua` | 99 Nights in the Forest |
| `BF.lua` | Blox Fruits |
| `DB.lua` | Death Ball |
| `mm2.lua` | Murder Mystery 2 |
| `SZA.lua` | Survive Zombie Arena |

## Features

- Shared UI for all maps (Info & Update Log first)
- Cascade UI (macOS Sequoia style)
- Multi-map support
- Obfuscated builds available

## Credits

- Developer Main: Owen MochiMimi
- Team: Project Zero
- Discord: https://discord.gg/qpcrvbGSjg

## Disclaimer

Use at your own risk. This project is for educational purposes.
