// `npm run app`: builds the UI and packages Learn for the system it runs on (macOS, Windows or
// Linux) with the server, UI and only the packages the server runs (Bun included), so it runs
// without this checkout. Writes release/Learn-<os>-<arch>.zip (.tar.gz on Linux) to share; on a
// Mac it also installs Learn.app in ~/Applications.
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RELEASE = path.join(ROOT, "release");
const STAGE = path.join(RELEASE, "stage");
const MODULES = path.join(STAGE, "node_modules");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
// npm is a .cmd script on Windows, which only runs through a shell.
const npm = (args, cwd) => execFileSync("npm", args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
const OS = { darwin: "mac", win32: "win", linux: "linux" }[process.platform];
if (!OS) throw new Error(`Learn can't be packaged on ${process.platform}.`);
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

npm(["run", "build"], ROOT);

// What the server reads at runtime, minus tests.
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const entry of ["package-lock.json", "dist", "server", "extensions", "skills", "agents", "electron/main.mjs", "electron/icon.png"]) {
	cpSync(path.join(ROOT, entry), path.join(STAGE, entry), { recursive: true, filter: (src) => !src.endsWith(".test.mjs") });
}

// Only what the server and extensions import. The UI's libraries are already in dist/; pi is
// copied below as its compiled dist (its bundle runs without pi's dependencies); Mermaid
// rendering (which also needs Node and Chrome) is left out, and its tool says so.
const RUNTIME = ["@earendil-works/pi-ai", "@oh-my-pi/pi-ai", "@oh-my-pi/pi-catalog", "bun"];
const { name, productName, version, type, main, allowScripts } = pkg;
const dependencies = Object.fromEntries(RUNTIME.map((dep) => [dep, pkg.dependencies[dep]]));
writeFileSync(path.join(STAGE, "package.json"), JSON.stringify({ name, productName, version, type, main, dependencies, allowScripts }, null, "\t"));
npm(["install", "--omit=dev", "--no-audit", "--no-fund"], STAGE);

const PI = path.join("@earendil-works", "pi-coding-agent");
for (const entry of ["package.json", "README.md", "docs", "dist"]) {
	cpSync(path.join(ROOT, "node_modules", PI, entry), path.join(MODULES, PI, entry), { recursive: true });
}
// The packages pi's bundle loads itself (the rest are bundled in or optional): chord/context and
// jiti, its extension loader. Neither has dependencies (chord's esbuild is only for its builder).
for (const dep of [path.join("@earendil-works", "chord"), "jiti"]) {
	cpSync(path.join(ROOT, "node_modules", PI, "node_modules", dep), path.join(MODULES, dep), { recursive: true });
}

// omp's native addon (~170 MB) backs features Learn doesn't use (PTY, audio, desktop, Apple
// models), but its loader runs on import. Drop it and let the loader fall back to stand-ins
// that throw if anything ever calls them.
rmSync(path.join(MODULES, "@oh-my-pi", `pi-natives-${process.platform}-${process.arch}`), { recursive: true, force: true });
const natives = path.join(MODULES, "@oh-my-pi", "pi-natives", "native", "index.js");
const load = "const nativeBindings = loadNative();";
const source = readFileSync(natives, "utf8");
if (!source.includes(load)) throw new Error(`${natives} changed; update the native loader patch in electron/pack.mjs.`);
writeFileSync(
	natives,
	source.replace(load, 'let nativeBindings;\ntry { nativeBindings = loadNative(); } catch { const unavailable = function () { throw new Error("omp native module not bundled"); }; nativeBindings = new Proxy({}, { get: () => unavailable }); }'),
);
rmSync(path.join(MODULES, "bun", "bin", "bunx.exe"), { force: true }); // a second copy of Bun; Learn never runs bunx

const [built] = await packager({
	dir: STAGE,
	out: RELEASE,
	name: "Learn",
	appBundleId: "local.learn",
	appVersion: version,
	win32metadata: { CompanyName: "Learn" }, // the .exe's publisher field; otherwise it's read from package.json's author
	icon: path.join(HERE, "icon"), // icon.icns or icon.ico; Linux takes the window's icon.png
	electronVersion: JSON.parse(readFileSync(path.join(ROOT, "node_modules", "electron", "package.json"), "utf8")).version,
	platform: process.platform,
	arch: process.arch,
	asar: false, // Bun runs the server and pi from these files; it can't read inside an asar.
	prune: false,
	overwrite: true,
});
rmSync(STAGE, { recursive: true });

const archive = path.join(RELEASE, `Learn-${OS}-${process.arch}.${OS === "linux" ? "tar.gz" : "zip"}`);
rmSync(archive, { force: true });
if (OS === "mac") {
	// Renaming the bundle breaks Electron's signature, and Apple silicon won't run unsigned code: sign ad hoc.
	const bundle = path.join(built, "Learn.app");
	run("codesign", ["--force", "--deep", "--sign", "-", bundle]);
	run("ditto", ["-c", "-k", "--keepParent", bundle, archive]);
	const target = path.join(os.homedir(), "Applications", "Learn.app");
	rmSync(target, { recursive: true, force: true });
	run("ditto", [bundle, target]);
	console.log(`Installed ${target}`);
} else if (OS === "win") {
	// Windows' own tar (bsdtar) writes zips; a Git Bash tar earlier on PATH can't.
	run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", archive, path.basename(built)], RELEASE);
} else {
	// A tarball keeps the executable bits a zip would lose.
	run("tar", ["-czf", archive, path.basename(built)], RELEASE);
}
console.log(`To share: ${archive}`);
