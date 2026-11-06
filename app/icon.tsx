import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0F2A44",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "62%",
            height: "62%",
            borderRadius: 64,
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, background: "#8A9BAD" }} />
          <div style={{ height: "6%", background: "#ffffff" }} />
          <div style={{ flex: 1, background: "#2B7BD6" }} />
        </div>
      </div>
    ),
    size,
  );
}
