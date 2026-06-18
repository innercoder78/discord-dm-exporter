# Discord DM Log Exporter

Discord DM Log Exporter is a local-only Chrome extension for saving one-on-one Discord Web direct messages as a clean `.txt` file.

It is designed for personal use in Chrome. It does not upload your messages anywhere.

## What it does

* Works on Discord Web in Chrome.
* Exports one-on-one DMs to a `.txt` file.
* Lets you choose the names that appear in the exported log.
* Supports Date Range mode and EVERYTHING mode.
* Allows same-day Date Range exports.
* Uses local calendar dates for Date Range mode.
* Lets you include timestamps and choose the timestamp format before export.
* Uses your browser’s local time for exported timestamps.
* Avoids duplicate entries when you scroll back and forth.
* Helps keep messages, files, images, embeds, stickers, and voice-message markers tied to the right message.
* Leaves out reactions, reply previews, edited-message labels, and Discord buttons or controls.
* Adds simple markers for files, images, and voice messages.
* Uses Chrome’s Save As window when exporting.

## What it does not do

* It does not work with the Discord desktop app, mobile app, or tablet app.
* It does not support servers, channels, group DMs, forums, threads, or voice channels.
* It does not use Discord’s API.
* It does not use a Discord token.
* It does not create a bot or self-bot.
* It does not auto-scroll.
* It does not upload, send, sell, or share your messages.

## Installation in Chrome

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the folder that contains `manifest.json`.
6. Pin the extension if you want quick access from the toolbar.

## Basic use

1. Open Discord Web in Chrome.
2. Open the one-on-one DM you want to export.
3. Scroll to where the recording should begin.
4. Open the extension popup.
5. Set the names you want in the exported log.
6. Enter both Discord display names for better speaker detection. Do not include server tags.
7. Choose Date Range mode or EVERYTHING mode.
8. Click **START**.
9. In the Discord page overlay, click **Start Recording**.
10. Scroll manually through the DM.
11. Click **END RECORDING**.
12. Click **Export TXT**.
13. Choose the file name and folder in Chrome’s Save As window.
14. Clear the captured data when finished.

## Recording modes

### Date Range

Date Range mode exports messages that fall within the selected local calendar dates.

Use this when you want a cleaner start and end point. The Start date and End date can be the same day.

### EVERYTHING

EVERYTHING mode records every loaded message the extension sees while recording.

Use this when you want everything you manually scroll through. You may need to trim a few extra lines from the TXT file afterward.

## Important note about scrolling

Discord only loads part of a conversation at a time.

The extension can only capture messages that Discord has loaded into the page. It scans loaded messages when recording starts, while you scroll, when recording ends, and again before export.

It does not auto-scroll. You control the scrolling.

## Privacy

This extension works locally in your browser.

Captured messages are stored in Chrome’s local extension storage until you export or clear them. The extension does not send your messages to any server.

## License

MIT. See [LICENSE](LICENSE).
