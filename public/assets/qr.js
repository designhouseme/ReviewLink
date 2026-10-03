/**
 * Kod QR z linkiem do strony oceny: podgląd w panelu i trzy formaty do pobrania.
 * PNG (1200 px), SVG (wektor do druku) i karta A6 w 300 dpi z nazwą firmy,
 * gwiazdkami i kodem - do położenia na fakturze, wizytówce albo na aucie.
 *
 * Kod zawiera stały adres linku, więc wydrukowany działa po każdej edycji
 * danych firmy. Zmiana domeny wymaga za to przekierowania ze starego adresu.
 */

import qrcode from "./vendor/qrcode.mjs";

const INK = "#1c1b1a";
const ORANGE = "#ff6a2b";
const STAR = "M12 3.4l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 16.92l-5.3 2.79 1.01-5.9-4.29-4.18 5.93-.86z";
const DH = [
  [73.18, 0, 31.73],
  [0, 31.82, 73.39],
  [104.8, 31.81, 45.5],
];

function makeQr(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr;
}

/** Ścieżka SVG z ciemnych modułów; sąsiednie moduły w wierszu łączone w jeden prostokąt. */
function qrPath(qr, margin) {
  const n = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!qr.isDark(row, col)) continue;
      let run = 1;
      while (col + run < n && qr.isDark(row, col + run)) run++;
      d += `M${col + margin} ${row + margin}h${run}v1h-${run}z`;
      col += run - 1;
    }
  }
  return d;
}

export function qrSvg(text, margin = 4) {
  const qr = makeQr(text);
  const size = qr.getModuleCount() + margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><path d="${qrPath(qr, margin)}" fill="${INK}"/></svg>`;
}

/** Rysuje kod na canvasie w kwadracie (x, y, side), z pełnymi pikselami na moduł. */
function drawQr(ctx, text, x, y, side, margin = 0) {
  const qr = makeQr(text);
  const n = qr.getModuleCount();
  const cell = Math.floor(side / (n + margin * 2));
  const offset = Math.floor((side - cell * n) / 2);
  ctx.fillStyle = INK;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(row, col)) ctx.fillRect(x + offset + col * cell, y + offset + row * cell, cell, cell);
    }
  }
}

export async function qrPng(text) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1200;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1200, 1200);
  drawQr(ctx, text, 0, 0, 1200, 4);
  return toBlob(canvas);
}

/** Karta A6 (105 x 148 mm, 300 dpi). */
export async function qrCard({ url, name }) {
  await Promise.all(["300 100px Urbanist", "400 100px Urbanist", "600 100px Urbanist"].map((font) => document.fonts.load(font)));

  const W = 1240;
  const H = 1748;
  const P = 110;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f1f0ee";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1100);
  glow.addColorStop(0, "rgba(248, 221, 204, 1)");
  glow.addColorStop(1, "rgba(248, 221, 204, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Firma: kółko z inicjałem i nazwa
  const initial = String(name).match(/[\p{L}\p{N}]/u)?.[0].toUpperCase() ?? "·";
  ctx.fillStyle = "#222120";
  ctx.beginPath();
  ctx.arc(P + 46, P + 46, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 40px Urbanist";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initial, P + 46, P + 48);
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = "600 44px Urbanist";
  ctx.fillText(fit(ctx, name, W - P * 2 - 120), P + 120, P + 48);

  // Tytuł
  ctx.textBaseline = "alphabetic";
  ctx.font = "400 112px Urbanist";
  ctx.fillText("Jak oceniasz", P, 400);
  ctx.fillText("naszą pracę?", P, 520);

  // Gwiazdki
  const tile = 132;
  const gap = (W - P * 2 - tile * 5) / 4;
  const star = new Path2D(STAR);
  for (let i = 0; i < 5; i++) {
    const x = P + i * (tile + gap);
    ctx.fillStyle = ORANGE;
    roundRect(ctx, x, 600, tile, tile, 36);
    ctx.fill();
    ctx.save();
    ctx.translate(x + tile / 2 - 33, 600 + tile / 2 - 33);
    ctx.scale(2.75, 2.75);
    ctx.fillStyle = "#ffffff";
    ctx.fill(star);
    ctx.restore();
  }

  // Kod w białej karcie
  const box = 700;
  const bx = (W - box) / 2;
  const by = 770;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, bx, by, box, box, 56);
  ctx.fill();
  ctx.strokeStyle = "#e8e5e1";
  ctx.lineWidth = 3;
  ctx.stroke();
  drawQr(ctx, url, bx + 60, by + 60, box - 120);

  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = "500 46px Urbanist";
  ctx.fillText("Zeskanuj aparatem w telefonie", W / 2, by + box + 84);
  ctx.fillStyle = "#6c6863";
  ctx.font = "400 34px Urbanist";
  ctx.fillText(fit(ctx, url.replace(/^https?:\/\//, ""), W - P * 2), W / 2, by + box + 136);

  // Stopka: znak Design House
  ctx.fillStyle = "#a29d97";
  ctx.font = "600 26px Urbanist";
  const label = "Design House · Link do opinii";
  const markW = 40;
  const total = markW + 14 + ctx.measureText(label).width;
  const fx = (W - total) / 2;
  const fy = H - 58;
  ctx.save();
  ctx.translate(fx, fy - 26);
  ctx.scale(markW / 151, markW / 151);
  for (const [x, y, s] of DH) {
    roundRect(ctx, x, y, s, s, 5.88);
    ctx.fill();
  }
  ctx.restore();
  ctx.textAlign = "left";
  ctx.fillText(label, fx + markW + 14, fy);

  return toBlob(canvas);
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(text) {
  return (
    String(text)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "firma"
  );
}

function toBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Skraca tekst z wielokropkiem, żeby zmieścił się w szerokości. */
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}
