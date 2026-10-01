/** Token counts the way the terminal's status line shows them (1.2k, 45k, 1M). */
export function fmtTokens(n: number) {
	if (n >= 1e6) return `${+(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
	if (n >= 1e3) return `${+(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
	return String(n);
}
