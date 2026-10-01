// Learn as a desktop app (macOS, Windows, Linux): a window onto the Learn server, which runs under the bundled Bun.
// It reuses a server that's already up on the port (e.g. one `learn` started); otherwise it starts
// one and stops it on quit. The vault is picked on first launch and changed from the app menu.
// `npm run app` packages this with the server, UI and dependencies (electron/pack.mjs).
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Packaged, the app folder is a copy of the project; `npm run app:dev` runs from the checkout.
const DIR = app.isPackaged ? app.getAppPath() : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.LEARN_PORT || "4747";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.homedir(), ".pi", "agent", "learn.log");
const CONFIG = path.join(app.getPath("userData"), "config.json");
const MAC = process.platform === "darwin";
// Where "Change Vault Folder…" lives: the app menu on a Mac, File elsewhere.
const VAULT_MENU = `${MAC ? "Learn" : "File"} → Change Vault Folder…`;

let server = null;
let win = null;

const readConfig = () => (existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {});

function saveVault(vault) {
	mkdirSync(path.dirname(CONFIG), { recursive: true });
	writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), vault }, null, "\t"));
	return vault;
}

/** Asks for the folder the tutor works in and remembers it. Undefined if cancelled. */
async function chooseVault() {
	const { canceled, filePaths } = await dialog.showOpenDialog({
		title: "Choose your vault",
		message: "Pick the folder Learn keeps your notes in. The tutor reads and writes files there.",
		buttonLabel: "Use Folder",
		properties: ["openDirectory", "createDirectory"],
		defaultPath: readConfig().vault || app.getPath("documents"),
	});
	return canceled || !filePaths[0] ? undefined : saveVault(filePaths[0]);
}

/** First launch: a fresh Learn folder in Documents, or an existing notes folder. Undefined if cancelled. */
async function firstVault() {
	const fresh = path.join(app.getPath("documents"), "Learn");
	const { response } = await dialog.showMessageBox({
		message: "Where should Learn keep your notes?",
		detail: `The tutor reads and writes files there and saves lessons into it. Start with a new folder (${fresh}), or use a folder of notes you already have, like an Obsidian vault. You can change it later from ${VAULT_MENU}`,
		buttons: ["Use a New Learn Folder", "Choose a Notes Folder…", "Quit"],
		defaultId: 0,
		cancelId: 2,
	});
	if (response === 1) return chooseVault();
	if (response !== 0) return undefined;
	mkdirSync(fresh, { recursive: true });
	return saveVault(fresh);
}

// Apps opened from Finder or a Linux launcher get a bare PATH and none of the shell's variables
// (API keys, Homebrew). The tutor runs shell commands, so take the environment a login shell would
// have. Windows apps already get the user's environment.
function loginEnv() {
	if (!app.isPackaged || process.platform === "win32") return Promise.resolve(process.env);
	return new Promise((resolve) => {
		const child = execFile(process.env.SHELL || (MAC ? "/bin/zsh" : "/bin/sh"), ["-ilc", "printf __LEARN_ENV__; /usr/bin/env -0"], { encoding: "utf8", timeout: 5000 }, (error, out) => {
			if (error) return resolve(process.env);
			const pairs = out.slice(out.lastIndexOf("__LEARN_ENV__") + 13).split("\0").filter(Boolean).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]);
			resolve({ ...process.env, ...Object.fromEntries(pairs) });
		});
		child.stdin.end();
	});
}

const up = () => fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);

/** False if the user cancelled picking a vault. */
async function startServer() {
	if (await up()) return true;
	// The login shell takes a moment; let it run while the vault is picked.
	const env = loginEnv();
	const vault = process.env.LEARN_VAULT || readConfig().vault || (await firstVault());
	if (!vault) return false;
	if (!existsSync(path.join(DIR, "dist", "index.html"))) throw new Error(`The UI isn't built. Run \`npm run build\` in ${DIR}.`);
	mkdirSync(path.dirname(LOG), { recursive: true });
	const log = openSync(LOG, "w");
	server = spawn(createRequire(import.meta.url).resolve("bun/bin/bun.exe"), [path.join(DIR, "server", "server.mjs")], {
		cwd: DIR,
		env: { ...(await env), LEARN_PORT: PORT, LEARN_VAULT: vault },
		stdio: ["ignore", log, log],
	});
	for (let i = 0; i < 40 && server.exitCode === null; i++) {
		if (await up()) return true;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Learn's server didn't start. See ${LOG}.`);
}

async function changeVault() {
	if (!server) {
		dialog.showMessageBox({ message: "Learn is running from a terminal", detail: "Stop that server and reopen Learn to change the vault from the app." });
		return;
	}
	if (!(await chooseVault())) return;
	// A server that already died won't send another exit.
	if (server.exitCode === null && server.signalCode === null) {
		const exited = new Promise((resolve) => server.once("exit", resolve));
		server.kill();
		await exited;
	}
	server = null;
	try {
		await startServer();
		win?.reload();
	} catch (error) {
		dialog.showErrorBox("Learn couldn't restart", error.message);
	}
}

function openWindow() {
	win = new BrowserWindow({ width: 1320, height: 880, minWidth: 720, minHeight: 480, title: "Learn", show: false, icon: path.join(DIR, "electron", "icon.png") });
	win.once("ready-to-show", () => win.show());
	win.on("closed", () => (win = null));
	// Links out of Learn open in the browser, not in this window.
	win.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event, url) => {
		if (new URL(url).origin === ORIGIN) return;
		event.preventDefault();
		shell.openExternal(url);
	});
	win.loadURL(ORIGIN);
}

const vaultItem = { label: "Change Vault Folder…", click: changeVault };
Menu.setApplicationMenu(
	Menu.buildFromTemplate([
		MAC
			? {
					role: "appMenu",
					submenu: [
						{ role: "about" },
						{ type: "separator" },
						vaultItem,
						{ type: "separator" },
						{ role: "hide" },
						{ role: "hideOthers" },
						{ role: "unhide" },
						{ type: "separator" },
						{ role: "quit" },
					],
				}
			: { label: "File", submenu: [vaultItem, { type: "separator" }, { role: "quit" }] },
		{ role: "editMenu" },
		{ role: "viewMenu" },
		{ role: "windowMenu" },
	]),
);

if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", () => {
		if (!win) return openWindow();
		if (win.isMinimized()) win.restore();
		win.focus();
	});
	// On a Mac, closing the window keeps the app (and its server) until Quit; elsewhere it quits.
	app.on("window-all-closed", () => MAC || app.quit());
	app.on("activate", () => win || openWindow());
	app.on("will-quit", () => server?.kill());
	app.whenReady().then(async () => {
		try {
			if (await startServer()) openWindow();
			else app.quit();
		} catch (error) {
			dialog.showErrorBox("Learn couldn't start", error.message);
			app.quit();
		}
	});
}
