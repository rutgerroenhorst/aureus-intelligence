"use client";

import React, { ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ""}]`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error!);
      }

      return (
        <div style={{
          padding: "20px",
          background: "#1a1a1f",
          border: "2px solid #ff3b30",
          borderRadius: "8px",
          color: "#ff3b30",
          fontSize: "12px",
          fontFamily: "monospace"
        }}>
          <strong>⚠️ Component Error</strong>
          <div style={{ marginTop: "8px", opacity: 0.7 }}>
            {this.state.error?.message || "Unknown error"}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
