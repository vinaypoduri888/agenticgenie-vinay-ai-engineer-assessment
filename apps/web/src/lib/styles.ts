import type { CSSProperties } from "react";

export const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  padding: 8,
  marginTop: 4,
  boxSizing: "border-box",
};

export const buttonStyle: CSSProperties = {
  background: "#111",
  color: "#fff",
  border: "none",
  padding: "10px 16px",
  borderRadius: 4,
  cursor: "pointer",
};

export const secondaryButtonStyle: CSSProperties = {
  background: "#fff",
  color: "#111",
  border: "1px solid #ccc",
  padding: "8px 14px",
  borderRadius: 4,
  cursor: "pointer",
};

export const cardStyle: CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
  background: "#fff",
};

export const errorStyle: CSSProperties = { color: "#b00020" };
export const mutedStyle: CSSProperties = { color: "#666", fontSize: 13 };
