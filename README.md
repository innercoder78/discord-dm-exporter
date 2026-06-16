# Discord DM Log Exporter

Discord DM Log Exporter is a local-only Chrome extension for exporting loaded one-on-one Discord Web direct messages into a clean `.txt` transcript.

All examples in this repository use generic placeholder names only, such as `JOHN`, `JANE`, `john_example`, `jane_example`, `ME`, and `FRIEND`.

## What it does

- Works on Discord Web at `https://discord.com`.
- Popup fields labeled “The Name You Want On The Log For Yourself” and “The Name You Want On The Log For The Other Person” control which names appear in the exported transcript, such as `JOHN` and `JANE`.
- Popup fields labeled “Your Discord Name” and “Other Person's Name” are used to identify speakers from Discord. Speaker detection works best when both names are provided.
- Supports Date Range mode and EVERYTHING mode. Date Range mode requires both a start date and an end date.
- Watches messages only while recording, so the extension stays idle before confirmation and after stopping to reduce CPU usage. EVERYTHING mode is the only mode that intentionally captures every loaded message during recording.
- Captures only messages that Discord has already loaded into the page. While recording, you must scroll down manually through the conversation so Discord loads the messages you want to export.
- Deduplicates messages during each recording session so scrolling back and forth over already loaded messages should not create duplicate transcript entries.
- Exports a grouped `.txt` transcript with optional timestamps.
- Stores settings and temporary captured messages in `chrome.storage.local`.
- Downloads the transcript with `chrome.downloads.download` and `saveAs: true` so Chrome opens the Save As dialog. The extension uses a default filename like `discord-dm-log-YYYY-MM-DD.txt`, but you can rename it in that Save As window.

## What it does not do

- It does not work with the Discord desktop app, mobile app, or tablet app.
- It does not support server channels, group chats, threads, forums, or voice channels.
- It does not use Discord's private API.
- It does not use a Discord user token.
- It does not create a self-bot.
- It does not automate Discord requests or auto-scroll Discord. You control all scrolling manually.
- It does not upload logs anywhere.
- Reactions are not included, and the popup shows this as the informational note “No Reactions Included.” The export does not include emoji reactions, reaction counts, reaction badges, hover buttons, reply/action buttons, or edit/delete controls.

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
5. Configure the “The Name You Want On The Log…” fields for transcript names, the “Your Discord Name” and “Other Person's Name” fields for speaker detection from Discord, and Date Range or EVERYTHING. Defaults are `ME` and `FRIEND`; examples should use generic names such as `JOHN`, `JANE`, `john_example`, and `jane_example`.
6. Click **START**. The popup closes after the Discord overlay opens successfully, and the Discord overlay becomes the main recording window.
7. Confirm in the Discord page overlay by clicking **Start Recording**. Recording does not begin directly from the popup. You can click **Cancel** instead to close the ready-to-record overlay without starting recording, saving messages, or changing your popup settings.
8. Watch the overlay counter while manually scrolling down through the conversation. The extension only captures messages that Discord has loaded into the page; it cannot capture unloaded history or future messages until Discord renders them.
9. Click **END RECORDING**.
10. Click **Export TXT**.
11. Chrome will open a Save As window where you can choose the file name and folder. The default filename is like `discord-dm-log-YYYY-MM-DD.txt`, and you can rename it in the Save As window if you want.

## START and performance notes

- START should show the Discord page overlay or a clear popup error. If Discord Web is not the active tab, the popup stays open and tells you to open Discord Web manually, open the correct one-on-one DM, scroll to where recording should begin, and click **START** again. After START succeeds, the popup closes and the Discord overlay remains visible.
- START should work without reloading the Discord page, including when Discord Web was already open before the extension was loaded or updated.
- **Cancel** on the ready-to-record overlay closes that overlay, leaves recording idle, keeps your popup settings saved, and lets you click **START** again later for a fresh ready-to-record overlay.
- If the extension was just updated, wait until Discord is fully loaded and click **START** again if the first attempt cannot start. A page reload should not normally be required.
- The extension only observes the Discord message list while recording, and it throttles capture work to reduce CPU usage. It does not continuously rescan the page while idle. It does not use Discord's API and does not auto-scroll; messages are captured as Discord loads them during your manual scrolling.
- Scrolling back and forth over the same loaded messages should not duplicate the export because messages are deduplicated with Discord message IDs when available and stable fallback keys otherwise.
- After **END RECORDING**, click **Export TXT**. Export uses Chrome's Save As dialog so you can choose the `.txt` file name and save location. The extension passes a default filename like `discord-dm-log-YYYY-MM-DD.txt`, but you can rename it in Save As.
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
All captured messages remain in your browser's local storage until you export or clear them. Canceling from the ready-to-record overlay does not start or save a recording.
Do not commit exported chat logs to GitHub. Date Range mode excludes messages outside the selected range; EVERYTHING mode intentionally captures all messages loaded while recording.

## Public repository safety

The `.gitignore` excludes exported chat logs, transcripts, private local settings, operating system files, editor folders, and common Node/package-manager files. Do not add personal chat logs, screenshots of real conversations, or private local configuration to commits.

## License

MIT. See [LICENSE](LICENSE).
