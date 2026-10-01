// Model picker: a glass panel over the composer with search, provider filter
// chips and the models grouped by provider. The panel anchors to the composer,
// not the button, so it opens clear of it.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Model } from "@/lib/types";
import { focusComposer, getJson, openSettings, post, setModelPicker, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Catalog = { models: Model[] | null; providerNames: Record<string, string> };

// Fetched once per session; adding or removing a provider invalidates it.
let catalog: (Catalog & { version: number }) | null = null;

async function pickModel(m: Model) {
	setModelPicker(false);
	if (await post("/api/model", { provider: m.provider, id: m.id })) focusComposer();
}

export function ModelPicker() {
	const open = useStore((s) => s.modelPickerOpen);
	const busy = useStore((s) => s.busy);
	const model = useStore((s) => s.tuning.model);
	const box = useRef<HTMLDivElement>(null);
	const btn = useRef<HTMLButtonElement>(null);

	// Clicking anywhere outside closes it.
	useEffect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setModelPicker(false);
		document.addEventListener("pointerdown", onDown);
		return () => document.removeEventListener("pointerdown", onDown);
	}, [open]);

	return (
		<div className="min-w-0" ref={box}>
			<Button
				ref={btn}
				variant="chip"
				className="max-w-[220px] disabled:opacity-45"
				title={model ? `${model.provider}/${model.id}` : "Model"}
				aria-haspopup="listbox"
				aria-expanded={open}
				disabled={busy}
				onClick={() => setModelPicker(!open)}
			>
				<span className="truncate">{model ? model.name : "Model"}</span>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path d="m6 12 4-4 4 4" />
				</svg>
			</Button>
			{open && <Panel current={model} onEscape={() => btn.current?.focus()} />}
		</div>
	);
}

function Panel({ current, onEscape }: { current: Model | null; onEscape: () => void }) {
	const version = useStore((s) => s.modelsVersion);
	const [cat, setCat] = useState<Catalog | null>(catalog?.version === version ? catalog : null);
	const [query, setQuery] = useState("");
	const [provider, setProvider] = useState(() => localStorage.getItem("learn-model-provider") || ""); // "" = all providers
	const [hl, setHl] = useState(-1);
	const search = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => search.current?.focus(), []);

	useEffect(() => {
		if (catalog?.version === version) return setCat(catalog);
		let live = true;
		getJson<Partial<Catalog>>("/api/models").then((r) => {
			const next = { models: r?.models || null, providerNames: r?.providerNames || {}, version };
			// A failed load isn't cached, so the next open tries again.
			if (next.models) catalog = next;
			if (live) setCat(next);
		});
		return () => void (live = false);
	}, [version]);

	const label = (id: string) => cat?.providerNames[id] || id;
	const models = cat?.models;
	const providers = models ? [...new Set(models.map((m) => m.provider))] : [];
	const filter = providers.includes(provider) ? provider : "";
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	const hits = (models || [])
		.filter((m) => !filter || m.provider === filter)
		.filter((m) => terms.every((t) => `${m.provider} ${label(m.provider)} ${m.id} ${m.name}`.toLowerCase().includes(t)))
		.slice(0, 200);

	// The list re-renders on every search or filter change; the highlight starts over.
	useEffect(() => setHl(-1), [query, filter, cat]);
	useEffect(() => {
		if (hl >= 0) list.current?.querySelectorAll("button")[hl]?.scrollIntoView({ block: "nearest" });
	}, [hl]);

	const pickProvider = (p: string) => {
		setProvider(p);
		localStorage.setItem("learn-model-provider", p);
		search.current?.focus();
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			e.preventDefault();
			setModelPicker(false);
			return onEscape();
		}
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			setHl((h) => Math.max(0, Math.min(hits.length - 1, h + (e.key === "ArrowDown" ? 1 : -1))));
		}
		if (e.key === "Enter") {
			// The search sits inside the composer's form; Enter picks, it never sends.
			e.preventDefault();
			const m = hits[Math.max(0, hl)];
			if (m) pickModel(m);
		}
	};

	let group = "";
	return (
		<div
			className="glass absolute bottom-[calc(100%+10px)] left-0 z-10 flex max-h-[min(460px,60vh)] w-[420px] animate-pop-in flex-col overflow-hidden rounded-[16px] [--tint-light:color-mix(in_oklab,white_95%,transparent)] [--tint:color-mix(in_oklab,var(--bg)_95%,transparent)]"
		>
			<input
				ref={search}
				className="m-2 rounded-[8px] border border-line bg-bg/70 px-2.5 py-2 font-ui text-[14px] leading-[normal] text-ink outline-none focus:border-primary-line"
				type="search"
				placeholder="Search models"
				autoComplete="off"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={onKeyDown}
			/>
			{/* One chip per provider that has models, plus All; hidden when there's only one. */}
			{providers.length >= 2 && (
				<div className="flex flex-wrap gap-1 px-2 pt-0 pb-1.5" aria-label="Filter by provider">
					{["", ...providers].map((p) => (
						<Button
							key={p}
							variant="chip"
							aria-pressed={p === filter}
							className={cn(
								"h-[26px] rounded-full px-2.5 text-[12.5px]",
								p === filter
									? "bg-primary-soft text-primary shadow-[inset_0_0_0_1px_var(--accent-line)] hover:enabled:bg-primary-soft hover:enabled:text-primary"
									: "bg-ink/6 hover:enabled:bg-ink/11 hover:enabled:text-ink",
							)}
							onClick={() => pickProvider(p)}
						>
							{p ? label(p) : "All"}
						</Button>
					))}
				</div>
			)}
			<div ref={list} className="overflow-y-auto px-1.5 pt-0 pb-2" role="listbox">
				{!cat ? (
					<div className="p-2.5 text-ink-3">Loading models…</div>
				) : !models ? (
					<div className="p-2.5 text-ink-3">Couldn't load models.</div>
				) : (
					<>
						{hits.map((m, i) => {
							const head = m.provider !== group ? label((group = m.provider)) : null;
							const selected = !!current && current.provider === m.provider && current.id === m.id;
							return (
								<Fragment key={`${m.provider}/${m.id}`}>
									{head && <h4 className="mx-2 mt-2.5 mb-1 font-ui text-[12.5px] leading-[normal] font-medium text-ink-3">{head}</h4>}
									<button
										type="button"
										role="option"
										aria-selected={selected || undefined}
										className={cn(
											"flex w-full justify-between gap-3 rounded-[7px] border-0 bg-transparent px-2.5 py-[7px] text-left text-[13.5px] text-ink-2",
											selected
												? "bg-ink/12 text-ink shadow-[inset_0_0_0_1px_var(--line)]"
												: cn("hover:bg-ink/9 hover:text-ink", i === hl && "bg-ink/9 text-ink"),
										)}
										onClick={() => pickModel(m)}
									>
										<span>{m.name}</span>
										<span className="truncate text-[12px] text-ink-3">{m.id}</span>
									</button>
								</Fragment>
							);
						})}
						{!hits.length && <div className="p-2.5 text-ink-3">No matching models.</div>}
					</>
				)}
			</div>
			<div className="flex items-center justify-between gap-2.5 border-t border-line py-2 pr-2 pl-4 text-[12.5px] text-ink-3">
				<span>Can't find your provider or model?</span>
				<Button
					variant="chip"
					className="text-primary hover:enabled:bg-primary-soft"
					onClick={() => {
						setModelPicker(false);
						openSettings("provider-key");
					}}
				>
					Set up providers
				</Button>
			</div>
		</div>
	);
}
