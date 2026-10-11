/**
 * Track E2a: the Completed 100% card as a 1920×1080 PNG (Save image / Copy image), drawn with the session replay
 * card's helpers and size so both share one look and one upload path. Only real numbers; missing ones are left out.
 */
import { CARD_H, CARD_W } from '../../lib/replay';
import type { CeremonyFacts } from '../../lib/ceremony';
import { coverFit, truncate } from '../replay/drawReplay';

export interface CompletionImages {
  cover: ImageBitmap | null;
  backdrop: ImageBitmap | null;
}

export interface CompletionTheme {
  accent: string;
  fontDisplay: string;
  fontUi: string;
  /** Hue for the generated cover when the game has no art. */
  hue: number;
}

const GOLD = '#f2c95c';
const GOLD_DEEP = '#b8862b';

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function drawCompletion(ctx: CanvasRenderingContext2D, title: string, facts: CeremonyFacts, images: CompletionImages, theme: CompletionTheme, completedOn: Date) {
  const canvas = ctx.canvas;
  ctx.save();
  ctx.setTransform(canvas.width / CARD_W, 0, 0, canvas.height / CARD_H, 0, 0);

  // ---- backdrop: the game's art, blurred, under a dark scrim and a golden glow ----
  ctx.fillStyle = '#07070c';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const art = images.backdrop ?? images.cover;
  if (art) {
    ctx.save();
    ctx.filter = 'blur(28px) saturate(1.2)';
    ctx.globalAlpha = 0.55;
    coverFit(ctx, art, CARD_W, CARD_H, 1.15);
    ctx.restore();
  }
  const scrim = ctx.createLinearGradient(0, 0, CARD_W, 0);
  scrim.addColorStop(0, 'rgba(5,5,10,0.55)');
  scrim.addColorStop(0.55, 'rgba(5,5,10,0.78)');
  scrim.addColorStop(1, 'rgba(5,5,10,0.9)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = ctx.createRadialGradient(560, 520, 40, 560, 520, 760);
  glow.addColorStop(0, 'rgba(242,201,92,0.34)');
  glow.addColorStop(1, 'rgba(242,201,92,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // ---- the cover, framed in gold ----
  const cw = 440;
  const ch = 660;
  const cx = 340;
  const cy = (CARD_H - ch) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(242,201,92,0.45)';
  ctx.shadowBlur = 80;
  round(ctx, cx - 6, cy - 6, cw + 12, ch + 12, 30);
  const frame = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
  frame.addColorStop(0, GOLD);
  frame.addColorStop(0.5, '#fff1c2');
  frame.addColorStop(1, GOLD_DEEP);
  ctx.fillStyle = frame;
  ctx.fill();
  ctx.restore();
  ctx.save();
  round(ctx, cx, cy, cw, ch, 24);
  ctx.clip();
  if (images.cover) {
    ctx.save();
    ctx.translate(cx, cy);
    coverFit(ctx, images.cover, cw, ch, 1);
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
    g.addColorStop(0, `hsl(${theme.hue} 60% 42%)`);
    g.addColorStop(1, `hsl(${(theme.hue + 40) % 360} 65% 14%)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `600 64px ${theme.fontDisplay}`;
    ctx.textAlign = 'center';
    const initials = title.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
    ctx.fillText(initials, cx + cw / 2, cy + ch * 0.78);
    ctx.textAlign = 'left';
  }
  // The sweep's last frame: a soft diagonal sheen.
  const sheen = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
  sheen.addColorStop(0.35, 'rgba(255,240,200,0)');
  sheen.addColorStop(0.5, 'rgba(255,240,200,0.22)');
  sheen.addColorStop(0.62, 'rgba(255,240,200,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(cx, cy, cw, ch);
  ctx.restore();

  // ---- the words ----
  const tx = 900;
  const maxW = CARD_W - tx - 140;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = GOLD;
  ctx.font = `700 30px ${theme.fontUi}`;
  ctx.letterSpacing = '6px';
  ctx.fillText('COMPLETED 100%', tx, 330);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = '#ffffff';
  // Long titles step down a size before anything is cut.
  let size = 88;
  ctx.font = `600 ${size}px ${theme.fontDisplay}`;
  if (ctx.measureText(title).width > maxW * 1.85) {
    size = 68;
    ctx.font = `600 ${size}px ${theme.fontDisplay}`;
  }
  const lead = Math.round(size * 1.14);
  const lines = wrap(ctx, title, maxW, 2);
  lines.forEach((l, i) => ctx.fillText(l, tx, 440 + i * lead));
  let y = 440 + lines.length * lead + 40;

  const stats: { value: string; label: string }[] = [];
  if (facts.hours) stats.push({ value: facts.hours, label: 'played' });
  if (facts.span && facts.since) stats.push({ value: facts.span, label: facts.since.kind === 'firstSession' ? 'since your first session' : 'in your library' });
  let sx = tx;
  for (const s of stats) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 52px ${theme.fontDisplay}`;
    const vw = ctx.measureText(s.value).width;
    ctx.fillText(s.value, sx, y + 40);
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.font = `500 26px ${theme.fontUi}`;
    const lw = ctx.measureText(s.label).width;
    ctx.fillText(s.label, sx, y + 84);
    sx += Math.max(vw, lw) + 90;
  }
  if (stats.length) y += 150;

  if (facts.achievements) {
    const r = 60;
    const rx = tx + r;
    const ry = y + r;
    ctx.lineWidth = 11;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(rx, ry, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = GOLD;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(rx, ry, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, facts.achievements.ratio));
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 24px ${theme.fontDisplay}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(facts.achievements.ratio * 100)}%`, rx, ry + 9);
    ctx.textAlign = 'left';
    ctx.font = `600 40px ${theme.fontDisplay}`;
    ctx.fillText(`${facts.achievements.unlocked} of ${facts.achievements.total}`, tx + r * 2 + 36, ry - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.font = `500 26px ${theme.fontUi}`;
    ctx.fillText('Steam achievements', tx + r * 2 + 36, ry + 36);
  }

  // ---- footer ----
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `500 24px ${theme.fontUi}`;
  ctx.fillText(completedOn.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }), tx, CARD_H - 64);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `600 24px ${theme.fontDisplay}`;
  ctx.letterSpacing = '7px';
  ctx.textAlign = 'right';
  ctx.fillText('VYSTRAL', CARD_W - 120, CARD_H - 64);
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';
  ctx.restore();
}

/** Up to `max` lines; the last one ends with "…" when the title is longer. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxW || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === max - 1) {
      line = words.slice(i).join(' ');
      break;
    }
  }
  if (line) lines.push(lines.length === max - 1 ? truncate(ctx, line, maxW) : line);
  return lines.slice(0, max).map((l) => truncate(ctx, l, maxW));
}
