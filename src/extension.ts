import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface PathItem extends vscode.QuickPickItem {
  fullPath?: string;
  isDirectory?: boolean;
  isFile?: boolean;
  isGoUp?: boolean;
  isRoot?: boolean;
  isCreate?: boolean;
  isExecute?: boolean;
  isUseCurrent?: boolean;
  isInvalid?: boolean;
}

interface DirEntry { name: string; isDir: boolean; }

interface ParsedValue {
  command: string;
  completedArgs: string[];
  currentToken: string;
  dirPart: string;
  prefix: string;
}

const COMMANDS = ['rm', 'mv', 'cp', 'mkdir'];
const TWO_ARG_COMMANDS = ['cp', 'mv'];

const FILE_ICONS: Record<string, string> = {
  '.ts': 'symbol-method',
  '.tsx': 'symbol-method',
  '.js': 'symbol-method',
  '.jsx': 'symbol-method',
  '.json': 'symbol-object',
  '.md': 'markdown',
  '.css': 'symbol-color',
  '.scss': 'symbol-color',
  '.html': 'symbol-color',
  '.png': 'file-media',
  '.jpg': 'file-media',
  '.svg': 'file-media',
  '.gitignore': 'git',
};

function iconFor(name: string, isDir: boolean): string {
  if (isDir) return '$(file-directory)';
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name).toLowerCase();
  if (FILE_ICONS[base]) return '$(' + FILE_ICONS[base] + ')';
  if (FILE_ICONS[ext]) return '$(' + FILE_ICONS[ext] + ')';
  return '$(file)';
}

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('pathOps.run', async () => {
    const config = vscode.workspace.getConfiguration('pathOps');
    if (config.get<boolean>('revealExplorer', true)) {
      await vscode.commands.executeCommand('workbench.view.explorer');
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const initialDir = workspaceRoot || os.homedir();

    const qp = vscode.window.createQuickPick<PathItem>();
    qp.title = 'Path Ops';
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;
    qp.canSelectMany = false;

    let isUpdating = false;
    let currentAbsDir = initialDir;
    let lastBrowsedDir = initialDir;
    let baseAnchor = initialDir;

    const toSlash = (s: string) => s.replace(/\\/g, '/');
    const withSlash = (t: string) => {
      if (!t) return './';
      return t.endsWith('/') ? t : t + '/';
    };

    const getDisplayPath = (abs: string): string => {
      const n = toSlash(abs);
      if (!workspaceRoot) return n;
      const r = toSlash(workspaceRoot);
      if (n === r) return path.basename(r);
      if (n.startsWith(r + '/')) return n.slice(r.length + 1);
      return n;
    };

    const pathToToken = (abs: string, base: string): string => {
      const n = toSlash(abs);
      const b = toSlash(base);
      if (n === b) return '';
      if (b && n.startsWith(b + '/')) return n.slice(b.length + 1);
      return n;
    };

    const resolveFrom = (base: string, token: string): string => {
      if (!token) return base;
      let p = token;
      if (p.startsWith('~/')) p = path.join(os.homedir(), p.slice(2));
      return path.isAbsolute(p) ? path.resolve(p) : path.resolve(base, p);
    };

    const parseValue = (value: string): ParsedValue => {
      const endsWithSpace = /\s$/.test(value);
      const tokens = value.trim().split(/\s+/).filter(p => p !== '');

      let command = '';
      let completedArgs: string[] = [];
      let currentToken = '';

      if (tokens.length === 0) {
        return { command: '', completedArgs: [], currentToken: '', dirPart: '', prefix: '' };
      }

      if (COMMANDS.includes(tokens[0])) {
        command = tokens[0];
        if (endsWithSpace) {
          completedArgs = tokens.slice(1);
          currentToken = '';
        } else if (tokens.length === 1) {
          currentToken = '';
        } else {
          completedArgs = tokens.slice(1, -1);
          currentToken = tokens[tokens.length - 1];
        }
      } else {
        currentToken = tokens.join(' ');
      }

      let dirPart = '';
      let prefix = '';

      if (currentToken.endsWith('/')) {
        dirPart = currentToken;
        prefix = '';
      } else {
        const idx = currentToken.lastIndexOf('/');
        if (idx >= 0) {
          dirPart = currentToken.substring(0, idx + 1);
          prefix = currentToken.substring(idx + 1);
        } else {
          dirPart = '';
          prefix = currentToken;
        }
      }

      return { command, completedArgs, currentToken, dirPart, prefix };
    };

    const listDir = async (absDir: string): Promise<DirEntry[]> => {
      try {
        const entries = await fs.promises.readdir(absDir, { withFileTypes: true });
        return entries.map(e => ({ name: e.name, isDir: e.isDirectory() }));
      } catch {
        return [];
      }
    };

    const buildValue = (command: string, args: string[], token: string): string => {
      if (!command) return token;
      const parts = [command, ...args];
      if (token) {
        parts.push(token);
        return parts.join(' ');
      }
      return parts.join(' ') + ' ';
    };

    const isTwoArg = (cmd: string) => TWO_ARG_COMMANDS.includes(cmd);
    const requiredArgs = (cmd: string) => isTwoArg(cmd) ? 2 : 1;

    const isComplete = (ctx: ParsedValue): boolean => {
      if (!ctx.command) return false;
      const n = ctx.completedArgs.length + (ctx.currentToken ? 1 : 0);
      return n >= requiredArgs(ctx.command);
    };

    const refresh = async () => {
      const ctx = parseValue(qp.value);

      // 空输入或命令模式：基准跟随最后浏览的目录
      if (!qp.value.trim() || ctx.command) {
        baseAnchor = lastBrowsedDir;
      }

      const absDir = ctx.dirPart
        ? resolveFrom(baseAnchor, ctx.dirPart)
        : baseAnchor;

      currentAbsDir = absDir;

      const dispAnchor = getDisplayPath(baseAnchor);
      const isAtRoot = baseAnchor === initialDir;
      qp.placeholder = (isAtRoot ? '' : '[' + (dispAnchor || baseAnchor) + '] ') + 'type path or cmd';

      if (ctx.dirPart && fs.existsSync(absDir) && fs.statSync(absDir).isDirectory()) {
        lastBrowsedDir = absDir;
      }

      const inDestPhase = isTwoArg(ctx.command) && ctx.completedArgs.length === 1;
      const inSourcePhase = isTwoArg(ctx.command) && ctx.completedArgs.length === 0;
      const isDeletion = ctx.command === 'rm';
      let sourceIsDir = false;
      if (inDestPhase) {
        const sp = resolveFrom(baseAnchor, ctx.completedArgs[0]);
        try {
          sourceIsDir = (await fs.promises.stat(sp)).isDirectory();
        } catch { /* source missing */ }
      }

      const items: PathItem[] = [];

      if (isComplete(ctx)) {
        items.push({
          label: '$(play) ' + qp.value.trim(),
          description: 'execute  (base: ' + (dispAnchor || '.') + ')',
          isExecute: true,
          alwaysShow: true,
        });
      }

      const curToken = pathToToken(currentAbsDir, baseAnchor);
      const curTokenSlash = withSlash(curToken);
      const curTokenLabel = curToken || './';

      if (!fs.existsSync(absDir)) {
        if (inSourcePhase || isDeletion) {
          items.push({
            label: '$(warning) Path not found',
            description: getDisplayPath(absDir),
            isInvalid: true,
            alwaysShow: true,
          });
        } else {
          items.push({
            label: '$(new-folder) Create: ' + getDisplayPath(absDir) + '/',
            isCreate: true,
            fullPath: absDir,
            alwaysShow: true,
          });
        }
        if (ctx.command && !isComplete(ctx) && !ctx.currentToken) {
          const nextArg = isTwoArg(ctx.command) && ctx.completedArgs.length === 1 ? 'target' : 'source';
          items.push({
            label: '$(check) Use this dir as ' + nextArg + ': ' + curTokenLabel,
            isUseCurrent: true,
            alwaysShow: true,
          });
        }
        items.push({ label: '$(arrow-up) ../', isGoUp: true, alwaysShow: true });
        const rootPath = path.parse(absDir).root;
        items.push({ label: '$(root-folder) ' + toSlash(rootPath), isRoot: true, fullPath: rootPath, alwaysShow: true });
        isUpdating = true;
        qp.items = items;
        isUpdating = false;
        return;
      }

      const entries = await listDir(absDir);

      const currentFullPath = ctx.prefix ? path.resolve(absDir, ctx.prefix) : '';
      let currentExists = false;
      if (currentFullPath) {
        try {
          await fs.promises.stat(currentFullPath);
          currentExists = true;
        } catch { /* not exists */ }
      }

      const matched = entries
        .filter(e => e.name.toLowerCase().startsWith(ctx.prefix.toLowerCase()))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      let invalidShown = false;
      for (const e of matched) {
        if (inDestPhase && sourceIsDir && !e.isDir) {
          if (!invalidShown) {
            items.push({
              label: '$(warning) Target must be a folder',
              description: 'source is a directory',
              isInvalid: true,
              alwaysShow: true,
            });
            invalidShown = true;
          }
          continue;
        }
        const childAbs = path.join(absDir, e.name);
        items.push({
          label: iconFor(e.name, e.isDir) + ' ' + e.name + (e.isDir ? '/' : ''),
          description: getDisplayPath(childAbs),
          fullPath: childAbs,
          isDirectory: e.isDir,
          isFile: !e.isDir,
          alwaysShow: true,
        });
      }

      if (!currentExists && ctx.prefix) {
        if (inDestPhase && sourceIsDir) {
          items.push({
            label: '$(new-folder) Create folder: ' + ctx.prefix + '/',
            description: getDisplayPath(currentFullPath),
            isCreate: true,
            fullPath: currentFullPath,
            alwaysShow: true,
          });
        } else if (matched.length === 0) {
          if (inSourcePhase || isDeletion) {
            items.push({
              label: '$(warning) File or folder not found',
              description: ctx.prefix,
              isInvalid: true,
              alwaysShow: true,
            });
          } else {
            items.push({
              label: '$(new-folder) Create: ' + ctx.prefix,
              description: getDisplayPath(currentFullPath),
              isCreate: true,
              fullPath: currentFullPath,
              alwaysShow: true,
            });
          }
        }
      }

      if (ctx.command && !isComplete(ctx) && !ctx.currentToken) {
        const nextArg = isTwoArg(ctx.command) && ctx.completedArgs.length === 1 ? 'target' : 'source';
        items.push({
          label: '$(check) Use this dir as ' + nextArg + ': ' + curTokenLabel,
          description: getDisplayPath(currentAbsDir),
          isUseCurrent: true,
          alwaysShow: true,
        });
      }

      items.push({ label: '$(arrow-up) ../', isGoUp: true, alwaysShow: true });
      const rootPath = path.parse(absDir).root;
      items.push({ label: '$(root-folder) ' + toSlash(rootPath), isRoot: true, fullPath: rootPath, alwaysShow: true });

      isUpdating = true;
      qp.items = items;
      isUpdating = false;
    };

    qp.onDidChangeValue(async () => {
      if (isUpdating) return;
      await refresh();
    });

    qp.onDidAccept(async () => {
      const active = qp.activeItems[0] as PathItem | undefined;
      const ctx = parseValue(qp.value);

      if (active?.isInvalid) return;

      if (active?.isExecute) {
        const value = qp.value;
        qp.hide();
        qp.dispose();
        await execute(value, baseAnchor);
        return;
      }

      if (active?.isUseCurrent) {
        const token = pathToToken(currentAbsDir, baseAnchor);
        const finalToken = token || './';
        const newArgs = [...ctx.completedArgs, finalToken];
        const newValue = buildValue(ctx.command, newArgs, '');
        if (newArgs.length >= requiredArgs(ctx.command)) {
          qp.hide();
          qp.dispose();
          await execute(newValue, baseAnchor);
        } else {
          isUpdating = true;
          qp.value = newValue;
          isUpdating = false;
          await refresh();
        }
        return;
      }

      if (active?.isCreate) {
        const value = qp.value;
        qp.hide();
        qp.dispose();
        await execute(value, baseAnchor);
        return;
      }

      if (active?.isGoUp) {
        const parent = path.dirname(currentAbsDir);
        if (ctx.command) {
          const token = pathToToken(parent, baseAnchor);
          isUpdating = true;
          qp.value = buildValue(ctx.command, ctx.completedArgs, withSlash(token));
          isUpdating = false;
          await refresh();
        } else {
          lastBrowsedDir = parent;
          isUpdating = true;
          qp.value = '';
          isUpdating = false;
          await refresh();
        }
        return;
      }

      if (active?.isRoot) {
        if (ctx.command) {
          isUpdating = true;
          qp.value = buildValue(ctx.command, ctx.completedArgs, withSlash(toSlash(active.fullPath!)));
          isUpdating = false;
          await refresh();
        } else {
          lastBrowsedDir = active.fullPath!;
          isUpdating = true;
          qp.value = '';
          isUpdating = false;
          await refresh();
        }
        return;
      }

      if (active?.isDirectory) {
        if (ctx.command) {
          const token = pathToToken(active.fullPath!, baseAnchor);
          isUpdating = true;
          qp.value = buildValue(ctx.command, ctx.completedArgs, withSlash(token));
          isUpdating = false;
          await refresh();
        } else {
          lastBrowsedDir = active.fullPath!;
          isUpdating = true;
          qp.value = '';
          isUpdating = false;
          await refresh();
        }
        return;
      }

      if (active?.isFile) {
        const token = pathToToken(active.fullPath!, baseAnchor);
        if (!ctx.command) {
          qp.hide();
          qp.dispose();
          await execute(token, baseAnchor);
          return;
        }
        const newArgs = [...ctx.completedArgs, token];
        const newValue = buildValue(ctx.command, newArgs, '');
        if (newArgs.length >= requiredArgs(ctx.command)) {
          qp.hide();
          qp.dispose();
          await execute(newValue, baseAnchor);
        } else {
          isUpdating = true;
          qp.value = newValue;
          isUpdating = false;
          await refresh();
        }
        return;
      }

      const value = qp.value;
      if (!value.trim()) return;
      qp.hide();
      qp.dispose();
      await execute(value, baseAnchor);
    });

    await refresh();
    qp.show();
  });

  context.subscriptions.push(disposable);
}

