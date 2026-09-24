import { ImageResponse } from "next/og";
import { SITE } from "./lib/site";

export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#141312",
          color: "#e6d7c3",
          fontFamily: "Georgia, serif",
          padding: 72,
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            border: "2px solid #a88956",
            borderRadius: 24,
            padding: "56px 72px",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 26, letterSpacing: 14, color: "#a88956" }}>
            SRINAGAR • KASHMIR
          </div>
          <div style={{ fontSize: 82, fontWeight: 700, letterSpacing: 10, marginTop: 24 }}>
            SHAMIYANA
          </div>
          <div style={{ fontSize: 30, color: "#cfc7ba", marginTop: 20, maxWidth: 820 }}>
            On the bank of the Jhelum River, 1.5 km from Dal Lake
          </div>
        </div>
      </div>
    ),
    size,
  );
}
