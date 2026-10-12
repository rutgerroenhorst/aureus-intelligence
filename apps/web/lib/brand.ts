/**
 * Auriga's three colours (docs/BRAND.md): nero, bianco, blu corsa.
 *
 * The blue marks what is *the interface*: the logo, the selected tab, the main button, a link. It never means profit, warning or loss.
 * Those three keep their own colours (green, amber, red), which is exactly why the brand has none of them: a red background next to a
 * green profit figure reads as a signal, not as a brand.
 */
export const brand = {
  name: "Auriga",
  descriptor: "Early-coin intelligence",
  /** nero: the page */
  bg: "#0b0b0c",
  /** bianco: text and the legs of the mark (warm, not pure white) */
  fg: "#f3f0e8",
  /** blu corsa: fills, borders, the coin in the mark. 3.8:1 on the page, so for large or bold things only */
  blue: "#2f5bff",
  /** the same blue, lighter, for small text and links on the page (7:1) */
  blueText: "#7f97ff",
  /** a tinted fill for a selected row or chip */
  blueSoft: "rgba(47, 91, 255, 0.16)",
  /** a quiet outline for a secondary button */
  blueLine: "rgba(47, 91, 255, 0.55)",
} as const;

/** The wordmark is Jost Bold (a free Futura look-alike, loaded in app/layout.tsx), with Futura where the device has it. */
export const WORDMARK_FONT = "var(--font-wordmark), Futura, 'Avenir Next', 'Helvetica Neue', Arial, sans-serif";