async function execute(rawValue: string, baseDir: string) {
  const value = rawValue.trim();
  if (!value) return;

  const commands = ['rm', 'mv', 'cp', 'mkdir'];
  const parts = value.split(/\s+/);
  const cmd = commands.includes(parts[0]) ? parts[0] : '';
  const args = cmd ? parts.slice(1) : [value];

  const resolve = (p: string): string => {
    if (p.startsWith('~/')) p = path.join(os.homedir(), p.slice(2));
    return path.isAbsolute(p) ? path.resolve(p) : path.resolve(baseDir, p);
  };

  const dirLabel = (absDir: string): string => {
    const norm = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
    const d = norm(path.resolve(absDir));
    const b = norm(path.resolve(baseDir));
    if (d === b) return '.';
    if (d.startsWith(b + path.sep)) {
      return path.relative(path.resolve(baseDir), path.resolve(absDir)).replace(/\\/g, '/');
    }
    return path.resolve(absDir).replace(/\\/g, '/');
  };

  const createdMsg = (kind: 'folder' | 'file', abs: string): string =>
    'Created ' + kind + ' "' + path.basename(abs) + '" in ' + dirLabel(path.dirname(abs));

  try {
    if (cmd === 'mkdir') {
      if (!args[0]) throw new Error('Missing path');
      const p = resolve(args[0]);
      if (fs.existsSync(p)) throw new Error('Already exists: ' + args[0]);
      await fs.promises.mkdir(p, { recursive: true });
      vscode.window.showInformationMessage(createdMsg('folder', p));
    } else if (cmd === 'rm') {
      if (!args[0]) throw new Error('Missing path');
      const p = resolve(args[0]);
      const stat = await fs.promises.lstat(p);
      if (stat.isDirectory()) {
        await fs.promises.rm(p, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(p);
      }
      vscode.window.showInformationMessage('Deleted: ' + args[0]);
    } else if (cmd === 'mv' || cmd === 'cp') {
      if (!args[0] || !args[1]) throw new Error('Missing source or target');
      const src = resolve(args[0]);
      let dst = resolve(args[1]);

      const srcStat = await fs.promises.lstat(src);

      let dstStat: fs.Stats | null = null;
      try { dstStat = await fs.promises.lstat(dst); } catch { /* not exists */ }

      if (dstStat && dstStat.isDirectory()) {
        dst = path.join(dst, path.basename(src));
        try { dstStat = await fs.promises.lstat(dst); } catch { dstStat = null; }
      }

      const norm = (p: string) => {
        const abs = path.resolve(p);
        return process.platform === 'win32' ? abs.toLowerCase() : abs;
      };
      const srcAbs = norm(src);
      const dstAbs = norm(dst);

      if (srcAbs === dstAbs) {
        throw new Error('Source and target are the same');
      }

      if (srcStat.isDirectory()) {
        const rel = path.relative(srcAbs, dstAbs);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
          throw new Error('Target is inside source (would recurse infinitely)');
        }
      }

      if (srcStat.isDirectory() && dstStat && !dstStat.isDirectory()) {
        throw new Error('Cannot copy/move directory onto existing file');
      }

      if (cmd === 'mv' && dstStat) {
        throw new Error('Target already exists: ' + path.basename(dst));
      }

      await fs.promises.mkdir(path.dirname(dst), { recursive: true });

      if (cmd === 'mv') {
        await fs.promises.rename(src, dst);
      } else {
        await copyRecursive(src, dst);
      }
      vscode.window.showInformationMessage((cmd === 'mv' ? 'Moved' : 'Copied') + ': ' + args[0] + ' -> ' + args[1]);
    } else {
      const p = resolve(args[0]);
      if (fs.existsSync(p)) {
        const stat = await fs.promises.stat(p);
        if (stat.isDirectory()) {
          vscode.window.showInformationMessage('Directory exists: ' + args[0]);
        } else {
          const doc = await vscode.workspace.openTextDocument(p);
          await vscode.window.showTextDocument(doc);
        }
      } else {
        const hasExt = path.extname(p) !== '';
        if (hasExt) {
          await fs.promises.mkdir(path.dirname(p), { recursive: true });
          await fs.promises.writeFile(p, '');
          vscode.window.showInformationMessage(createdMsg('file', p));
          const doc = await vscode.workspace.openTextDocument(p);
          await vscode.window.showTextDocument(doc);
        } else {
          await fs.promises.mkdir(p, { recursive: true });
          vscode.window.showInformationMessage(createdMsg('folder', p));
        }
      }
    }
  } catch (e: any) {
    vscode.window.showErrorMessage('Failed: ' + e.message);
  }
}

async function copyRecursive(src: string, dst: string, depth = 0): Promise<void> {
  if (depth > 50) {
    throw new Error('Copy depth exceeded 50 levels - aborted to prevent infinite recursion');
  }
  const srcLower = path.resolve(src).toLowerCase();
  const dstLower = path.resolve(dst).toLowerCase();
  if (dstLower === srcLower || dstLower.startsWith(srcLower + path.sep)) {
    throw new Error('Target is inside source - aborted to prevent infinite recursion');
  }
  const stat = await fs.promises.lstat(src);
  if (stat.isSymbolicLink()) {
    return;
  }
  if (stat.isDirectory()) {
    await fs.promises.mkdir(dst, { recursive: true });
    for (const entry of await fs.promises.readdir(src)) {
      await copyRecursive(path.join(src, entry), path.join(dst, entry), depth + 1);
    }
  } else {
    await fs.promises.copyFile(src, dst);
  }
}

export function deactivate() {}
