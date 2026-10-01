// Providers: each saved key or sign-in, and a form to add or replace a key.
// The server restarts pi to pick a change up, which takes a few seconds.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { api, clearSettingsFocus, getJson, invalidateModels, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SubscriptionLogin } from "./SubscriptionLogin";
import { fieldCls, h3Cls, labelCls, noteCls, sectionCls, selectCls, titleRowCls } from "./styles";

type CustomConfig = { baseUrl: string; api: string; models: Record<string, unknown>[] };
export type Provider = { id: string; name: string; env: string | null; source: "key" | "env" | "login" | "command" | null; tail: string; subscription?: boolean; custom?: boolean; configuredAuth?: boolean; config?: CustomConfig };
const EXAMPLE_MODELS = JSON.stringify([{ id: "model-id", name: "My model", reasoning: false, input: ["text", "image"], contextWindow: 128000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }], null, 2);

function providerStatus(p: Provider) {
	if (!p.source) return p.configuredAuth ? "From models.json" : "No API key";
	if (p.source === "key") return `Key ending ${p.tail}`;
	if (p.source === "env") return `From ${p.env}`;
	return p.source === "login" ? "Signed in" : "Key from a command";
}

const SUFFIX: Partial<Record<string, string>> = { key: " (replace key)", login: " (replace sign-in)" };

