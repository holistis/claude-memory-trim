#!/usr/bin/env node
// trim-worklog.mjs -- keeps Claude Code session memory lean.
// Moves oldest entries from hot log to cold archive when line budget exceeded.
// Only cuts on "## " boundaries. Nothing deleted -- only moved.
// The archive is written first, atomically (temp file + rename), and the hot
// log is only trimmed once that write is confirmed on disk. If the archive
// write fails for any reason (missing directory, no permissions, disk full),
// the hot log is left untouched and the script exits non-zero instead of
// silently losing the entries it was about to move.
// Usage: node trim-worklog.mjs [budget]  (default: 200 lines)

import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const HOT  = path.join(ROOT, "memory/hot/work_log_recent.md");
const COLD = path.join(ROOT, "memory/cold/work_log.md");

const MAX_LINES = parseInt(process.argv[2] || process.env.WORKLOG_MAX_LINES || "200", 10);
const MIN_KEEP  = 3;

if (!fs.existsSync(HOT)) {
    console.log("[trim-worklog] hot log not found, nothing to do.");
    process.exit(0);
}

const hot    = fs.readFileSync(HOT, "utf8").split("\n");
const starts = hot.reduce((acc, line, i) => {
    if (line.startsWith("## ")) acc.push(i);
    return acc;
}, []);

if (starts.length <= MIN_KEEP) process.exit(0);

let keep = starts.length, cum = 0;
for (let i = 0; i < starts.length; i++) {
    const size = (i + 1 < starts.length ? starts[i + 1] : hot.length) - starts[i];
    if (i >= MIN_KEEP && cum + size > MAX_LINES) { keep = i; break; }
    cum += size;
}

if (keep >= starts.length) process.exit(0);

const cutAt   = starts[keep];
const hotKeep = hot.slice(0, cutAt);
const moved   = hot.slice(cutAt);
const trim    = (a) => {
    const r = a.slice();
    while (r.length && !r[r.length - 1].trim()) r.pop();
    return r;
};

const cold      = fs.existsSync(COLD)
  ? fs.readFileSync(COLD, "utf8").split("\n")
    : ["# Work log archive", ""];
const ci        = cold.findIndex(l => l.startsWith("## "));
const coldIntro = ci === -1 ? cold : cold.slice(0, ci);
const coldBody  = ci === -1 ? []   : cold.slice(ci);

const newCold = trim(coldIntro).join("\n") + "\n\n" +
                trim(moved).join("\n") + "\n\n---\n\n" +
                coldBody.join("\n");

// Archive first, atomically, and only then touch the hot log. Writing HOT
// before COLD (the previous order) truncated the hot log even when the COLD
// write failed right after -- e.g. because memory/cold/ did not exist yet,
// since writeFileSync never creates missing parent directories. That silently
// dropped the moved entries from both files. mkdir + temp-file + rename closes
// that window: either the archive lands completely, or HOT is never touched.
fs.mkdirSync(path.dirname(COLD), { recursive: true });
const tmpPath = COLD + ".tmp-" + process.pid;
try {
    fs.writeFileSync(tmpPath, newCold);
    fs.renameSync(tmpPath, COLD);
} catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch { /* best effort cleanup */ }
    console.error("[trim-worklog] failed to write cold archive, hot log left untouched: " + err.message);
    process.exit(1);
}

fs.writeFileSync(HOT, trim(hotKeep).join("\n") + "\n");

const n = moved.filter(l => l.startsWith("## ")).length;
console.log("[trim-worklog] moved " + n + " entries to cold. Hot: " + keep + " entries, " + trim(hotKeep).length + " lines.");
