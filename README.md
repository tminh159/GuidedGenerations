# Guided Generations for Lumiverse

A Lumiverse Spindle extension recreating the core workflows of [GuidedGenerations-Extension](https://github.com/Samueras/GuidedGenerations-Extension/) for Lumiverse.

## Features

- **Guided Response** — Steer the next AI reply using your composer text as temporary guidance without adding a user message to the chat.
- **Guided Continue** — Click to continue the last AI message with optional guidance text, or click-and-hold (also `Ctrl/Cmd+Click`, `Shift+F10`, `Alt+Up`, or `Ctrl/Cmd+Enter`) to open the drop-up menu with **Remove the last continue** and **Regenerate last continue**.
- **Guided Regenerate** — Replace the trailing AI message with a fresh regenerated reply (restores the original message automatically if generation fails before producing output).
- **Guided Swipe** — Click to create a new swipe on the last AI message steered by optional guidance text, or click-and-hold (also `Ctrl/Cmd+Click`, `Ctrl/Cmd+Enter`, or `Ctrl/Cmd+Space`) to generate in background swipe mode without leaving your current swipe.
- **Impersonation** — Draft the user's next message directly into the composer input box.
- **Input Recovery** — When enabled, automatically saves any non-empty composer text (`inputText`) used on guided runs (even when **Clear input bar when triggered** is disabled), up to a configurable **Max saved drafts** setting (`1–50`). Click to restore the latest saved draft (or clear the current composer input when no saved drafts exist), or click-and-hold (also `Ctrl/Cmd+Click`, `Shift+F10`, `Alt+Up`, or `Ctrl/Cmd+Enter`) to open the drop-up menu with **History** (browse and restore any saved draft) and **Clear History**.
- **Background Chat Heads** — Shows floating draggable Chat Head bubbles for active or recently completed guided runs in background chats, letting you jump back to the chat with a click.
- **Streaming Indicator** — Displays a Lumiverse-style three-dot streaming indicator on the target message while a guided generation run is active.
- **Message Pill Metrics** — Records token counts and generation timing metrics (`tokenCount` / `generationMetrics`) onto generated messages and swipes so Lumiverse's native message metrics pill and tooltip stay accurate.
- **Per-Option Overrides** — Configure each action independently with its own API Connection Profile, Model (blank uses the connection profile's current model), Preset, Injection Role (`system` / `user` / `assistant`), Guidance Position (`before_post_history`, `in_history`, `pre_history`, `post_history`), In-history Depth (`0–999` when using `in_history`), Apply Regex toggle, Guidance Template (`{{input}}` plus Lumiverse macros such as `{{char}}` and `{{user}}`), and Clear Input toggle.
- **Toolbar Position & Order** — Choose where the buttons appear (`Inline (after native buttons)`, `Left side (before native buttons)`, `Right side (top bar)`, or `Separate row (below native buttons)`) and reorder buttons from the **Guided Generations** drawer tab.

## Installation in Lumiverse

1. Open Lumiverse **Extension Manager**.
2. Choose **Install from GitHub** and enter:
   ```text
   https://github.com/tminh159/GuidedGenerations
   ```
3. Enable **Guided Generations** and grant the requested permissions (`generation`, `chats`, `chat_mutation`, `characters`, `presets`, `regex_scripts`, `interceptor`).

## Development

```bash
bun install
bun run typecheck
bun run build
bun test tests
```

