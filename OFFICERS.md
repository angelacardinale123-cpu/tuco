# Updating ccctutoring.org

You do not need to touch any code. The website reads two Google Sheets and rebuilds itself
every 15 minutes.

## To post a meeting, an agenda, or notes

1. Open the **TUCO Meetings** sheet.
2. Add a row, or fill in a blank cell on an existing row.
   - **date** — write it as `2026-10-16` (year, month, day). This is what puts meetings in order.
   - **time** — for example `10:00 to 11:00 am`. Leave it blank and it uses that by default.
   - **agenda_url** — paste the Google Doc link. Leave blank and the site shows "Agenda not posted".
   - **notes_url** — same, for the notes.
3. Wait up to 15 minutes. The website updates itself.

Before you paste a Doc link, open it in a private browsing window. If it asks you to request
access, coordinators will hit the same wall. In Google Docs use **Share**, then set
**Anyone with the link** to **Viewer**.

## To publish a resource somebody submitted

1. Open the **TUCO Resources** sheet. Every form submission lands here as a new row.
2. Read it. If it belongs on the site, put `Yes` in the **Approved** column.
3. Wait up to 15 minutes.

To take something down, clear the **Approved** cell. Do not delete the row, so you keep the record.

Nothing appears on the website until somebody approves it. Submitter email addresses stay in the
sheet and are never published.

## If something looks wrong

The website never blanks itself. If a sheet is unreachable, or a link is broken, or somebody
deletes the wrong thing, the site keeps showing the last good version and simply stops updating
until the sheet is fixed.

To see what happened, or to update immediately instead of waiting: go to the **Actions** tab of
this repository, open **Sync site from Google Sheets**, and choose **Run workflow**. A red X
means the last run failed, and clicking it shows why.

## What only a developer can change

Anything about how the site looks or is laid out, and any section other than the meetings list
and the resources list. Those live in `index.html`.
