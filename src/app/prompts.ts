// What the app asks Claude to do on the user's behalf.

/** What "Ask for PR" sends: the app never opens a PR itself, Claude does it with gh. */
export const PR_PROMPT =
  'Open a pull request for this branch with gh: push it first if needed, and write the title and description from the commits. Reply with its URL.'

export const SETUP_PROMPT = (script: string) =>
  `Write the setup script at ${script}. It runs in every new git worktree of this project, ` +
  'from the worktree root, to install what a fresh checkout lacks: dependencies, .env files ' +
  'copied from the main checkout, caches. Replace the stub; keep `#!/usr/bin/env bash` and ' +
  '`set -euo pipefail`. Make it idempotent and non-interactive, use no secrets, exit ' +
  'non-zero on failure. Do not run it.'

/** What the Servers pane's "Ask agent" sends; the format is in servers_start's description. */
export const SERVERS_PROMPT = (file: string) =>
  `Declare this project's dev servers for logit in ${file} (format: see servers_start). ` +
  'Then start them, check they come up, and stop them.'

/** What Settings' "Ask Claude…" sends: Claude asks what scene, then writes it as a file. */
export const NEW_BACKGROUND_PROMPT = (dir: string) =>
  `I want a new chat background for logit. Backgrounds are files in ${dir}: read its ` +
  'README.md (how a scene is written and laid out) and koi.js (an example) first. Then ask ' +
  'me what scene I would like, and write it there as a new .js file. logit shows it as ' +
  'soon as the file exists; I will tell you what to change.'

/** A scene's "Change with Claude…": Claude edits that file, the window follows each save. */
export const EDIT_BACKGROUND_PROMPT = (dir: string, id: string) =>
  `I want to change my logit chat background ${dir}/${id}.js. Read ${dir}/README.md first ` +
  '(how a scene is written and laid out), then ask me what to change. logit redraws it each ' +
  'time the file is saved.'
