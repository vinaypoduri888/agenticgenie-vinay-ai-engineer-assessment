"use client";

import { useEffect, useRef } from "react";

interface Seat {
  x: number;
  y: number;
  depth: number;
  ring: number;
  angle: number;
  phase: number;
  rate: number;
  hot: boolean;
}

const WHITE = "#ffffff";
const CORAL = "#ff6a5e";
const AMBER = "#ffae6b";
const FRAME_MS = 1000 / 30;
const AISLES = 9;

function buildSeats(width: number, height: number) {
  const wide = width >= 900;
  const scale = Math.min(1.3, Math.max(0.62, width / 1400));
  const cx = wide ? width * 0.73 : width * 0.5;
  const cy = wide ? height * 0.54 : height * 0.74;
  const tilt = 0.56;
  const rows = wide ? 22 : 16;
  const gap = 16 * scale;
  const inner = 86 * scale;
  const outer = inner + rows * gap;
  const seats: Seat[] = [];

  for (let row = 0; row < rows; row++) {
    const radius = inner + row * gap;
    const count = Math.floor((Math.PI * 2 * radius) / (13 * scale));
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      // Aisles split each ring into blocks, which is what makes it read as a venue.
      const sector = ((angle / (Math.PI * 2)) * AISLES) % 1;
      if (sector < 0.035 || sector > 0.965) continue;
      const y = cy + Math.sin(angle) * radius * tilt;
      seats.push({
        x: cx + Math.cos(angle) * radius,
        y,
        depth: Math.min(1, Math.max(0, (y - (cy - outer * tilt)) / (outer * tilt * 2))),
        ring: row,
        angle,
        phase: Math.random() * Math.PI * 2,
        rate: 0.5 + Math.random() * 1.1,
        hot: Math.random() < 0.11,
      });
    }
  }
  return { seats, cx, cy, inner, tilt };
}

/**
 * A venue seen from above: seats twinkle like tickets selling, a slow wave rolls
 * out from the stage, and seats near the pointer light up. Decorative, so it's
 * drawn to a canvas behind the hero, pauses off screen and holds still for
 * people who prefer reduced motion.
 */
export function SeatField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const stillMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let layout = buildSeats(1, 1);
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let visible = true;
    const pointer = { x: -9999, y: -9999 };

    function draw(time: number) {
      const t = time / 1000;
      context!.clearRect(0, 0, width, height);

      const { cx, cy, inner, tilt } = layout;
      const glow = context!.createRadialGradient(cx, cy, 0, cx, cy, inner * 2.1);
      glow.addColorStop(0, "rgba(255, 106, 94, 0.3)");
      glow.addColorStop(1, "rgba(255, 106, 94, 0)");
      context!.globalAlpha = 1;
      context!.fillStyle = glow;
      context!.fillRect(cx - inner * 2.2, cy - inner * 2.2, inner * 4.4, inner * 4.4);
      context!.beginPath();
      context!.ellipse(cx, cy, inner * 0.56, inner * 0.56 * tilt, 0, 0, Math.PI * 2);
      context!.strokeStyle = "rgba(255, 174, 107, 0.6)";
      context!.lineWidth = 1;
      context!.stroke();

      for (const seat of layout.seats) {
        const crest = Math.pow(Math.max(0, Math.sin(seat.ring * 0.5 - t * 0.9 + seat.angle)), 8);
        const twinkle = seat.hot ? Math.pow((Math.sin(t * seat.rate + seat.phase) + 1) / 2, 3) : 0;
        const dx = seat.x - pointer.x;
        const dy = seat.y - pointer.y;
        const near = Math.max(0, 1 - Math.hypot(dx, dy) / 150);
        const lit = twinkle + near;
        const size = (1.5 + seat.depth * 1.5) * (1 + crest * 0.35 + near * 0.7);

        context!.fillStyle = lit > 0.2 ? CORAL : crest > 0.25 ? AMBER : WHITE;
        context!.globalAlpha = Math.min(1, 0.07 + seat.depth * 0.13 + crest * 0.5 + lit * 0.85);
        context!.fillRect(seat.x - size / 2, seat.y - size / 2, size, size);
      }
      context!.globalAlpha = 1;
    }

    function loop(time: number) {
      frame = requestAnimationFrame(loop);
      if (!visible || time - last < FRAME_MS) return;
      last = time;
      draw(time);
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.round(width * ratio);
      canvas!.height = Math.round(height * ratio);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      layout = buildSeats(width, height);
      if (stillMotion) draw(4000);
    }

    function onPointerMove(event: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
    }

    const resizer = new ResizeObserver(resize);
    resizer.observe(canvas);
    const viewport = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    viewport.observe(canvas);
    resize();

    if (!stillMotion) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      resizer.disconnect();
      viewport.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />;
}
