# claude-memory-trim

Keeps your [Claude Code](https://claude.ai/code) session memory lean by automatically rotating session logs between hot (fast) and cold (archive) storage.

## The problem

Claude Code reads your memory files on every session start. If your work log grows unbounded, you pay for old context you don't need. After a few weeks of active development, this easily adds 3,000-8,000 tokens per session — just for stale history.

## How it works

You keep two files:
- `memory/hot/work_log_recent.md` — last 3-5 sessions, read every start
- - `memory/cold/work_log.md` — full archive, read only when needed
 
  - `trim-worklog.mjs` runs on session start and moves the oldest entries to cold the moment hot exceeds your line budget. It only cuts on `## ` boundaries, so no entry is ever split. Nothing is deleted.
 
  - ## Usage
 
  - ```bash
    node trim-worklog.mjs           # default: 200-line budget
    node trim-worklog.mjs 150       # custom budget
    ```

    Hook it into Claude Code's session-start script (`.claude/hooks/session-start.sh`) so it runs automatically.

    ## Token savings (real numbers from production)

    | Hot log state | Lines | Approx. tokens/session |
    |---|---|---|
    | Unbounded (3 weeks) | 680 | ~8,500 |
    | With trim (budget 200) | 190 | ~2,400 |
    | Saving | — | ~6,100 tokens (~74%) |

    ## Requirements

    Node.js 18+. No dependencies.

    ## File structure expected

    ```
    memory/
      hot/
        work_log_recent.md   <- trimmed automatically
      cold/
        work_log.md          <- archive (created if missing)
    ```

    MIT License.
