import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Provider } from "./Providers";
import { fieldCls, h3Cls, labelCls, noteCls, selectCls } from "./styles";

type LoginEvent = { type: "auth_url" | "device_code" | "info" | "progress"; url?: string; instructions?: string; userCode?: string; verificationUri?: string; message?: string; links?: { url?: string; label?: string }[] };
type Prompt = { id: string; type: "select" | "text" | "secret" | "manual_code"; message: string; placeholder?: string; options?: { id: string; label: string; description?: string }[] };
type Login = { id: string; provider: string; status: "waiting" | "ready" | "error" | "cancelled"; event?: LoginEvent; prompt?: Prompt; error?: string };

const loginApi = (path: string, body?: unknown) => api<{ login?: Login; providers?: Provider[] }>(`/api/providers/login${path}`, body);

function safeUrl(value?: string) {
	if (!value) return undefined;
	try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined; } catch { return undefined; }
}

export function SubscriptionLogin({ providers, disabled, onBusy, onComplete }: { providers: Provider[]; disabled: boolean; onBusy: (busy: boolean) => void; onComplete: (providers: Provider[]) => void }) {
	const [login, setLogin] = useState<Login>();
	const [active, setActive] = useState(false);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState("");
	const [value, setValue] = useState("");
	const current = useRef<Login | undefined>(undefined);
	const generation = useRef(0);
	const timer = useRef<number | undefined>(undefined);
	const callbacks = useRef({ onBusy, onComplete });
	callbacks.current = { onBusy, onComplete };

	useEffect(() => {
		const gen = generation;
		return () => {
			gen.current++; // Late replies to an unmounted form are dropped.
			clearTimeout(timer.current);
			const flow = current.current;
			if (flow && (flow.status === "waiting" || flow.status === "ready")) void loginApi("/cancel", { id: flow.id }).catch(() => {});
			callbacks.current.onBusy(false);
		};
	}, []);

	function alive(token: number) { return token === generation.current; }
	function fail(token: number, err: unknown) {
		if (alive(token)) { setError((err as Error).message); setWorking(false); }
	}
	function stop() {
		clearTimeout(timer.current);
		setActive(false);
		setWorking(false);
		setValue("");
		callbacks.current.onBusy(false);
	}

	async function finish(flow: Login, token: number) {
		setWorking(true);
		setError("");
		try {
			const result = await loginApi("/finish", { id: flow.id });
			if (!alive(token)) return;
			if (!result.providers) throw new Error("The provider list was not returned. Retry finish to reload your sign-in.");
			current.current = undefined;
			setLogin(undefined);
			stop();
			callbacks.current.onComplete(result.providers);
		} catch (err) {
			fail(token, err);
		}
	}

	function accept(flow: Login, token: number) {
		if (!alive(token)) return;
		if (current.current?.prompt?.id !== flow.prompt?.id) setValue("");
		current.current = flow;
		setLogin(flow);
		if (flow.status === "ready") { setValue(""); void finish(flow, token); return; }
		if (flow.status !== "waiting") { setError(flow.error || ""); stop(); return; }
		timer.current = window.setTimeout(() => void poll(flow.id, token), 500);
	}

	async function poll(id: string, token: number) {
		try {
			const result = await loginApi(`?id=${encodeURIComponent(id)}`);
			if (!result.login) throw new Error("The sign-in status was not returned.");
			accept(result.login, token);
		} catch (err) {
			fail(token, err);
		}
	}

	async function start(provider: string) {
		if (disabled || active) return;
		const token = ++generation.current;
		setLogin(undefined); setError(""); setValue(""); setActive(true); setWorking(true);
		callbacks.current.onBusy(true);
		try {
			const result = await loginApi("", { provider });
			if (!result.login) throw new Error("The sign-in could not be started.");
			if (!alive(token)) { void loginApi("/cancel", { id: result.login.id }).catch(() => {}); return; }
			setWorking(false);
			accept(result.login, token);
		} catch (err) {
			if (alive(token)) { setError((err as Error).message); stop(); }
		}
	}

	async function answer(event: FormEvent) {
		event.preventDefault();
		const flow = current.current;
		if (!flow?.prompt || working) return;
		const answerValue = value || (flow.prompt.type === "select" ? flow.prompt.options?.[0]?.id : "");
		if (!answerValue) return;
		const token = ++generation.current;
		clearTimeout(timer.current);
		setWorking(true); setError(""); setValue("");
		try {
			const result = await loginApi("/answer", { id: flow.id, promptId: flow.prompt.id, value: answerValue });
			if (!alive(token)) return;
			setWorking(false);
			if (!result.login) throw new Error("The sign-in status was not returned.");
			accept(result.login, token);
		} catch (err) {
			fail(token, err);
		}
	}

	async function cancel() {
		const flow = current.current;
		const token = ++generation.current;
		clearTimeout(timer.current); setValue(""); setWorking(true);
		try {
			if (flow) await loginApi("/cancel", { id: flow.id });
			if (!alive(token)) return;
			current.current = undefined; setLogin(undefined); setError(""); stop();
		} catch (err) {
			if (alive(token)) { setError(`Could not cancel: ${(err as Error).message}. Try Cancel again.`); setWorking(false); }
		}
	}

	const event = login?.event;
	const prompt = login?.prompt;
	const url = safeUrl(event?.url || event?.verificationUri);
	return <div className="mt-3 mb-4">
		<h4 className={h3Cls}>Subscription sign-in</h4>
		<p className={noteCls}>Use your Claude or ChatGPT subscription. Sign-in is saved on this computer.</p>
		<div className="flex flex-wrap gap-2">
			{providers.filter((provider) => provider.subscription).map((provider) => <Button key={provider.id} variant="chip" disabled={disabled || active} onClick={() => void start(provider.id)}>{provider.source === "login" ? "Reconnect" : "Sign in to"} {provider.name}</Button>)}
		</div>
		{active && <div className="mt-3 flex flex-col gap-2">
			<p className={cn(noteCls, "mb-0")} role="status">{login?.status === "ready" ? (working ? "Saving sign-in and restarting the tutor…" : "Sign-in is complete. Finish saving to use its models.") : event?.message || event?.instructions || (working ? "Starting sign-in…" : "Waiting for sign-in…")}</p>
			{url && <a className="text-[13px] text-primary underline underline-offset-2" href={url} target="_blank" rel="noopener noreferrer">Open sign-in link</a>}
			{event?.userCode && <p className={noteCls}>Device code: <code className="select-all font-mono">{event.userCode}</code></p>}
			{event?.links?.map((link, index) => { const href = safeUrl(link.url); return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer" className="text-[13px] text-primary underline">{link.label || link.url}</a> : null; })}
			{prompt && login?.status === "waiting" && <form className="flex flex-col gap-2" onSubmit={answer}>
				<label className={labelCls}>{prompt.message}
					{prompt.type === "select" ? <select className={cn(fieldCls, selectCls)} disabled={working} value={value || prompt.options?.[0]?.id || ""} onChange={(e) => setValue(e.target.value)}>{prompt.options?.map((option) => <option key={option.id} value={option.id}>{option.label}{option.description ? ` — ${option.description}` : ""}</option>)}</select> : <input className={fieldCls} type={prompt.type === "secret" || prompt.type === "manual_code" ? "password" : "text"} required disabled={working} value={value} onChange={(e) => setValue(e.target.value)} placeholder={prompt.placeholder} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
				</label>
				<Button variant="primary" type="submit" disabled={working}>Continue</Button>
			</form>}
			<div className="flex gap-2">
				{login?.status === "ready" && !working && <Button variant="primary" onClick={() => void finish(login, generation.current)}>Retry finish</Button>}
				{error && login?.status === "waiting" && !working && <Button variant="chip" onClick={() => { setError(""); void poll(login.id, generation.current); }}>Retry status</Button>}
				<Button variant="chip" onClick={() => void cancel()}>Cancel sign-in</Button>
			</div>
		</div>}
		{error && <p role="alert" className={cn(noteCls, "mt-2 text-warn")}>{error}</p>}
	</div>;
}
