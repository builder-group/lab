#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--mcp") {
        if let Err(error) = yadori_lib::run_mcp(&args) {
            eprintln!("Yadori MCP: {error}");
            std::process::exit(1);
        }
    } else {
        yadori_lib::run();
    }
}
