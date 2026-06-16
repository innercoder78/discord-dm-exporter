# Discord DM Log Exporter

Discord DM Log Exporter is a local-only Chrome extension for exporting loaded one-on-one Discord Web direct messages into a clean `.txt` transcript.

All examples in this repository use fictional placeholder names only, such as `JOHN`, `JANE`, `ME`, and `FRIEND`.

## What it does

- Works on Discord Web at `https://discord.com`.
- Lets you set separate export labels for yourself and the other person, such as `JOHN` and `JANE`.
- Lets you enter Discord display names to help identify speakers on the page. Speaker detection works best when both display names are provided.
- Supports Date Range mode and EVERYTHING mode. Date Range mode requires both a start date and an end date.
- Watches messages only while recording, so the extension stays idle before confirmation and after stopping to reduce CPU usage. EVERYTHING mode is the only mode that intentionally captures every loaded message during recording.
- Exports a grouped `.txt` transcript with optional timestamps.
- Stores settings and temporary captured messages in `chrome.storage.local`.
- Downloads the transcript with `chrome.downloads.download` and `saveAs: true` so Chrome opens the Save As dialog.

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

1. Open Discord Web manually.
2. Open the correct one-on-one DM manually.
3. Scroll to where recording should begin.
4. Open the extension popup.
5. Configure labels and Date Range or EVERYTHING. Defaults are `ME` and `FRIEND`; examples should use generic names such as `JOHN` and `JANE`.
6. Click **START**.
7. Confirm in the Discord page overlay by clicking **Start Recording**.
8. Watch the overlay counter while manually scrolling.
9. Click **END RECORDING**.
10. Choose or edit the `.txt` file name in the overlay.
11. Click **Export TXT**.
12. Choose the save location in Chrome's Save As dialog.
13. Clear captured data from the overlay when finished.

## START and performance notes

- START should show the Discord page overlay or a clear popup error. If Discord Web is not the active tab, the popup tells you to open Discord Web manually, open the correct one-on-one DM, scroll to where recording should begin, and click **START** again.
- START should work without reloading the Discord page, including when Discord Web was already open before the extension was loaded or updated.
- If the extension was just updated, wait until Discord is fully loaded and click **START** again if the first attempt cannot start. A page reload should not normally be required.
- The extension only observes the Discord message list while recording, and it throttles capture work to reduce CPU usage. It does not continuously rescan the page while idle.
- Export uses Chrome's Save As dialog so you can choose the `.txt` file name and save location.
- The extension does not automatically choose private folder paths or silently save into a hidden location.

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
