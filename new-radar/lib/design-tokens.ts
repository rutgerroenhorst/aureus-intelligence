/**
 * Global design token system for Aureus Intelligence.
 * Use these throughout the application instead of hardcoded colors.
 */

export const tokens = {
  // Background
  bg: {
    app: "#0b0a08",
    sidebar: "#100e0b",
    surface: "#17140f",
    surfaceRaised: "#1d1a14",
    hover: "#2a2620",
    selected: "rgba(91, 158, 255, 0.1)",
  },

  // Text
  text: {
    primary: "#ece7dd",
    secondary: "#8f887b",
    muted: "#6b6459",
    disabled: "#4a4238",
  },

  // Borders
  border: {
    subtle: "#2a2620",
    default: "#2a2620",
    focus: "#5b9eff",
  },

  // Accent colors
  accent: {
    blue: "#5b9eff",
    cyan: "#4fc3f7",
    violet: "#9966ff",
  },

  // Semantic colors
  semantic: {
    positive: "#4cbb88", // emerald
    warning: "#ffa500", // amber
    danger: "#ff6b6b", // coral
    info: "#5b9eff", // blue
    unknown: "#8f887b", // muted
  },

  // Special
  special: {
    gold: "#c8a24c",
  },
};

// CSS variable registration
export const getCSSVariables = () => {
  const vars: Record<string, string> = {};

  // Register all tokens as CSS variables
  Object.entries(tokens).forEach(([category, colors]) => {
    Object.entries(colors).forEach(([key, value]) => {
      vars[`--${category}-${key}`] = value;
    });
  });

  return vars;
};

// Convenience exports
export const colors = {
  bgApp: tokens.bg.app,
  bgSidebar: tokens.bg.sidebar,
  bgSurface: tokens.bg.surface,
  textPrimary: tokens.text.primary,
  textMuted: tokens.text.muted,
  accentBlue: tokens.accent.blue,
  semanticPositive: tokens.semantic.positive,
  semanticWarning: tokens.semantic.warning,
  semanticDanger: tokens.semantic.danger,
};
