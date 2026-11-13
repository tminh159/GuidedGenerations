# Guided Generations for Lumiverse

A Lumiverse Spindle extension recreating the core workflows of [GuidedGenerations-Extension](https://github.com/Samueras/GuidedGenerations-Extension/) for Lumiverse.

## Features

- **Guided Response** — Steer the next AI reply using your composer text as temporary guidance without adding a user message to the chat.
- **Guided Continue** — Continue the last AI message with optional guidance text.
- **Guided Regenerate** — Replace the trailing AI message with a fresh regenerated reply (restores the original message automatically if generation fails before producing output).
- **Guided Swipe** — Create a new swipe on the last AI message steered by optional guidance text.
- **Impersonation** — Draft the user's next message directly into the composer input box.
- **Input Recovery** — Automatically saves composer text cleared by guided actions so you can restore previous drafts.
- **Per-Option Overrides** — Configure each action independently with its own API Connection Profile, Model (blank uses the connection profile's current model), Preset, Injection Role (`system` / `user` / `assistant`), Instruction Template (`{{input}}`), and Clear Input toggle.
- **Toolbar Position & Order** — Choose where the buttons appear (`Inline (after native buttons)`, `Left side (before native buttons)`, `Right side (top bar)`, or `Separate row (below native buttons)`) and reorder buttons from the **Guided Generations** drawer tab.

## Installation in Lumiverse

1. Open Lumiverse **Extension Manager**.
2. Choose **Install from GitHub** and enter:
   ```text
   https://github.com/tminh159/GuidedGenerations
   ```
3. Enable **Guided Generations** and grant the requested permissions (`generation`, `chats`, `chat_mutation`, `presets`).

## Development

```bash
bun install
bun run typecheck
bun run build
bun test tests
```
