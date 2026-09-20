/**
 * Centralized confidence formatting utility
 *
 * Internal canonical representation: 0-100 (percent)
 * Database stores: 0-100
 * Evaluator returns: 0-100
 * Frontend displays: "0%" to "100%"
 */

export function formatConfidence(value: number | null | undefined): string {
  if (value == null) return "—";

  // Validate range
  if (typeof value !== "number" || isNaN(value)) {
    console.warn("[confidenceFormatter] Invalid confidence value:", value);
    return "unavailable";
  }

  // Check bounds - should be 0-100
  if (value < 0 || value > 100) {
    console.error(
      "[confidenceFormatter] Confidence out of range [0-100]:",
      value
    );
    return "unavailable";
  }

  // Round and format
  return `${Math.round(value)}%`;
}

/**
 * Get confidence as a decimal (0-1) for styling/calculations
 * Returns null if invalid
 */
export function getConfidenceDecimal(value: number | null | undefined): number | null {
  if (value == null) return null;

  if (typeof value !== "number" || isNaN(value)) {
    console.warn("[confidenceFormatter] Invalid confidence value:", value);
    return null;
  }

  if (value < 0 || value > 100) {
    console.error(
      "[confidenceFormatter] Confidence out of range [0-100]:",
      value
    );
    return null;
  }

  return value / 100;
}