export function Providers() {
	const open = useStore((s) => s.settingsOpen);
	const focus = useStore((s) => s.settingsFocus);
	/** undefined until the first load; null when it failed. */
	const [list, setList] = useState<Provider[] | null>();
	const [note, setNote] = useState({ text: "", bad: false });
	const [busy, setBusy] = useState(false);
	const [loginBusy, setLoginBusy] = useState(false);
	const disabled = busy || loginBusy;
	const [pick, setPick] = useState("");
	const keyRef = useRef<HTMLInputElement>(null);
	const [custom, setCustom] = useState<Provider | null | undefined>();

	const show = (next: Provider[] | null | undefined) => {
		setList(next);
		if (!next) setNote({ text: "Couldn't read the providers.", bad: true });
	};

	// Each opening starts without the last note and with a fresh list.
	useEffect(() => {
		if (!open) return;
		let active = true;
		getJson<{ providers?: Provider[] }>("/api/providers")
			.then((r) => { if (active) { setNote({ text: "", bad: false }); show(r?.providers ?? null); } });
		return () => { active = false; };
	}, [open]);

	// Opened from "Set up a provider": scrolled to the API key field.
	useEffect(() => {
		const key = keyRef.current;
		if (!open || focus !== "provider-key" || !key) return;
		key.scrollIntoView({ block: "center" });
		key.focus({ preventScroll: true });
		clearSettingsFocus();
	}, [open, focus]);

	async function request(url: string, body: unknown, working: string, done: string) {
		if (disabled) return false;
		setBusy(true);
		setNote({ text: working, bad: false });
		try {
			const res = await api<{ providers?: Provider[] }>(url, body);
			invalidateModels(); // the picker refetches
			show(res.providers);
			setNote({ text: done, bad: false });
			return true;
		} catch (err) {
			setNote({ text: (err as Error).message, bad: true });
			return false;
		} finally {
			setBusy(false);
		}
	}

	const options = (list || []).filter((p) => p.env);
	const picked = options.some((p) => p.id === pick) ? pick : options[0]?.id || "";
	const rows = (list || []).filter((p) => p.source || p.custom);

	async function submit(e: FormEvent) {
		e.preventDefault();
		const input = keyRef.current;
		const key = input?.value.trim();
		if (!input || !key) return input?.focus();
		const ok = await request("/api/providers", { id: picked, key }, "Saving and restarting the tutor…", "Saved. Its models are in the model picker now.");
		if (ok) input.value = "";
	}

	return (
		<section className={sectionCls}>
			<div className={titleRowCls}>
				<h3 className={h3Cls}>Providers</h3>
				<Button variant="chip" title="Pick up a sign-in made in a terminal" disabled={disabled} onClick={() => request("/api/providers/reload", {}, "Restarting the tutor…", "Reloaded.")}>
					Reload
				</Button>
			</div>
			<p className={cn(noteCls, "[&_code]:font-mono [&_code]:text-[12px] [&_code]:leading-[normal]")}>
				Keys and subscription sign-ins are saved in pi's <code>auth.json</code> on this computer. Reload picks up credentials changed in a terminal.
			</p>
			<div className="flex flex-col">
				{rows.map((p) => (
					<div key={p.id} className="flex min-h-10 items-center gap-3 border-b border-ink/7">
						<span className="flex-1 text-[14px] text-ink">{p.name}</span>
						<span className="text-[12.5px] text-ink-3">{providerStatus(p)}</span>
						{p.custom && <Button variant="chip" disabled={disabled} onClick={() => setCustom(p)}>Edit</Button>}
						{p.custom ? (
							<Button variant="chip" disabled={disabled} onClick={async () => {
								if (await request("/api/providers/custom/remove", { id: p.id }, "Removing and restarting the tutor…", "API endpoint removed.") && custom?.id === p.id) setCustom(undefined);
							}}>Remove</Button>
						) : p.source !== "env" && (
							<Button variant="chip" disabled={disabled} onClick={() => request("/api/providers", { id: p.id, key: "" }, "Removing and restarting the tutor…", "Removed.")}>
								{p.source === "login" ? "Sign out" : "Remove"}
							</Button>
						)}
					</div>
				))}
				{list && !rows.length && <p className={noteCls}>Nothing is set up yet. Sign in or add an API key below.</p>}
			</div>
			{open && list && <SubscriptionLogin providers={list} disabled={busy} onBusy={(busy) => { setLoginBusy(busy); if (busy) setNote({ text: "", bad: false }); }} onComplete={(providers) => { invalidateModels(); show(providers); setNote({ text: "Signed in. Its models are in the model picker now.", bad: false }); }} />}
			<h4 className={h3Cls}>API key</h4>
			<form className="mt-3 mb-2 flex gap-2" onSubmit={submit}>
				<select className={cn(fieldCls, selectCls, "min-w-0 flex-[0_1_190px]")} aria-label="Provider" disabled={disabled} value={picked} onChange={(e) => setPick(e.target.value)}>
					{options.map((p) => (
						<option key={p.id} value={p.id}>
							{`${p.name}${(p.source && SUFFIX[p.source]) || ""}`}
						</option>
					))}
				</select>
				<input
					ref={keyRef}
					className={cn(fieldCls, "min-w-0 flex-1 outline-none placeholder:text-ink-3 focus:border-primary-line")}
					id="provider-key"
					type="password"
					placeholder="API key"
					autoComplete="off"
					spellCheck={false}
					aria-label="API key"
					disabled={disabled}
				/>
				<Button variant="primary" type="submit" disabled={disabled}>
					Add
				</Button>
			</form>
			<Button variant="chip" disabled={disabled} aria-expanded={custom !== undefined} aria-controls="custom-provider-form" onClick={() => setCustom(custom === undefined ? null : undefined)}>{custom === undefined ? "Add API endpoint" : "Close API endpoint"}</Button>
			{custom !== undefined && <CustomProviderForm key={custom?.id ?? "new"} provider={custom} busy={disabled} request={request} onClose={() => setCustom(undefined)} onError={(text) => setNote({ text, bad: true })} />}
			<p role={note.bad ? "alert" : "status"} className={cn(noteCls, "mt-2", note.bad && "text-warn")} hidden={!note.text}>
				{note.text}
			</p>
		</section>
	);
}

