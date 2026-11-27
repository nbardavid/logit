# Workspaces on Boat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workspace whose Claude runs on a Boat VM over `boat ssh`, behaving like a local one (row, chat, report, MCP), with a Boat tab in the dock.

**Architecture:** All Boat logic lives in `src-tauri/src/boat.rs` and two subcommands of the app binary: `logit --boat-setup <workspace>` (provisions the VM, run as the workspace's Setup terminal so its progress shows there) and `logit --boat-chat <workspace> -- <claude args>` (what the host spawns instead of `claude` for a Boat workspace: waits for the VM, relays logit's MCP, pipes stream-json through `boat ssh`). The sandbox id lives in a sidecar `<data>/boat/<workspace>.json`, never written to the catalog by those subprocesses.

**Tech Stack:** Rust (Tauri 2, std::process), React/TS (bun), the `boat` CLI 1.0.107, Python 3 in the VM for the socket bridge.

**Spec:** `docs/superpowers/specs/2026-11-27-boat-workspaces-design.md`

## Global Constraints

- No TCP listener on the Mac; the MCP bridge is Unix sockets in the VM plus ssh stdio.
- The `boat` binary: `$BOAT_BIN`, else `~/.ascii/bin/boat`, else `boat` on `tool_path()`.
- Every VM is created with `--no-auto-stop`; logit stops it (exec/ssh do not extend Boat's timer).
- Remote checkout dir: `/home/user/repo`. Bridge: `/home/user/.logit/bridge.py`. Socket: `/tmp/logit-mcp-<chat>.sock`.
- Claude in the VM runs with `CLAUDE_CODE_ENTRYPOINT=logit`, `CLAUDE_CODE_ARTIFACT=1`, `CLAUDE_CODE_ARTIFACT_AUTO_OPEN=0`.
- English in UI and code; bun only; no commits without the owner's approval (commit steps are skipped).
- Checks: `bun run lint && bun run format && bun test && (cd src-tauri && cargo test)`.

## Review Focus

- Boat CLI missing or signed out: the project setting and the composer say so, nothing is created.
- VM creation fails (402 billing, no machine): Setup shows Boat's message, exit code ≠ 0, the chat says the VM is not ready instead of hanging forever.
- Chat opened while the VM is stopped: `--boat-chat` resumes it first.
- ssh drops mid-turn: the chat ends like a crashed local claude; reopening resumes with `--resume`.
- Removing a Boat workspace whose VM is already gone: removal still succeeds.

---

### Task 1: `boat.rs` — CLI wrapper and sidecar

**Files:** Create `src-tauri/src/boat.rs`; modify `src-tauri/src/lib.rs` (mod).

**Interfaces — Produces:**

- `pub fn bin() -> PathBuf`
- `pub struct Machine { pub id: String, pub ready: bool, pub error: Option<String> }` (serde camelCase), `pub fn load(workspace: &str) -> Option<Machine>`, `pub fn save(workspace: &str, m: &Machine) -> Result<(), String>`, `pub fn forget(workspace: &str)`
- `pub fn boat(args: &[&str], org: Option<&str>) -> Result<serde_json::Value, String>` — runs with `--json --no-update` (+ `--org`), parses stdout; non-zero exit → `Err` with Boat's `error` field or stderr.
- `pub fn sandbox_id(created: &Value) -> Option<String>` — the first string value starting `bx_` at `id`, `sandbox.id`, or `sandboxes[0].id`.
- `pub fn sh_quote(s: &str) -> String`
- `pub const BRIDGE: &str` — the Python bridge (client: connect to `argv[2]` retrying 60 s, relay stdio both ways; `serve`: unlink, listen on `argv[2]`, accept connections one after another, relay each to stdio).

- [ ] Tests: `sandbox_id_reads_the_shapes_boat_prints` (three shapes → `bx_ab12`, none → None); `sidecar_round_trips` (under a temp `LOGIT_DATA_DIR`-style dir via `store::data_dir()`); `sh_quote_survives_quotes` (`it's` → `'it'\''s'`).
- [ ] Implement; `cargo test boat` passes.

### Task 2: Catalog — Boat per project and per workspace

**Files:** `src-tauri/src/store.rs`, `src-tauri/src/lib.rs`, `src/model/catalog.ts`.

**Interfaces — Produces:**

- `pub struct BoatTarget { pub org: Option<String> }` (serde camelCase, Clone, PartialEq).
- `Project.boat: Option<BoatTarget>` and `Workspace.boat: Option<BoatTarget>`, both `#[serde(default, skip_serializing_if = "Option::is_none")]`.
- `#[tauri::command] project_set_boat(id: String, boat: Option<BoatTarget>) -> Result<Project, String>`
- `#[tauri::command(async)] boat_orgs() -> Result<Vec<BoatOrg>, String>` with `BoatOrg { id: Option<String>, name: String }`: personal first (`id: None`), then `boat org list --json`; Err "Boat CLI not found" / Boat's error when signed out.
- `workspace_create(..., boat: Option<bool>)`: `Some(true)` copies the project's `boat` onto the workspace; Err "Boat is off for this project" when the project has none.
- TS: `Project.boat?: { org?: string | null }`, `Workspace.boat?: { org?: string | null }`.

- [ ] Tests: `old_catalogs_load_without_boat`; `workspace_create_on_boat_needs_the_project_on` (store test helper as existing tests do).
- [ ] Implement; register commands in `lib.rs`; `cargo test` passes.

### Task 3: `logit --boat-setup <workspace>`

**Files:** `src-tauri/src/boat.rs`, `src-tauri/src/main.rs` (dispatch beside `--mcp`), `src/app/use-setup-run.ts`.

**Interfaces — Consumes:** Task 1, Task 2. **Produces:** `pub fn setup(workspace: &str) -> i32` (exit code).

Steps the subcommand prints, one line each (`boat: …`), in order: create (`boat new --no-auto-stop --name <workspace name> --file /home/user/.logit/bridge.py=<tmp file holding BRIDGE> [--org]`), save sidecar `{id, ready:false}`, clone (`boat ssh <id> -- git clone <origin url> /home/user/repo && cd /home/user/repo && git checkout -B <branch> <base>`; origin url from `git remote get-url origin` in the local worktree), project setup (`boat ssh <id> -- bash -s` with the project's `setup.sh` on stdin, cwd `/home/user/repo`, only if it exists), then `ready:true`. Any failure: prints Boat's message, saves `error`, returns 1. A sidecar already `ready` returns 0 at once (re-run safe).

- [ ] Test: `setup_steps_for_a_workspace` — a pure `fn setup_plan(w: &Workspace, origin: &str) -> Vec<Vec<String>>` giving the argument lists above; assert the clone line holds `git checkout -B logit/amber origin/main`.
- [ ] `runSetup`: for `w.boat`, command is `'<exe>' --boat-setup <w.id>` (exe from a new `#[tauri::command] app_exe() -> String`), title `Setup`.
- [ ] `cargo test` and `bun test` pass.

### Task 4: `logit --boat-chat <workspace> -- <args>` and the host switch

**Files:** `src-tauri/src/boat.rs`, `src-tauri/src/main.rs`, `src-tauri/src/chat.rs`.

**Interfaces — Consumes:** Tasks 1–3. **Produces:** `pub fn chat(workspace: &str, chat: &str, args: Vec<String>) -> i32`; `spawn_claude` gains `boat: Option<&str>` (the workspace id): Some → spawns `<exe> --boat-chat <workspace> <chat> -- <claude args>` with the same piped stdio, no `logit_mcp` (the VM gets its own config), no account.

`chat`: waits up to 10 min for the sidecar to be `ready` (an `error` ends it at once: one `{"type":"logit_stderr"}`-free stderr line `boat: <error>` and exit 1); resumes the VM when `boat info` says it is not running; spawns the MCP relay — `boat ssh <id> -- python3 /home/user/.logit/bridge.py serve /tmp/logit-mcp-<chat>.sock` piped both ways into a local `<exe> --mcp <chat>` whose cwd is the local worktree; then runs `boat ssh <id> -- cd /home/user/repo && env CLAUDE_CODE_ENTRYPOINT=logit CLAUDE_CODE_ARTIFACT=1 CLAUDE_CODE_ARTIFACT_AUTO_OPEN=0 claude <args> --mcp-config '<json: logit → python3 bridge.py /tmp/logit-mcp-<chat>.sock>' --allowedTools mcp__logit`, its stdin/stdout/stderr inherited. When a stdout line is a `"type":"result"`, it fetches the workspace branch into the local worktree (`git fetch origin <branch>` then `git merge --ff-only FETCH_HEAD`, errors ignored). Kills the relay on exit.

In `host.rs::chat_open`, the workspace is found from `start.cwd` (same rule as `mcp::workspace_of`, moved to `store` as `pub fn workspace_at`), and its `boat` decides the spawn.

- [ ] Test: `remote_claude_line_quotes_every_argument` — `fn remote_claude(chat: &str, args: &[String]) -> String` contains `'--mcp-config'` JSON quoted once and `CLAUDE_CODE_ENTRYPOINT=logit`.
- [ ] `cargo test` passes.

### Task 5: History and removal

**Files:** `src-tauri/src/chat.rs`, `src-tauri/src/store.rs`, callers of `chat_history` in `src/`.

- `chat_history(session_id, workspace_id: Option<String>)`: when the local file is missing and that workspace is on Boat, reads `boat ssh <id> -- sh -c 'cat ~/.claude/projects/*/<sid>.jsonl'` (sid validated as today).
- `workspace_remove`: a Boat workspace runs `boat delete <id> --yes` (errors other than "not found" are returned) then `boat::forget`.

- [ ] Test: `remove_forgets_the_sidecar` with a missing VM tolerated through an injectable runner (`fn delete_with(run: impl Fn(&[&str]) -> Result<Value,String>, id)`).
- [ ] `cargo test`, `bun test` pass.

### Task 6: The Boat tab, the project switch, the composer

**Files:** `src/app/workspace-dock.tsx`, new `src/app/boat-pane.tsx`, `src/app/new-workspace.tsx`, the project settings view (where `ProjectAccounts` from `accounts-pane.tsx` renders), `src/app/use-catalog.ts`, `src/dev/mock-ipc.ts`, `src-tauri/src/boat.rs` + `lib.rs`.

- Commands: `boat_info(workspace_id) -> Value` (`boat info` + `boat usage` merged: id, state, type, vcpu, memoryGB, region, startedAt, cost), `boat_stop(workspace_id)`, `boat_resume(workspace_id)`.
- Dock: a `Boat` tab after Servers, only for `w.boat`, dot `done` while running. Pane: one line per fact as in the spec sketch; Stop/Resume button; "Copy ssh command" (`boat ssh <id>`); polls `boat_info` every 15 s while shown; errors shown inline.
- Project settings: "Run on Boat" switch + wallet select from `boat_orgs`; a CLI error shows as a quiet line with the fix (`boat login`).
- Composer: "On Boat" toggle beside the model, only when the project has Boat; passes `boat: true`. MCP `workspace_create` takes `machine: "boat"` the same way (mcp.rs schema + call).
- Fixtures: one Boat workspace (running) and the orgs list in `mock-ipc.ts`.

- [ ] `bun run web:dev`, check the tab, the switch and the toggle with chrome-devtools; screenshot each.
- [ ] Full checks pass.
