import { type RefObject, useEffect, useId, useRef } from "react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Pi, the app's mascot. Animations live in index.css (.mascot, .pi-*): at rest it
// bobs, blinks and watches the pointer; it hops while the tutor works, wiggles
// when an ancestor with `mascot-host` is hovered, and celebrates when the tutor
// finishes. One-off reactions ("acts") are set as data-act on the <svg>.

/** One-off reactions and how long each runs (matches the keyframes in index.css). */
const ACTS = { jump: 1100, look: 1500, whirl: 1500, dizzy: 1700, happy: 1300, tilt: 1100, wake: 900 } as const;
type Act = keyof typeof ACTS;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Play an act from the start, even if one is running. */
function useActs(svg: RefObject<SVGSVGElement | null>) {
	const timer = useRef(0);
	useEffect(() => () => clearTimeout(timer.current), []);
	return (act: Act) => {
		const el = svg.current;
		if (!el || reducedMotion()) return;
		clearTimeout(timer.current);
		delete el.dataset.act;
		void el.getBoundingClientRect(); // restart the animation
		el.dataset.act = act;
		timer.current = window.setTimeout(() => delete el.dataset.act, ACTS[act]);
	};
}

/** The eyes follow the pointer and the head leans after them. A frame loop eases
 *  toward the target (CSS transitions restart on every pointer event, which reads
 *  as jitter), with the head a beat behind the eyes. It stops once settled. */
const EYE_LAG = 70; // ms to cover ~63% of the way
const HEAD_LAG = 220;

function useGaze(svg: RefObject<SVGSVGElement | null>) {
	useEffect(() => {
		const el = svg.current;
		if (!el || reducedMotion()) return;
		const target = { x: 0, y: 0 };
		const eye = { x: 0, y: 0 };
		const head = { x: 0, y: 0 };
		let px = 0;
		let py = 0;
		let aim = false; // pointer moved since the last frame
		let frame = 0;
		let last = 0;
		const ease = (v: { x: number; y: number }, lag: number, dt: number) => {
			const k = 1 - Math.exp(-dt / lag);
			v.x += (target.x - v.x) * k;
			v.y += (target.y - v.y) * k;
		};
		const tick = (now: number) => {
			const dt = Math.min(64, now - (last || now - 16));
			last = now;
			if (aim) {
				aim = false;
				const r = el.getBoundingClientRect();
				const dx = px - (r.left + r.width / 2);
				const dy = py - (r.top + r.height * 0.3);
				const d = Math.hypot(dx, dy) || 1;
				const reach = Math.tanh(d / 160); // a full glance once the pointer is a little way off
				target.x = (dx / d) * reach;
				target.y = (dy / d) * reach;
			}
			ease(eye, EYE_LAG, dt);
			ease(head, HEAD_LAG, dt);
			el.style.setProperty("--lx", eye.x.toFixed(4));
			el.style.setProperty("--ly", eye.y.toFixed(4));
			el.style.setProperty("--hx", head.x.toFixed(4));
			const settled = Math.abs(target.x - head.x) + Math.abs(target.y - head.y) + Math.abs(target.x - eye.x) + Math.abs(target.y - eye.y) < 0.002;
			frame = settled ? 0 : requestAnimationFrame(tick);
			if (settled) last = 0;
		};
		const wake = () => (frame ||= requestAnimationFrame(tick));
		const move = (e: PointerEvent) => {
			px = e.clientX;
			py = e.clientY;
			aim = true;
			wake();
		};
		const away = () => {
			target.x = target.y = 0;
			wake();
		};
		window.addEventListener("pointermove", move, { passive: true });
		document.documentElement.addEventListener("pointerleave", away);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("pointermove", move);
			document.documentElement.removeEventListener("pointerleave", away);
		};
	}, [svg]);
}

/** A little celebration when a lesson's tutor finishes a turn, this one or one in the background. */
function useCheer(play: (act: Act) => void) {
	const playRef = useRef(play);
	playRef.current = play;
	useEffect(() => useStore.subscribe((s, prev) => prev.running.some((f) => !s.running.includes(f)) && playRef.current("happy")), []);
}

