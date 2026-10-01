// "Save to vault": the folder the tutor writes the lesson note into. The first
// time it asks; after that the last folder is filled in (and selected), so
// saving there again is one Enter and saving somewhere else is just typing.

import { type KeyboardEvent, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fieldCls } from "@/components/settings/styles";
import { Button } from "@/components/ui/button";
import { closeSave, getJson, saveTo } from "@/lib/store";
import { cn } from "@/lib/utils";

const GAP = 6;
const EDGE = 8;
const SHOWN = 60; // folders listed at once; typing narrows them

/** What `vaultFolder` on the server will make of the text: "a\b/ c/" → "a/b/c". */
const tidy = (s: string) =>
	s
		.replace(/\\/g, "/")
		.split("/")
		.map((p) => p.trim())
		.filter(Boolean)
		.join("/");

export function SaveMenu({ anchor }: { anchor: RefObject<HTMLButtonElement | null> }) {
	const [folders, setFolders] = useState<string[] | null>(null);
	const [first, setFirst] = useState(false);
	const [value, setValue] = useState("");
	const [hl, setHl] = useState(-1);
	const [saving, setSaving] = useState(false);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	const box = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLUListElement>(null);
	const id = useId();

	useEffect(() => {
		getJson<{ folders?: string[]; saved?: string | null }>("/api/folders").then((r) => {
			setFolders(r?.folders || []);
			if (!r) return;
			if (!r.saved) return setFirst(true);
			setValue(r.saved);
			requestAnimationFrame(() => input.current?.select());
		});
	}, []);

	// Under the button, right edges lined up.
	useLayoutEffect(() => {
		const place = () => {
			const a = anchor.current?.getBoundingClientRect();
			const m = box.current?.getBoundingClientRect();
			if (!a || !m) return;
			setPos({ left: Math.max(EDGE, Math.min(a.right - m.width, innerWidth - EDGE - m.width)), top: a.bottom + GAP });
		};
		place();
		window.addEventListener("resize", place);
		return () => window.removeEventListener("resize", place);
	}, [anchor]);

	useEffect(() => {
		const down = (e: PointerEvent) => {
			const t = e.target as Node;
			if (!box.current?.contains(t) && !anchor.current?.contains(t)) closeSave();
		};
		document.addEventListener("pointerdown", down);
		return () => document.removeEventListener("pointerdown", down);
	}, [anchor]);

	useEffect(() => {
		if (hl >= 0) list.current?.children[hl]?.scrollIntoView({ block: "nearest" });
	}, [hl]);

	const folder = tidy(value);
	// "stat 341" finds stat/341: every word has to appear somewhere in the path.
	const terms = value.toLowerCase().split(/[\s/\\]+/).filter(Boolean);
	const matches = (folders || []).filter((f) => terms.every((t) => f.toLowerCase().includes(t))).slice(0, SHOWN);
	const isNew = !!folder && !!folders && !folders.includes(folder);

	const pick = (f: string) => {
		setValue(f);
		setHl(-1);
		input.current?.focus();
	};
	const close = () => {
		closeSave();
		anchor.current?.focus();
	};
	const submit = async () => {
		if (!folder || saving) return;
		setSaving(true);
		if (!(await saveTo(folder))) setSaving(false);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.nativeEvent.isComposing) return;
		const n = matches.length;
		if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) {
			e.preventDefault();
			setHl((i) => (e.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
		} else if (e.key === "Enter" && hl >= 0 && matches[hl]) {
			// Enter on a highlighted folder picks it; the next Enter saves.
			e.preventDefault();
			pick(matches[hl]);
		} else if (e.key === "Escape") {
			e.preventDefault();
			close();
		}
	};

	return createPortal(
		<div
			ref={box}
			role="dialog"
			aria-label="Save to vault"
			// Unplaced for one frame: transparent rather than hidden, so the field can take focus.
			style={pos ?? { left: 0, top: 0, opacity: 0 }}
			className="glass fixed z-50 w-[340px] max-w-[calc(100vw-16px)] animate-pop-in rounded-xl p-3 [--tint-light:color-mix(in_oklab,white_82%,transparent)] [--tint:color-mix(in_oklab,var(--bg)_82%,transparent)]"
		>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<label htmlFor={`${id}-folder`} className="mb-2 block font-ui text-[13px] leading-[1.4] font-medium text-ink">
					{first ? "Where should lesson notes go?" : "Save this lesson to"}
				</label>
				<input
					ref={input}
					id={`${id}-folder`}
					// biome-ignore lint/a11y/noAutofocus: the picker opens to type a folder
					autoFocus
					className={cn(fieldCls, "w-full outline-none placeholder:text-ink-3 focus:border-primary/55")}
					placeholder="A folder in your vault, e.g. notes/lessons"
					autoComplete="off"
					spellCheck={false}
					role="combobox"
					aria-expanded={matches.length > 0}
					aria-controls={`${id}-list`}
					aria-activedescendant={hl >= 0 ? `${id}-${hl}` : undefined}
					value={value}
					onChange={(e) => {
						setValue(e.target.value);
						setHl(-1);
					}}
					onKeyDown={onKeyDown}
				/>
				{matches.length > 0 && (
					<ul ref={list} id={`${id}-list`} role="listbox" aria-label="Folders" className="m-0 mt-1.5 max-h-[216px] list-none overflow-y-auto overscroll-contain p-0">
						{matches.map((f, i) => (
							<li
								key={f}
								id={`${id}-${i}`}
								role="option"
								aria-selected={i === hl}
								// Keep focus in the field.
								onPointerDown={(e) => e.preventDefault()}
								onClick={() => pick(f)}
								className={cn(
									"cursor-pointer truncate rounded-lg px-2.5 py-[5px] font-ui text-[13px] leading-[1.4] text-ink-2 hover:bg-ink/9 hover:text-ink",
									i === hl && "bg-ink/9 text-ink",
									f === folder && "text-primary hover:text-primary",
								)}
							>
								{f}
							</li>
						))}
					</ul>
				)}
				<p className="m-0 mt-2 font-ui text-[12px] leading-[1.45] text-ink-3">
					{isNew && "A new folder; the tutor will make it. "}
					Learn remembers this folder for next time.
				</p>
				<div className="mt-3 flex justify-end gap-1.5">
					<Button variant="quiet" onClick={close}>
						Cancel
					</Button>
					<Button variant="primary" type="submit" disabled={!folder || saving}>
						Save
					</Button>
				</div>
			</form>
		</div>,
		document.body,
	);
}
