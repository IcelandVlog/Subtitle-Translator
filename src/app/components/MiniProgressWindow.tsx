"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

type IconProps = { size?: number };

/** Picture-in-picture icon (outlined window with a filled corner). */
export const PipIcon = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="20" height="18" rx="2" />
    <rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

/** "Back to the tab" icon, used inside the mini window. */
const ReturnIcon = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M10 14 L5 9" />
    <path d="M5 13 V9 H9" />
  </svg>
);

/**
 * Opens a small window for translation progress. Uses Document Picture-in-Picture when
 * available (stays on top), else a plain popup. Call it from a click handler.
 */
export const openMiniWindow = async (): Promise<Window | null> => {
  const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture;
  let win: Window | null = null;
  try {
    if (dpip?.requestWindow) win = await dpip.requestWindow({ width: 340, height: 170 });
  } catch {
    win = null;
  }
  if (!win) win = window.open("", "subtitle-translation-progress", "popup=yes,width=340,height=170");
  if (win) {
    win.document.title = "Translation progress";
    win.document.body.style.margin = "0";
    // 小窗口标题栏的图标:用站点自己的 icon.png(新窗口默认没有图标)。
    const icon = win.document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/png";
    icon.href = `${window.location.origin}/icon.png`;
    win.document.head.appendChild(icon);
  }
  return win;
};

const buttonStyle: React.CSSProperties = {
  flex: 1,
  padding: "6px 0",
  borderRadius: 6,
  border: "1px solid #444",
  background: "#222",
  color: "#eee",
  cursor: "pointer",
  fontSize: 12,
};

type Props = {
  win: Window;
  percent: number;
  current: number;
  total: number;
  running: boolean;
  /** e.g. "File 3/16 · Language 2/5 · fil-tl" */
  info?: string;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onClose: () => void;
};

const MiniProgressWindow = ({ win, percent, current, total, running, info, onPause, onResume, onCancel, onClose }: Props) => {
  // Closing the window (by the user, or by us) clears the state.
  useEffect(() => {
    const handle = () => onClose();
    win.addEventListener("pagehide", handle);
    return () => win.removeEventListener("pagehide", handle);
  }, [win, onClose]);

  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const finished = !running && pct >= 100;
  const paused = !running && !finished && pct > 0;
  const label = running ? "Translating…" : finished ? "Finished" : paused ? "Paused" : "Ready";

  return createPortal(
    <div
      style={{
        height: "100vh",
        boxSizing: "border-box",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#141414",
        color: "#eee",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
        <strong>{label}</strong>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {current} / {total}
          </span>
          <button
            type="button"
            title="Back to the main page"
            aria-label="Back to the main page"
            onClick={() => window.focus()}
            style={{ background: "transparent", border: "none", color: "#eee", cursor: "pointer", padding: 2, display: "flex" }}>
            <ReturnIcon />
          </button>
        </span>
      </div>
      <div style={{ height: 8, background: "#333", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#52c41a", transition: "width 0.3s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, opacity: 0.85 }}>
        <span>{pct}%</span>
        {info && <span style={{ textAlign: "right" }}>{info}</span>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
        {running && onPause && (
          <button type="button" onClick={onPause} style={buttonStyle}>
            Pause
          </button>
        )}
        {paused && onResume && (
          <button type="button" onClick={onResume} style={buttonStyle}>
            Continue
          </button>
        )}
        {running && onCancel && (
          <button type="button" onClick={onCancel} style={buttonStyle}>
            Cancel
          </button>
        )}
      </div>
    </div>,
    win.document.body,
  );
};

export default MiniProgressWindow;