function CustomProviderForm({ provider, busy, request, onClose, onError }: {
	provider: Provider | null;
	busy: boolean;
	request: (url: string, body: unknown, working: string, done: string) => Promise<boolean>;
	onClose: () => void;
	onError: (text: string) => void;
}) {
	const [id, setId] = useState(provider?.id ?? "");
	const [baseUrl, setBaseUrl] = useState(provider?.config?.baseUrl ?? "");
	const [api, setApi] = useState(provider?.config?.api ?? "openai-completions");
	const [modelsJson, setModelsJson] = useState(provider?.config ? JSON.stringify(provider.config.models, null, 2) : EXAMPLE_MODELS);
	const [key, setKey] = useState("");
	const [removeKey, setRemoveKey] = useState(false);

	async function submit(e: FormEvent) {
		e.preventDefault();
		if (busy) return;
		let models: unknown;
		try {
			models = JSON.parse(modelsJson);
			if (!Array.isArray(models) || !models.length || models.some((model) => !model || typeof model !== "object" || Array.isArray(model) || typeof model.id !== "string" || !model.id.trim())) {
				throw new Error("API endpoint models must be a non-empty JSON array of objects, each with a model id.");
			}
		} catch (err) {
			onError(err instanceof SyntaxError ? "API endpoint models JSON is invalid. Check its syntax before saving." : (err as Error).message);
			return;
		}
		const body = { id: id.trim(), config: { baseUrl: baseUrl.trim(), api, models }, ...(removeKey || !provider || key.trim() ? { key: removeKey ? "" : key.trim() } : {}) };
		if (await request("/api/providers/custom", body, "Saving and restarting the tutor…", "Saved. Its models are in the model picker now.")) onClose();
	}

	return (
		<form id="custom-provider-form" className="mt-3 mb-3" onSubmit={submit}>
			<fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0 disabled:opacity-60">
				<legend className={h3Cls}>{provider ? `Edit ${provider.id}` : "API endpoint"}</legend>
				<label className={labelCls}>Provider ID
					<input className={fieldCls} required readOnly={!!provider} value={id} onChange={(e) => setId(e.target.value)} placeholder="my-provider" autoCapitalize="none" spellCheck={false} />
				</label>
				<label className={labelCls}>Base URL
					<input className={fieldCls} required type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:1234/v1" />
				</label>
				<label className={labelCls}>API protocol
					<select className={cn(fieldCls, selectCls)} value={api} onChange={(e) => setApi(e.target.value)}>
						<option value="openai-completions">OpenAI Chat Completions</option>
						<option value="openai-responses">OpenAI Responses</option>
						<option value="anthropic-messages">Anthropic Messages</option>
					</select>
				</label>
				<label className={labelCls}>Models (JSON array)
					<textarea className={cn(fieldCls, "h-auto min-h-52 w-full resize-y py-2 font-mono text-[12px] leading-relaxed")} required value={modelsJson} onChange={(e) => setModelsJson(e.target.value)} spellCheck={false} aria-describedby="custom-models-help" />
				</label>
				<p id="custom-models-help" className={cn(noteCls, "mb-0")}>One object per model. Set id, name, reasoning, input (["text"] or ["text", "image"]), contextWindow and maxTokens. Other native pi model options are preserved. Replace the example with your endpoint's model metadata.</p>
				<label className={labelCls}>API key (optional)
					<input className={fieldCls} type="password" value={key} onChange={(e) => setKey(e.target.value)} disabled={removeKey} autoComplete="off" spellCheck={false} aria-describedby="custom-key-help" />
				</label>
				<p id="custom-key-help" className={cn(noteCls, "mb-0")}>{provider ? "Leave blank to keep the saved key." : "Leave blank for a local or keyless endpoint."}</p>
				{provider?.source === "key" && <label className="flex items-center gap-2 text-[12.5px] text-ink-3"><input type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)} />Remove saved API key</label>}
				<div className="flex gap-2"><Button variant="primary" type="submit">{provider ? "Save changes" : "Add endpoint"}</Button><Button variant="chip" type="button" onClick={onClose}>Cancel</Button></div>
			</fieldset>
		</form>
	);
}

