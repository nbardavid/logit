# Workspaces on Boat

## Intent

Run a workspace's Claude on a Boat VM (boat.dev) instead of the Mac, so many agents can work at
once without loading the Mac, while the workspace behaves exactly like a local one: a sidebar
row (sub-workspaces nested under their parent), a chat the user talks to, a report the agent
fills, logit's MCP tools working. The Mac stays on with logit running: no detached mode.

## Goals

- Boat is turned on per project (with the wallet that pays), beside its Claude accounts.
- "On Boat" in the ⌘N composer, shown only for a project with Boat on, and `machine: "boat"` on the MCP's `workspace_create`.
- The chat is the real `claude` over stream-json, run in the VM through `boat ssh`.
- logit's MCP (report, show, workspace_create, chat_read…) works from the VM, answered by the
  local host: the report fills like any other.
- A **Boat** tab in the bottom panel (beside Setup and Servers) for a Boat workspace: sandbox id,
  state, size, region, uptime, cost so far; Stop / Resume; copy the ssh command.
- Removing the workspace deletes its VM.

## Non-goals (v1)

- Working with the Mac closed or asleep (detached claude, catch-up from a log in the VM).
- Reaching the VM's dev servers from the Mac (no tunnel). Its servers run in the VM.
- Terminal tabs inside the VM (a terminal tab stays local; "copy ssh" covers it).
- Showing the VM's uncommitted changes in the git panel.

## Anti-goals

- Any TCP listener on the Mac (hard rule): no `boat forward --reverse`.
- A Boat workspace that feels second-class: same row, same states, same unread, same ⌘0.

## Constraints found

- Boat CLI 1.0.107 at `~/.ascii/bin/boat`, signed in. `boat ssh <id> -- <cmd>` passes stdio;
  it has no `-R`. `boat new --json` creates; `boat info/stop/resume/delete --json`.
- exec/ssh do not extend Boat's auto-stop: logit sets it to 6 h at creation, at each chat start and after each finished turn (`boat extend --hours 6`). The sandbox is named after the workspace (a slug of its name), renamed when Claude or the user names it.
- The Boat AI profile already holds the user's Claude subscription: `claude` in the VM is signed
  in, and uses the same quotas.
- The personal account has no plan (402 billing_required); only the RainPath org does.
  Which wallet pays is set **per project**, like its Claude accounts: `Project.boat:
  Option<BoatTarget { org: Option<String> }>`, none = Boat off for that project. The project's
  settings list the wallets `boat org list` gives (personal included).
- Not verified yet (no sandbox could be created): stream-json over `boat ssh`, the MCP bridge.

## Approaches

1. **ssh stdio for everything (chosen).** The host spawns `boat ssh <id> -- claude …` in place
   of `claude`; stdio is the same stream-json. MCP: the VM's claude gets an MCP server that is
   a tiny Python bridge to a Unix socket in the VM; the host opens a second
   `boat ssh <id> -- python3 bridge --serve` whose stdio it pipes into a local
   `logit --mcp <chat>` run in the local worktree. No port anywhere.
2. Boat's integrated agent (`boat prompt`, `boat events`): not raw stream-json, so our chat UI,
   permissions and models would not work. Dropped.
3. Detached claude in the VM with a log the host follows: survives the Mac closing, which the
   owner does not need now. Kept for later.

## Design

- **Catalog**: `Workspace.boat: Option<BoatMachine { id, org }>` (serde default, old catalogs
  load). `boat.rs` wraps the CLI (`new`, `info`, `stop`, `resume`, `delete`, `push`, `ssh`).
- **Create**: the local worktree and branch are made as today; then `boat new
  --name <workspace> [--org]`, `boat push <id> <worktree> --to /home/user/<folder>` (tracked
  files), and in the VM `git checkout -B <branch>` with origin set. The row shows the setup
  progress in the Setup tab as today.
- **Chat**: `spawn_claude` takes the workspace's machine; for Boat it runs
  `boat ssh <id> -- cd <dir> && env CLAUDE_CODE_ENTRYPOINT=logit … claude <args> --mcp-config …`.
  `--resume` works since transcripts live in the VM; the transcript reload for history reads
  them through `boat ssh … cat`.
- **Work back**: the agent pushes its branch and opens its PR with gh, as today; after each
  finished turn the host fetches the branch into the local worktree (fast-forward only), so
  the git panel and PR status work.
- **Boat tab**: `boat info --json` and `boat usage --json`, polled while the tab is open.
- **Lifecycle**: Stop / Resume from the tab; sending a message to a stopped VM resumes it first;
  workspace remove → `boat delete --yes`.
- **Errors**: Boat CLI missing or signed out → the "On Boat" option says so with the fix;
  create failure → the workspace stays local-less with the error in Setup, retry from there;
  ssh drop → the chat shows it stopped and resumes on the next message.

## Left to the builder

The exact Python bridge, polling intervals, how the composer toggle looks (DESIGN.md), fixture
data for the web mock.
