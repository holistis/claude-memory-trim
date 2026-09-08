#!/usr/bin/env node
// test.mjs -- no dependencies, matches the project's own promise.
// Spawns the real trim-worklog.mjs against throwaway temp directories and
// inspects the resulting files. No mocking of fs -- these are the actual
// failure modes reported in an external audit (2026-09-08), reproduced here
// so they cannot come back silently.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "trim-worklog.mjs");

let passed = 0, failed = 0;

function test(name, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memtrim-test-"));
    try {
        fn(dir);
        console.log("PASS  " + name);
        passed++;
    } catch (err) {
        console.log("FAIL  " + name);
        console.log("      " + err.message);
        failed++;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function writeHot(dir, entries) {
    fs.mkdirSync(path.join(dir, "memory/hot"), { recursive: true });
    fs.writeFileSync(path.join(dir, "memory/hot/work_log_recent.md"), entries);
}

function readHot(dir) {
    return fs.readFileSync(path.join(dir, "memory/hot/work_log_recent.md"), "utf8");
}

function coldExists(dir) {
    return fs.existsSync(path.join(dir, "memory/cold/work_log.md"));
}

function readCold(dir) {
    return fs.readFileSync(path.join(dir, "memory/cold/work_log.md"), "utf8");
}

function countEntries(text) {
    return (text.match(/^## /gm) || []).length;
}

function run(dir, budget) {
    return spawnSync(process.execPath, [SCRIPT, String(budget)], {
        cwd: dir,
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        encoding: "utf8",
    });
}

const FIVE_SESSIONS = Array.from({ length: 5 }, (_, i) =>
    `## 2026-09-0${i + 1} 09:00 -- sessie ${i + 1} (fictief)\n- deed taak\n- notitie\n`
).join("\n");

// --- The exact scenario from the external audit: memory/cold/ does not exist yet. ---
test("geen dataverlies wanneer memory/cold/ nog niet bestaat (het gerapporteerde scenario)", (dir) => {
    writeHot(dir, FIVE_SESSIONS);
    assert.equal(fs.existsSync(path.join(dir, "memory/cold")), false, "test-aanname: cold-map bestaat nog niet");

    const before = countEntries(readHot(dir));
    const r = run(dir, 12); // klein budget, forceert een move
    assert.equal(r.status, 0, "script moet slagen: " + r.stderr);

    const afterHot = countEntries(readHot(dir));
    assert.ok(coldExists(dir), "cold-archief moet zijn aangemaakt");
    const afterCold = countEntries(readCold(dir));

    assert.equal(afterHot + afterCold, before, "geen enkele sessie mag verdwijnen: " + afterHot + " + " + afterCold + " != " + before);
});

// --- Failure injection: force the archive write itself to fail (a directory
// sits where the file needs to go), and prove hot is left untouched. ---
test("hot log blijft ongewijzigd als de archiefschrijving mislukt", (dir) => {
    writeHot(dir, FIVE_SESSIONS);
    // Maak een MAP op het pad waar het archiefbestand moet komen: de rename
    // van het tijdelijke bestand faalt dan gegarandeerd, ongeacht platform.
    fs.mkdirSync(path.join(dir, "memory/cold/work_log.md"), { recursive: true });

    const before = readHot(dir);
    const r = run(dir, 12);

    assert.notEqual(r.status, 0, "script moet met een foutcode stoppen");
    assert.equal(readHot(dir), before, "hot log mag niet aangeraakt zijn na een mislukte archiefschrijving");
});

// --- Existing cold archive gets appended to, not overwritten. ---
test("bestaand archief wordt aangevuld, niet overschreven", (dir) => {
    writeHot(dir, FIVE_SESSIONS);
    fs.mkdirSync(path.join(dir, "memory/cold"), { recursive: true });
    fs.writeFileSync(path.join(dir, "memory/cold/work_log.md"), "# Work log archive\n\n## 2026-08-01 oude sessie\n- iets van vroeger\n");

    const r = run(dir, 12);
    assert.equal(r.status, 0, "script moet slagen: " + r.stderr);

    const cold = readCold(dir);
    assert.match(cold, /oude sessie/, "bestaande archiefinhoud moet bewaard blijven");
    assert.ok(countEntries(cold) >= 2, "nieuw verplaatste entries moeten erbij komen, niet vervangen");
});

// --- No-op when under budget: nothing should move, nothing should be created. ---
test("doet niets als het budget niet overschreden wordt", (dir) => {
    writeHot(dir, FIVE_SESSIONS);
    const before = readHot(dir);

    const r = run(dir, 200); // ruim budget, geen enkele sessie hoeft te verhuizen
    assert.equal(r.status, 0, "script moet slagen: " + r.stderr);
    assert.equal(readHot(dir), before, "hot log mag niet veranderen als het budget niet overschreden is");
    assert.equal(coldExists(dir), false, "er mag geen archief ontstaan als er niets te verplaatsen is");
});

// --- Missing hot log entirely: script should no-op cleanly, not crash. ---
test("geeft netjes op als de hot log helemaal niet bestaat", (dir) => {
    const r = run(dir, 200);
    assert.equal(r.status, 0, "ontbrekende hot log is geen fout");
    assert.equal(coldExists(dir), false);
});

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
