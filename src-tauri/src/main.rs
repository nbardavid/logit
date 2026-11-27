#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The background host: same binary, no Tauri, no window, no Dock icon.
    if std::env::args().any(|a| a == "--host") {
        logit_lib::host::run();
        return;
    }
    // The MCP server a chat's Claude talks to, over stdio.
    let args: Vec<String> = std::env::args().collect();
    if let Some(at) = args.iter().position(|a| a == "--mcp") {
        logit_lib::mcp::run(args.get(at + 1).cloned().unwrap_or_default());
        return;
    }
    // A workspace on Boat: its sandbox made (the Setup terminal), its Claude run over ssh.
    if let Some(at) = args.iter().position(|a| a == "--boat-setup") {
        let workspace = args.get(at + 1).cloned().unwrap_or_default();
        std::process::exit(logit_lib::boat::setup(&workspace));
    }
    if let Some(at) = args.iter().position(|a| a == "--boat-chat") {
        let workspace = args.get(at + 1).cloned().unwrap_or_default();
        let chat = args.get(at + 2).cloned().unwrap_or_default();
        let rest = args
            .iter()
            .skip_while(|a| *a != "--")
            .skip(1)
            .cloned()
            .collect();
        std::process::exit(logit_lib::boat::chat(&workspace, &chat, rest));
    }
    logit_lib::run()
}
