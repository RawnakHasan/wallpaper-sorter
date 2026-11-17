use sorter_core::{expand_home, Config};
use sorter_daemon::{describe, serve, Daemon, Notice, Options, Thumbs};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

static STOP: AtomicBool = AtomicBool::new(false);

extern "C" fn on_signal(_sig: libc::c_int) {
    STOP.store(true, Ordering::SeqCst);
}

const HELP: &str = "\
wallpaper-sorter: watches your wallpaper folders and sorts new images into place.

USAGE
    wallpaper-sorter [--config FILE] [--library DIR] [--dry-run | --once] [--verbose]
                     [--port N] [--no-web]

OPTIONS
    --config FILE   settings and tags (default: ~/.config/wallpaper-sorter/config.toml)
    --library DIR   the wallpaper folder (default: `library` in the config file)
    --dry-run       show what would be done to the files waiting now, change nothing, exit
                    (it still creates its own .sorter folder inside the library)
    --once          sort the files waiting now, then exit
    --verbose       also list files that were left in place
    --port N        port of the web page and API on 127.0.0.1 (default: `[server] port` in the config, else 8421)
    --no-web        do not start the web page and API
    --help          this text

With no mode option it keeps running and sorts new images as they arrive (Ctrl-C to stop).
";

struct Args {
    config: Option<PathBuf>,
    library: Option<PathBuf>,
    dry_run: bool,
    once: bool,
    verbose: bool,
    port: Option<u16>,
    no_web: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut a = Args { config: None, library: None, dry_run: false, once: false, verbose: false, port: None, no_web: false };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--config" => a.config = Some(PathBuf::from(it.next().ok_or("--config needs a file")?)),
            "--library" => a.library = Some(expand_home(&it.next().ok_or("--library needs a folder")?)),
            "--dry-run" => a.dry_run = true,
            "--once" => a.once = true,
            "--verbose" => a.verbose = true,
            "--no-web" => a.no_web = true,
            "--port" => a.port = Some(it.next().and_then(|v| v.parse().ok()).ok_or("--port needs a number")?),
            "--help" | "-h" => {
                print!("{HELP}");
                std::process::exit(0);
            }
            other => return Err(format!("unknown option {other} (try --help)")),
        }
    }
    Ok(a)
}

fn default_config_path() -> PathBuf {
    if let Some(x) = std::env::var_os("XDG_CONFIG_HOME") {
        return PathBuf::from(x).join("wallpaper-sorter/config.toml");
    }
    expand_home("~/.config/wallpaper-sorter/config.toml")
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let config_path = args.config.clone().unwrap_or_else(default_config_path);
    let config_path = std::fs::canonicalize(&config_path).unwrap_or(config_path);
    let text = std::fs::read_to_string(&config_path).map_err(|e| {
        format!(
            "cannot read {}: {e}\nCopy spec/tags.starter.toml there and edit it to start.",
            config_path.display()
        )
    })?;
    let cfg = Config::from_toml(&text).map_err(|e| format!("{}: {e}", config_path.display()))?;
    let library = args
        .library
        .clone()
        .or_else(|| cfg.library.as_deref().map(expand_home))
        .ok_or("no library folder: set `library` in the config or pass --library")?;
    if !library.is_dir() {
        return Err(format!("{} is not a folder", library.display()));
    }

    let port = args.port.unwrap_or(cfg.server.port);
    let mut daemon = Daemon::start_with(library.clone(), cfg, Options::default(), Some(config_path.clone())).map_err(|e| e.to_string())?;
    println!("watching {}", library.display());

    if args.dry_run || args.once {
        let files = daemon.take_waiting();
        println!("{} image(s) waiting", files.len());
        if args.dry_run {
            let plan = daemon.pipeline().dry_run(&files).map_err(|e| e.to_string())?;
            for line in plan.describe() {
                println!("{line}");
            }
        } else {
            let outcome = daemon.pipeline().process(&files).map_err(|e| e.to_string())?;
            for line in describe(&outcome, args.verbose) {
                println!("{line}");
            }
        }
        return Ok(());
    }

    if !args.no_web {
        let web = serve(daemon.handle(), port, Thumbs::new(Thumbs::default_dir())).map_err(|e| format!("web server on port {port}: {e}"))?;
        println!("web page and API: http://127.0.0.1:{}/", web.port);
    }

    unsafe {
        let handler: extern "C" fn(libc::c_int) = on_signal;
        libc::signal(libc::SIGINT, handler as libc::sighandler_t);
        libc::signal(libc::SIGTERM, handler as libc::sighandler_t);
    }
    let verbose = args.verbose;
    daemon
        .run(&STOP, &mut |notice| match notice {
            Notice::Processed(outcome) => {
                for line in describe(&outcome, verbose) {
                    println!("{line}");
                }
            }
            Notice::Error(e) => eprintln!("{e}"),
        })
        .map_err(|e| e.to_string())?;
    println!("stopped");
    Ok(())
}

fn main() {
    if let Err(e) = run() {
        eprintln!("wallpaper-sorter: {e}");
        std::process::exit(1);
    }
}
