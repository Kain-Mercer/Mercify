// Shows what the launch update check is doing (main.js -> preload-splash.js).
// { text, percent }: percent is a number while downloading, otherwise the bar sweeps.
const textEl = document.getElementById("text");
const bar = document.getElementById("bar");
const fill = document.getElementById("fill");

window.splash.onStatus(({ text, percent }) => {
	textEl.textContent = text || "";
	const known = Number.isFinite(percent);
	bar.classList.toggle("indeterminate", !known);
	fill.style.width = known ? `${Math.max(2, Math.min(100, percent))}%` : "";
});
