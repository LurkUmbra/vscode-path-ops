# Path Ops

A VS Code extension that handles **path browsing, file opening, file & folder creation, and `rm` / `mv` / `cp` / `mkdir`** — all from a single input box with live path suggestions.

## Features

- **Unified Command Palette**: Browse paths, create files/folders, and execute file operations in one place.
- **Live Path Suggestions**: As you type, matching files and folders are displayed instantly.
- **Command Mode**: Type `rm`, `mv`, `cp`, or `mkdir` followed by paths to manipulate files.
- **Smart Context**: Remembers your last browsed directory as the working base.
- **Safety Guards**: Blocks infinite recursion (e.g., `cp src src`), ambiguous file/folder overwrites, and non-existent sources.
- **Quick Access**: Bound to `Ctrl+N` (`Cmd+N` on macOS) by default.

## Usage

Press `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS) and run **`Path Ops: Run file operation`**, or simply press `Ctrl+N`.

### Path Mode (no command)

- **Browse**: Use `↑/↓` to navigate. `Enter` enters a folder or opens a file.
- **Create**: Type a name that does not exist. Pressing `Enter` on the `Create` item creates a folder (no extension) or a file (with extension).
- **Jump**: Type absolute paths (e.g., `D:/`) or `~/` to escape the workspace.

### Command Mode

Type a command followed by paths:

- `mkdir <path>` — Create a directory (recursively).
- `rm <path>` — Delete a file or directory.
- `cp <src> <dst>` — Copy a file or directory (recursively).
- `mv <src> <dst>` — Move or rename a file or directory.

**Tip:** When entering the target path for `cp` or `mv`, choose `Use this dir as target` to select the currently browsed folder without typing.

## Extension Settings

This extension contributes the following settings:

- `pathOps.revealExplorer` (default: `true`) — Automatically reveal and focus the File Explorer sidebar when Path Ops is opened.

## Known Limitations

1. **Tab / Shift+Tab cannot switch items.** VS Code's QuickPick fixes `Tab` to "accept current item"; use `↑/↓` to navigate.
2. **Character-level path highlighting is not possible.** `QuickPickItem` does not support substring highlights.
3. **User-installed icon themes cannot be used.** Only built-in codicons are available in QuickPick.

## Development

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

To package:

```bash
npx vsce package
```

## Release Notes

### 0.0.1

- Initial release.
- Added path browsing, file/folder creation, and `rm`, `mv`, `cp`, `mkdir` commands.
- Implemented recursion guards and directory traversal safety.
- Added `Ctrl+N` keybinding and Explorer auto-reveal setting.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
