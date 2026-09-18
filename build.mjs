// Rebuilds the meetings list and the shared-resources list on index.html from Google Sheets
// published as CSV. Run by .github/workflows/sync.yml, or by hand with `node build.mjs`.
//
// Safety rules this script follows, in order of importance:
//   1. It never blanks a section. If a URL is missing, unreachable, or returns nothing usable,
//      that part of the page is left exactly as it was.
//   2. Everything coming from a spreadsheet is HTML-escaped, and links are allowed only if they
//      are http or https, so a stray cell cannot inject markup or a javascript: URL into the site.
//   3. It only writes index.html when the output actually changed, so the workflow does not
//      create empty commits.

import { readFile, writeFile } from "node:fs/promises";

const FILE = "index.html";
const CFG = "data/sources.json";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// A link is used only if it is a well-formed http(s) URL. Anything else is dropped.
function safeUrl(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") ? s : "";
  } catch { return ""; }
}

// Minimal CSV parser that understands quoted fields, escaped quotes, and newlines inside cells.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

// Column headers are matched loosely, so renaming a Google Form question from "Resource title"
// to "Title of resource" does not break the site.
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function toObjects(rows) {
  if (rows.length < 2) return [];
  const head = rows[0].map(norm);
  return rows.slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
// Headers are matched first exactly, then by "contains", so a Google Form question worded
// "Link to Resource" or "Short description of resource" still lands in the right place.
// Returns [value, headerKey] so two fields can never claim the same column.
function pickKey(o, keys, taken = []) {
  for (const k of keys) if (o[k] && !taken.includes(k)) return [o[k], k];
  for (const k of keys) {
    for (const h of Object.keys(o)) {
      if (h.includes(k) && o[h] && !taken.includes(h)) return [o[h], h];
    }
  }
  return ["", ""];
}
const pick = (o, ...keys) => pickKey(o, keys)[0];
const isYes = (v) => ["yes", "y", "true", "x", "1", "approved", "checked"].includes(String(v).trim().toLowerCase());

async function fetchCsv(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (/^\s*<!doctype html|^\s*<html/i.test(text)) {
    throw new Error("got a web page instead of CSV — the sheet is probably not published to the web");
  }
  return text;
}

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
function longDate(iso) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(iso).trim());
  if (m) return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
  const d = new Date(iso);
  if (!isNaN(d)) return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return String(iso).trim();
}
const sortKey = (iso) => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(iso).trim());
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
  const d = new Date(iso);
  return isNaN(d) ? "9999" : d.toISOString().slice(0, 10);
};

function renderMeetings(rows) {
  const meetings = rows
    .map((r) => ({
      date: pick(r, "date", "meetingdate"),
      time: pick(r, "time", "meetingtime") || "10:00 to 11:00 am",
      agenda: safeUrl(pick(r, "agendaurl", "agenda", "agendalink")),
      notes: safeUrl(pick(r, "notesurl", "notes", "noteslink")),
    }))
    .filter((m) => m.date)
    .sort((a, b) => sortKey(a.date).localeCompare(sortKey(b.date)));
  if (!meetings.length) return null;

  return meetings.map((m) => {
    const label = longDate(m.date);
    const doc = (url, word) => url
      ? `<a class="doc" href="${esc(url)}">${word}<span class="sr"> for the ${esc(label)} meeting</span></a>`
      : `<span class="doc none">${word} not posted<span class="sr"> for the ${esc(label)} meeting</span></span>`;
    return `
        <div class="meet">
          <p class="meet-date">${esc(label)}<span class="meet-time">${esc(m.time)}</span></p>
          <p class="docs">
            ${doc(m.agenda, "Agenda")}
            ${doc(m.notes, "Notes")}
          </p>
        </div>`;
  }).join("\n");
}

// The accessibility question offers Yes, No, and Unsure. Say which it is rather than only
// flagging the good case, because "not checked" is the thing a reader most needs to know.
function a11yLabel(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "yes" || s.startsWith("yes")) return "Checked for accessibility";
  if (s.startsWith("no")) return "Not checked for accessibility";
  return "Accessibility not confirmed";
}

function renderResources(rows) {
  const items = rows
    .map((r) => {
      const [title] = pickKey(r, ["resourcetitle", "title", "nameoftheresource"]);
      const [url] = pickKey(r, ["linktoresource", "resourcelink", "linkto", "link", "url"]);
      const [desc] = pickKey(r, ["shortdescription", "description", "whatisit"]);
      const [category] = pickKey(r, ["category", "type", "topic"]);
      const [who, whoKey] = pickKey(r, ["yournameandcollege", "nameandcollege", "yourname", "submittedby", "submitter", "name"]);
      const [college] = pickKey(r, ["yourcollege", "college", "institution"], [whoKey]);
      return {
        title, url: safeUrl(url), desc, category, who, college,
        a11y: pick(r, "hasthisbeencheckedforaccessibility", "accessibility", "accessible"),
        approved: pick(r, "approved", "approve", "publish"),
      };
    })
    .filter((x) => isYes(x.approved) && x.title && x.url);

  if (!items.length) {
    return `        <p class="res-empty">No resources have been posted yet.</p>`;
  }
  return items.map((x) => {
    const by = [x.who, x.college].filter(Boolean).map(esc).join(", ");
    const a11y = a11yLabel(x.a11y);
    const meta = [
      x.category ? `<span class="res-tag">${esc(x.category)}</span>` : "",
      by ? `Shared by ${by}` : "",
      a11y ? `<span class="res-a11y">${esc(a11y)}</span>` : "",
    ].filter(Boolean).join(" · ");
    return `
        <article class="res-item">
          <p class="res-title"><a href="${esc(x.url)}">${esc(x.title)}</a></p>
          ${x.desc ? `<p class="res-desc">${esc(x.desc)}</p>` : ""}
          ${meta ? `<p class="res-meta">${meta}</p>` : ""}
        </article>`;
  }).join("\n");
}

function splice(html, name, body) {
  const a = `<!-- ${name}:START -->`, b = `<!-- ${name}:END -->`;
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i === -1 || j === -1) { console.log(`  ${name}: markers missing, skipped`); return html; }
  return html.slice(0, i + a.length) + "\n" + body + "\n        " + html.slice(j);
}

const cfg = JSON.parse(await readFile(CFG, "utf8"));
const before = await readFile(FILE, "utf8");
let html = before;

if (cfg.meetingsCsvUrl) {
  try {
    const body = renderMeetings(toObjects(parseCsv(await fetchCsv(cfg.meetingsCsvUrl))));
    if (body) { html = splice(html, "MEETINGS", body); console.log("  meetings: updated"); }
    else console.log("  meetings: sheet had no usable rows, left as is");
  } catch (e) { console.log(`  meetings: ${e.message} — left as is`); }
} else console.log("  meetings: no URL set, left as is");

if (cfg.resourcesCsvUrl) {
  try {
    const body = renderResources(toObjects(parseCsv(await fetchCsv(cfg.resourcesCsvUrl))));
    html = splice(html, "RESOURCES", body); console.log("  resources: updated");
  } catch (e) { console.log(`  resources: ${e.message} — left as is`); }
} else console.log("  resources: no URL set, left as is");

const form = safeUrl(cfg.submitFormUrl);
html = splice(html, "SUBMIT", form
  ? `      <p class="docrow"><a class="cta" href="${esc(form)}">Share a resource with the group</a></p>`
  : `      <p class="note">Submissions open soon.</p>`);

if (html !== before) { await writeFile(FILE, html); console.log("index.html written"); }
else console.log("no changes");
