import { describe, it, expect } from "vitest";
import { formatConfidence, getConfidenceDecimal } from "./confidenceFormatter";

describe("confidenceFormatter", () => {
  describe("formatConfidence", () => {
    it("formats valid values 0-100 as percentages", () => {
      expect(formatConfidence(0)).toBe("0%");
      expect(formatConfidence(30)).toBe("30%");
      expect(formatConfidence(50)).toBe("50%");
      expect(formatConfidence(100)).toBe("100%");
    });

    it("handles null/undefined", () => {
      expect(formatConfidence(null)).toBe("—");
      expect(formatConfidence(undefined)).toBe("—");
    });

    it("rejects out-of-range values", () => {
      expect(formatConfidence(-1)).toBe("unavailable");
      expect(formatConfidence(101)).toBe("unavailable");
      expect(formatConfidence(3000)).toBe("unavailable");
    });

    it("rejects non-numeric values", () => {
      expect(formatConfidence(NaN)).toBe("unavailable");
    });

    it("rounds to nearest integer", () => {
      expect(formatConfidence(30.4)).toBe("30%");
      expect(formatConfidence(30.6)).toBe("31%");
      expect(formatConfidence(99.9)).toBe("100%");
    });
  });

  describe("getConfidenceDecimal", () => {
    it("converts 0-100 to 0-1", () => {
      expect(getConfidenceDecimal(0)).toBe(0);
      expect(getConfidenceDecimal(30)).toBe(0.3);
      expect(getConfidenceDecimal(50)).toBe(0.5);
      expect(getConfidenceDecimal(100)).toBe(1);
    });

    it("handles null/undefined", () => {
      expect(getConfidenceDecimal(null)).toBe(null);
      expect(getConfidenceDecimal(undefined)).toBe(null);
    });

    it("returns null for out-of-range values", () => {
      expect(getConfidenceDecimal(-1)).toBe(null);
      expect(getConfidenceDecimal(101)).toBe(null);
      expect(getConfidenceDecimal(3000)).toBe(null);
    });

    it("returns null for non-numeric values", () => {
      expect(getConfidenceDecimal(NaN)).toBe(null);
    });
  });

  describe("regression: old scale bug (3000%)", () => {
    it("prevents 30 being multiplied by 100 again", () => {
      // Database stores confidence as 0-100
      const dbValue = 30;
      // Should format as "30%", not "3000%"
      expect(formatConfidence(dbValue)).toBe("30%");
      // Should not multiply by 100
      expect(formatConfidence(dbValue)).not.toBe("3000%");
    });

    it("catches 3000% out-of-range error", () => {
      // If someone accidentally multiplies 30 * 100 = 3000
      expect(formatConfidence(3000)).toBe("unavailable");
    });
  });
});
