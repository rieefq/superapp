/**
 * Keyframes the primitives need beyond Tailwind's defaults. Rendered as a React 19 hoisted <style>
 * (deduplicated by href), so any component can include <PrimitiveStyles /> and the CSS lands in <head> once.
 *
 * Reduced motion (OS setting or html[data-motion='reduce']): decorative motion (shimmer, breathing dots)
 * stops; status motion that carries meaning degrades gently — spinners turn slower, the indeterminate bar
 * becomes an opacity pulse instead of travelling.
 */
const REDUCED = `html[data-motion='reduce']`
const OS_REDUCED = `html:not([data-motion='full'])`

const CSS = `
@keyframes atrium-spin { to { transform: rotate(360deg) } }
.atrium-spin { animation: atrium-spin 0.9s linear infinite; }
@keyframes atrium-shimmer { from { background-position: 150% 0 } to { background-position: -50% 0 } }
.atrium-shimmer {
  background-image: linear-gradient(100deg, transparent 20%, color-mix(in oklab, var(--ink) 7%, transparent) 50%, transparent 80%);
  background-size: 200% 100%;
  background-repeat: no-repeat;
  animation: atrium-shimmer 1.8s var(--ease-standard) infinite;
}
@keyframes atrium-indeterminate {
  0% { transform: translateX(-100%) scaleX(0.6) }
  60% { transform: translateX(160%) scaleX(1) }
  100% { transform: translateX(260%) scaleX(0.6) }
}
.atrium-indeterminate { animation: atrium-indeterminate 1.5s var(--ease-standard) infinite; }
@keyframes atrium-soft-pulse { 0%, 100% { opacity: 0.35 } 50% { opacity: 1 } }
/* Live breathing (DESIGN §8.2): opacity 0.55 ↔ 1 at --dur-breathe. No glows. */
@keyframes atrium-breathe { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }
.atrium-breathe { animation: atrium-breathe var(--dur-breathe, 1600ms) ease-in-out infinite; }

/*
 * Clickable surfaces with nested controls (cards, list rows): a full-size overlay <button> sits behind the
 * content; content lets clicks pass through to it, while nested controls stay independently clickable.
 */
.atrium-passthrough { pointer-events: none; }
.atrium-passthrough :is(a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"],
  [role="menuitem"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [tabindex]:not([tabindex="-1"]),
  [data-interactive]) { pointer-events: auto; }

/* Range input: hairline track, ink fill up to --pct, raised knob. */
.atrium-range {
  -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 20px; margin: 0;
  background: transparent; cursor: pointer; --pct: 50%;
}
.atrium-range:disabled { cursor: not-allowed; }
.atrium-range:focus-visible { outline: none; }
.atrium-range::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px;
  background: linear-gradient(to right, var(--ink-2) var(--pct), var(--line-strong) var(--pct));
}
.atrium-range::-moz-range-track { height: 4px; border-radius: 2px; background: var(--line-strong); }
.atrium-range::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--ink-2); }
.atrium-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 16px; height: 16px; margin-top: -6px; border-radius: 50%;
  background: var(--surface-raised); border: 1px solid var(--line-input);
  box-shadow: var(--shadow-e1);
  transition: border-color var(--dur-1) var(--ease-standard), background-color var(--dur-1) var(--ease-standard);
}
.atrium-range::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%; box-sizing: border-box;
  background: var(--surface-raised); border: 1px solid var(--line-input); box-shadow: var(--shadow-e1);
}
.atrium-range:not(:disabled):hover::-webkit-slider-thumb { border-color: var(--ink-3); }
.atrium-range:not(:disabled):active::-webkit-slider-thumb { border-color: var(--ink-2); background: var(--surface-press); }
.atrium-range:not(:disabled):hover::-moz-range-thumb { border-color: var(--ink-3); }
.atrium-range:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.atrium-range:focus-visible::-moz-range-thumb { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
@media (pointer: coarse) {
  .atrium-range { height: 44px; }
  .atrium-range::-webkit-slider-thumb { width: 22px; height: 22px; margin-top: -9px; }
  .atrium-range::-moz-range-thumb { width: 22px; height: 22px; }
}

@media (prefers-reduced-motion: reduce) {
  ${OS_REDUCED} .atrium-shimmer { animation: none !important; }
  ${OS_REDUCED} .atrium-breathe { animation: none !important; outline: 1px solid var(--live); outline-offset: 1px; }
  ${OS_REDUCED} .atrium-spin { animation-duration: 2.4s !important; animation-iteration-count: infinite !important; }
  ${OS_REDUCED} .atrium-indeterminate {
    animation: atrium-soft-pulse 2.4s ease-in-out infinite !important; transform: none; left: 0; width: 100% !important;
  }
}
${REDUCED} .atrium-shimmer { animation: none !important; }
${REDUCED} .atrium-breathe { animation: none !important; outline: 1px solid var(--live); outline-offset: 1px; }
${REDUCED} .atrium-spin { animation-duration: 2.4s !important; animation-iteration-count: infinite !important; }
${REDUCED} .atrium-indeterminate {
  animation: atrium-soft-pulse 2.4s ease-in-out infinite !important; transform: none; left: 0; width: 100% !important;
}
`

export function PrimitiveStyles() {
  return (
    <style href="atrium-primitives" precedence="default">
      {CSS}
    </style>
  )
}
