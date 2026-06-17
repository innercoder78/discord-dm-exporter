# Discord DM Log Exporter

Discord DM Log Exporter is a Chrome extension for saving one-on-one Discord Web DMs as a clean `.txt` log file.

It works locally in your browser while you manually scroll through a DM. It does not use Discord’s API, tokens, bots, or outside servers.

## What It Does

* Records one-on-one Discord Web DMs while you scroll
* Saves messages into a readable TXT log
* Lets you choose the names shown in the exported log
* Supports Date Range mode for cleaner start and end points
* Supports EVERYTHING mode for recording all loaded messages
* Avoids duplicate entries when scrolling back and forth
* Leaves Discord reply previews and edited-message UI metadata out of exported logs
* Ignores emoji reactions
* Adds simple markers for files, images, and voice messages
* Lets you show timestamps and choose their TXT export date/time format
* Uses Chrome’s Save As window when exporting

## Important Notes

This extension only works on Discord Web in Chrome.

It does not work with:

* Discord desktop app
* Discord mobile app
* Server channels
* Group chats
* Threads
* Forums
* Voice channels

The extension does not auto-scroll. You choose where to start, click Start Recording, and scroll manually through the DM.

Discord only loads part of a conversation at a time, so the extension can only capture messages that are loaded while recording.

## Recording Modes

### Date Range

Use Date Range mode when you want cleaner start and end boundaries.

Messages outside the selected date range are not exported.

### EVERYTHING

Use EVERYTHING mode when you want to record every loaded message the extension sees while recording.

This mode may include a few extra nearby messages, so you may need to trim the TXT file afterward.

## Timestamp Export Options

The main extension popup includes a `Show timestamps` checkbox.

If `Show timestamps` is enabled for a recording, the Recording Ended overlay lets you choose timestamp formatting before clicking Export TXT.

Date Format options:

* `MM/DD/YYYY`
* `DD/MM/YYYY`
* `YYYY/MM/DD`

Time Format options:

* `12 HOURS (AM/PM)`
* `24 HOURS (00:00 to 23:59)`

These options affect only how timestamps appear in the exported `.txt` log. They do not change message capture, ordering, deduplication, or filtering.

Date Range filtering still uses the browser date picker. The date picker may display according to your browser or system locale, and the export timestamp format does not change Date Range behavior.

## Basic Workflow

1. Open Discord Web in Chrome.
2. Open the DM you want to log.
3. Scroll to where you want recording to begin.
4. Open the extension.
5. Enter the names/display names.
6. Choose Date Range or EVERYTHING mode.
7. Click START.
8. Click Start Recording on the Discord page.
9. Scroll manually through the DM.
10. Click END RECORDING.
11. If `Show timestamps` was enabled, choose Date Format and Time Format.
12. Click Export TXT.
13. Choose where to save the file.

## Privacy

Everything stays local in your browser.

The extension does not upload your messages or send them anywhere.

## DISCLAIMER

Discord frowns upon such tools. Therefore, if you get your account banned because of it, you assume all risk and liability by using this extension.