function PiSvg({ svg, className }: { svg: RefObject<SVGSVGElement | null>; className?: string }) {
	const grad = useId();
	return (
		<svg ref={svg} className={cn("mascot", className)} viewBox="0 0 64 64" aria-hidden="true">
			<defs>
				<linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#f9cdec" />
					<stop offset="1" stopColor="#ee9fd6" />
				</linearGradient>
			</defs>
			<g className="pi-bob">
				<path className="pi-leg l" d="M23 27c0 11-1.5 19-7 26" fill="none" stroke="#e892cf" strokeWidth="9" strokeLinecap="round" />
				<path className="pi-leg r" d="M41 27v20c0 5 2.5 7.5 7.5 6.5" fill="none" stroke="#e892cf" strokeWidth="9" strokeLinecap="round" />
				<g className="pi-head">
					<rect x="6" y="9" width="52" height="22" rx="11" fill={`url(#${grad})`} />
					<ellipse cx="17" cy="14.5" rx="6" ry="2.4" fill="#fff" opacity=".55" />
					<g className="pi-eyes">
						<circle cx="24.5" cy="20" r="2.6" fill="#3b2f4a" />
						<circle cx="39.5" cy="20" r="2.6" fill="#3b2f4a" />
						<circle cx="25.4" cy="19.1" r=".9" fill="#fff" />
						<circle cx="40.4" cy="19.1" r=".9" fill="#fff" />
					</g>
					<ellipse cx="17.5" cy="24" rx="3.6" ry="2.1" fill="#f57fb4" opacity=".55" />
					<ellipse cx="46.5" cy="24" rx="3.6" ry="2.1" fill="#f57fb4" opacity=".55" />
					<path d="M29.5 23.5q2.5 2.6 5 0" fill="none" stroke="#3b2f4a" strokeWidth="1.8" strokeLinecap="round" />
				</g>
			</g>
			{/* Shown only while celebrating (sparks) or asleep (z's). */}
			<g className="pi-sparks" fill="#f9cdec">
				{[
					[4, 8],
					[60, 5],
					[61, 30],
				].map(([x, y]) => (
					<g key={x} transform={`translate(${x} ${y})`}>
						<path className="pi-spark" d="M0-4.5 1.2-1.2 4.5 0 1.2 1.2 0 4.5-1.2 1.2-4.5 0-1.2-1.2z" />
					</g>
				))}
			</g>
			<g className="pi-zzz" fill="#f9cdec" fontFamily="var(--ui)" fontWeight="700">
				{[0, 1, 2].map((i) => (
					<text key={i} className="pi-z" x={50 + i * 5} y={8 - i * 5} fontSize={8 + i * 3}>
						z
					</text>
				))}
			</g>
		</svg>
	);
}

/** The plain mascot (sidebar, onboarding): watches the pointer and cheers when the tutor finishes. */
export function Mascot({ className }: { className?: string }) {
	const svg = useRef<SVGSVGElement>(null);
	const play = useActs(svg);
	useGaze(svg);
	useCheer(play);
	return <PiSvg svg={svg} className={className} />;
}

const POKES: Act[] = ["jump", "look", "whirl"];
const IDLES: Act[] = ["look", "tilt", "jump"];
const SLEEP_AFTER = 45_000;

/** The home page's big mascot, Clawd style: poke it for a hop, a look around or a
 *  whirlpool swirl (poke it a lot and it gets dizzy), it fidgets now and then, dozes off when
 *  you've been away a while, and stretches awake when you're back. */
export function LivelyMascot({ className, svgClassName }: { className?: string; svgClassName?: string }) {
	const svg = useRef<SVGSVGElement>(null);
	const play = useActs(svg);
	const pokes = useRef<number[]>([]);
	const last = useRef<Act | null>(null);
	useGaze(svg);
	useCheer(play);

	const pick = (from: Act[]) => {
		const options = from.filter((a) => a !== last.current);
		const act = options[Math.floor(Math.random() * options.length)];
		last.current = act;
		return act;
	};

	const poke = () => {
		const el = svg.current;
		if (el?.dataset.sleep) return wake();
		const now = performance.now();
		pokes.current = [...pokes.current.filter((t) => now - t < 1400), now];
		if (pokes.current.length >= 4) {
			pokes.current = [];
			return play("dizzy");
		}
		play(pick(POKES));
	};

	const wake = () => {
		const el = svg.current;
		if (!el?.dataset.sleep) return;
		delete el.dataset.sleep;
		play("wake");
	};

	// Fidget every so often; doze off after a while without the pointer or keys.
	useEffect(() => {
		if (reducedMotion()) return;
		let idle = 0;
		let sleep = 0;
		const calm = () => !useStore.getState().busy && !document.hidden && !svg.current?.dataset.act;
		const fidget = () => {
			idle = window.setTimeout(() => {
				if (calm() && !svg.current?.dataset.sleep) play(pick(IDLES));
				fidget();
			}, 7000 + Math.random() * 7000);
		};
		const drowsy = () => {
			clearTimeout(sleep);
			sleep = window.setTimeout(() => {
				if (calm() && svg.current) svg.current.dataset.sleep = "on";
				else drowsy();
			}, SLEEP_AFTER);
		};
		const active = () => {
			wake();
			drowsy();
		};
		fidget();
		drowsy();
		window.addEventListener("pointermove", active, { passive: true });
		window.addEventListener("keydown", active);
		return () => {
			clearTimeout(idle);
			clearTimeout(sleep);
			window.removeEventListener("pointermove", active);
			window.removeEventListener("keydown", active);
		};
		// play/pick/wake only touch refs, so the timers set up once are enough.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<button type="button" className={cn("mascot-host cursor-pointer border-0 bg-transparent p-0", className)} aria-label="Say hi to Pi" title="Hi!" onClick={poke}>
			<PiSvg svg={svg} className={svgClassName} />
		</button>
	);
}
