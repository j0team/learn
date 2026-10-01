import { useEffect, useRef } from "react";
import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/ui/button";
import { getJson, openSettings } from "@/lib/store";
import type { Provider } from "./Providers";

// First run: without any provider, the tutor can't answer, so say so up front.
export function Onboarding() {
	const ref = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		getJson<{ providers?: Provider[] }>("/api/providers").then((r) => {
			if (r?.providers && !r.providers.some((p) => p.source)) ref.current?.showModal();
		});
	}, []);

	return (
		// A denser tint in dark mode only; light keeps the glass default.
		<dialog
			ref={ref}
			id="onboard"
			aria-labelledby="onboard-title"
			className="glass m-auto w-[min(420px,calc(100vw_-_32px))] rounded-[24px] px-7 pt-7 pb-5 text-center text-ink [--tint:color-mix(in_oklab,var(--bg)_82%,transparent)] before:inset-0 open:animate-[pop-in_280ms_var(--spring)_both] backdrop:bg-[color-mix(in_srgb,var(--shade)_45%,transparent)] backdrop:backdrop-blur-[3px]"
		>
			<div>
				<Mascot className="inline size-[84px] align-baseline" />
			</div>
			<h2 id="onboard-title" className="mt-2.5 mb-2 font-ui text-[20px]/[1.25] font-semibold tracking-[-0.01em]">
				Connect a model to get started
			</h2>
			<p className="m-0 mb-[22px] text-[14px] leading-normal text-ink-2">
				Learn runs on pi, and pi doesn't have a model provider set up yet. Paste an API key (OpenRouter, Anthropic, OpenAI and more), or sign in with a subscription.
			</p>
			<div className="flex justify-center gap-2">
				<Button variant="quiet" onClick={() => ref.current?.close()}>
					Later
				</Button>
				<Button
					variant="primary"
					// The attribute itself, so showModal() focuses it (React's autoFocus focuses on mount).
					ref={(el) => el?.setAttribute("autofocus", "")}
					onClick={() => {
						ref.current?.close();
						openSettings("provider-key");
					}}
				>
					Set up a provider
				</Button>
			</div>
		</dialog>
	);
}
