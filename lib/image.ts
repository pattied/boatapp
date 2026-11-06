"use client";

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return img;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode photo"))), "image/jpeg", quality),
  );
}

function release(canvas: HTMLCanvasElement) {
  // iPhones cap total canvas memory; zeroing the size frees it right away.
  canvas.width = 0;
  canvas.height = 0;
}

// Shrinks a phone photo to 2048 px on the long edge. Re-encoding also drops location data.
export async function resizePhoto(file: Blob, maxEdge = 2048): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    let img: HTMLImageElement;
    try {
      img = await loadImage(url);
    } catch {
      throw new Error("This phone can't read that photo format. Try taking it with the camera button.");
    }
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out = await toJpeg(canvas, 0.85);
    if (out.size > 3_500_000) out = await toJpeg(canvas, 0.7);
    release(canvas);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const FONT = '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.font = `700 34px ${FONT}`;
  const w = ctx.measureText(text).width + 44;
  ctx.fillStyle = "rgba(15, 42, 68, 0.82)";
  roundRect(ctx, x, y, w, 60, 30);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 22, y + 31);
}

// Builds the 1080 x 1350 image customers post: before stacked over after, brand in the footer.
export async function composeShareImage(opts: {
  beforeSrc?: string;
  afterSrc?: string;
  businessName: string;
  instagramHandle: string;
}): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const FOOT = 110;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0F2A44";
  ctx.fillRect(0, 0, W, H);

  const panels: { src: string; text: string }[] = [];
  if (opts.beforeSrc) panels.push({ src: opts.beforeSrc, text: "BEFORE" });
  if (opts.afterSrc) panels.push({ src: opts.afterSrc, text: "AFTER" });
  if (!panels.length) throw new Error("Add at least one photo first.");

  const gap = panels.length > 1 ? 6 : 0;
  const ph = (H - FOOT - gap * (panels.length - 1)) / panels.length;
  for (let i = 0; i < panels.length; i++) {
    const img = await loadImage(panels[i].src);
    const y = i * (ph + gap);
    drawCover(ctx, img, 0, y, W, ph);
    label(ctx, panels[i].text, 28, y + 28);
  }
  if (gap) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, ph, W, gap);
  }

  ctx.fillStyle = "#0F2A44";
  ctx.fillRect(0, H - FOOT, W, FOOT);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(opts.businessName, 40, H - FOOT / 2);
  if (opts.instagramHandle) {
    ctx.font = `600 34px ${FONT}`;
    ctx.fillStyle = "#9FD0F5";
    const handle = `@${opts.instagramHandle}`;
    ctx.fillText(handle, W - 40 - ctx.measureText(handle).width, H - FOOT / 2);
  }

  const out = await toJpeg(canvas, 0.88);
  release(canvas);
  return out;
}
