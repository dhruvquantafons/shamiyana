"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

/**
 * E-signature capture for the registration card. Draws with pointer events
 * (mouse, pen or finger on a tablet) and writes a PNG data URL into a hidden
 * input, which the check-in action stores in the private documents bucket.
 */
export default function SignaturePad({ name }: { name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [value, setValue] = useState("");

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    // Match the backing store to the displayed size for a crisp line.
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1c1b1a";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext("2d")!;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setValue(canvas.current?.toDataURL("image/png") ?? "");
  };

  const clear = () => {
    const c = canvas.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setValue("");
  };

  return (
    <div>
      <div className="relative rounded-lg border-2 border-dashed border-yellow-300 bg-white">
        <canvas
          ref={canvas}
          aria-label="Signature area: sign with a finger, pen or mouse"
          className="w-full h-40 touch-none cursor-crosshair rounded-lg"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {!value && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            Guest signs here
          </span>
        )}
      </div>
      <div className="flex justify-between items-center mt-1.5">
        <span className="text-[11px] text-slate-500">{value ? "Signature captured." : "Required."}</span>
        <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-rose-700 cursor-pointer">
          <Eraser className="w-3.5 h-3.5" /> Clear
        </button>
      </div>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
