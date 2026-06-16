# Discord DM Log Exporter

Discord DM Log Exporter is a local-only Chrome extension for exporting loaded one-on-one Discord Web direct messages into a clean `.txt` transcript.

All examples in this repository use fictional placeholder names only, such as `JOHN`, `JANE`, `ME`, and `FRIEND`.

## What it does

- Works on Discord Web at `https://discord.com`.
- Lets you set separate export labels for yourself and the other person, such as `JOHN` and `JANE`.
- Lets you enter Discord display names to help identify speakers on the page. Speaker detection works best when both display names are provided.
- Supports Date Range mode and EVERYTHING mode. Date Range mode requires both a start date and an end date.
- Watches messages that are already loaded while you manually scroll. EVERYTHING mode is the only mode that intentionally captures every loaded message during recording.
- Exports a grouped `.txt` transcript with optional timestamps.
- Stores settings and temporary captured messages in `chrome.storage.local`.
- Downloads the transcript with `chrome.downloads.download`.

## What it does not do

- It does not work with the Discord desktop app, mobile app, or tablet app.
- It does not support server channels, group chats, threads, forums, or voice channels.
- It does not use Discord's private API.
- It does not use a Discord user token.
- It does not create a self-bot.
- It does not automate Discord requests or auto-scroll Discord.
- It does not upload logs anywhere.
- It ignores reactions in v1 and does not include emoji reactions, reaction counts, reaction badges, hover buttons, reply/action buttons, or edit/delete controls.

## Compatibility

This extension only works with Discord Web in Chrome.
It does not work with the Discord desktop app, mobile app, or tablet app.

## Scope

This extension is designed only for one-on-one DMs.
It does not support server channels, group chats, threads, forums, or voice channels.

## Installation in Chrome

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder containing `manifest.json`.
6. Pin the extension if you want quick access from the toolbar.

## Usage

1. Open the extension popup.
2. Set your export labels. Defaults are `ME` and `FRIEND`.
3. Enter both Discord display names, such as `john_example` and `jane_example`, for the most reliable speaker detection. Export labels remain separate from Discord display names.
4. Choose Date Range mode by setting both a start date and an end date, or check **EVERYTHING**. The popup will not save Date Range settings unless both dates are present.
5. Click **Save Settings**.
6. Click **Go to Discord Web**.
7. Manually open the correct one-on-one DM in Discord Web.
8. Follow the overlay instructions:
   - In Date Range mode, scroll up to the start-date area, ideally a few messages before that date.
   - In EVERYTHING mode, scroll up to the first day of the conversation. EVERYTHING is the only mode designed to capture all loaded messages.
9. Click **Start Recording** in the overlay.
10. Manually scroll downward through the conversation.
11. Click **Stop Recording**.
12. Click **Export TXT**.
13. Clear captured data from the overlay when finished.

## Export format

Without timestamps:

```text
JOHN:
Hey, how are you?

JANE:
Doing well. How about you?

JOHN:
Glad to hear that.
```

With timestamps enabled:

```text
[2025-01-01 09:14]
JOHN:
Hey, how are you?

[2025-01-01 09:16]
JANE:
Doing well.
```

Attachment markers use the selected export label:

```text
JOHN:
[JOHN SENT A FILE]

JANE:
[VOICE MESSAGE]
```

## Privacy

This extension does not upload, transmit, sell, or share your messages.
All captured messages remain in your browser's local storage until you export or clear them.
Do not commit exported chat logs to GitHub. Date Range mode excludes messages outside the selected range; EVERYTHING mode intentionally captures all messages loaded while recording.

## Public repository safety

The `.gitignore` excludes exported chat logs, transcripts, private local settings, operating system files, editor folders, and common Node/package-manager files. Do not add personal chat logs, screenshots of real conversations, or private local configuration to commits.

## License

MIT. See [LICENSE](LICENSE).
