import { useEffect, useMemo, useRef } from 'react';
import { cssOklch, fallbackPalette, labToLch, lchToLab, mixLch, parseOklch, type LCh } from '../../lib/color';
import { MOOD_INDEX, moodFor, moodSpeed, type Mood } from '../../lib/mood';
import { paletteFor } from '../../lib/palette';
import { clampAccent, FOLLOW, followRgb, initialFollow, labDistance, stepFollow, useHeroTrailer, type FollowState } from '../../lib/trailer/tint';
import {
  approach, approachPalette, AUDIO_TAU, canvasProfile, daylight, frameInterval, labPaletteToRgb, moodFlavor, PALETTE_TAU, paletteGap, POINTER_TAU, toLabPalette, type Daylight, type LabPalette,
} from '../../lib/canvasLife';
import { ambientLoudness } from '../../lib/sound';
import { useCoverGame } from '../../state/accentTheme';
import { useGameRunning, useReducedMotion, useStore } from '../../state/store';

/**
 * The Living Canvas: an ambient, palette-driven background rendered with one small WebGL2
 * shader at reduced resolution (≤30 fps). It reacts to the focused game, pauses whenever the
 * window is hidden or a game is running, renders a single still frame under reduced motion,
 * and falls back to a static CSS gradient when WebGL is unavailable or quality is "low".
 *
 * While a hero trailer is visibly playing, a third palette layer (uL, weighted by uLive) eases
 * toward the trailer's colours (lib/trailer/tint.ts) and back to the artwork when it stops.
 *
 * Track E2b: palettes glide in OKLab (no muddy midpoints) and the picture has depth: far light pools, the flowing
 * base and the mood's particles move at different rates with the pointer (parallax). Particles are refined per
 * genre within each mood, the light warms in the evening and dims late at night, and it can breathe gently with
 * VYSTRAL's own ambient sound (opt-in). What it may do is decided in lib/canvasLife.ts (quality, reduced motion,
 * Performance Mode, Data saver, focus); it slows to 15 fps while another window is in front.
 */

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

const FRAG = `#version 300 es
precision mediump float;
uniform float uT, uMix, uMoodA, uMoodB, uFlavA, uFlavB, uIntensity, uSpeed, uLayers, uWarm, uDim, uPulse, uLive;
uniform vec2 uRes, uPtr;
uniform vec3 uA[4], uL[4];
out vec4 o;

float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Per-trail constants for velocity (were two hashes per trail per pixel).
const float TRAIL_PHASE[5] = float[5](.5974, .3227, .7581, .5091, .0561);
const float TRAIL_WIDTH[5] = float[5](.2335, .4381, .5012, .1685, .5578);
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f*=f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+1.),f.x), f.y); }

// A particle field with no state: at most one soft dot per grid cell, kept when the cell's dice say so.
float motes(vec2 g, float density, float size, out float r){
  vec2 id = floor(g), f = fract(g) - .5;
  r = h(id);
  vec2 c = (vec2(h(id + 3.1), h(id + 5.7)) - .5) * .6;
  return smoothstep(size, 0., length(f - c)) * step(1. - density, r);
}

// Mood overlays (the near layer). fl: per-genre flavour 0..1 (lib/canvasLife.ts moodFlavor).
vec3 mood(float m, float fl, vec2 uv, float t, float asp){
  vec2 ua = vec2(uv.x * asp, uv.y);
  float r;
  if (m < .5) {                                           // drift: a few large, very soft discs floating up
    float s = motes(ua * 3.2 + vec2(0., -t * .05), .35, .42, r);
    return vec3(.8, .85, 1.) * s * .12 * (.6 + .4 * sin(t * .4 + r * 20.));
  }
  if (m < 1.5) {                                          // velocity: light trails (sports: level flares)
    vec3 c = vec3(0.);
    for (int i = 0; i < 5; i++) { float fi = float(i);
      float y = fract(.17 * fi + .11);
      float x = fract(uv.x * .6 - t * (.12 + .05 * fi) + TRAIL_PHASE[i]);
      float w = mix(.006, .004, fl) * (.8 + .5 * TRAIL_WIDTH[i]);
      c += smoothstep(w, 0., abs(uv.y - y - (uv.x - .5) * mix(.18, .02, fl))) * smoothstep(0., .6, x) * smoothstep(1., .75, x) * .5;
    } return c;
  }
  if (m < 2.5) {                                          // cosmos: twinkling stars in depth (cyberpunk: cyan)
    vec3 c = vec3(0.), tint = mix(vec3(1.), vec3(.62, .95, 1.), fl);
    for (int l = 0; l < 3; l++) { float fd = float(l); if (fd >= uLayers) break;
      float s = motes(ua * (40. + fd * 35.) + vec2(t * (.4 + fd * .3), 0.), .07, .06, r);
      c += tint * s * (.5 + .35 * sin(t * (2. + r * 3.) + r * 40.)) * (1. - fd * .25);
    } return c;
  }
  if (m < 3.5) {                                          // ember: rising, swaying motes (dark fantasy: grey ash)
    vec2 g = ua * 18.;
    g.y -= t * mix(1.2, .55, fl);
    g.x += sin(g.y * .7 + t * .8) * .35;
    float s = motes(g, mix(.14, .1, fl), .12, r);
    return mix(vec3(1., .62, .32), vec3(.64, .62, .62), fl) * s * (.5 + .5 * sin(t * 2. + r * 30.)) * smoothstep(0., .6, 1. - uv.y);
  }
  if (m < 4.5) {                                          // dread: low fog (survival: thicker), slow dust
    vec2 p = uv * vec2(3., 5.) + vec2(t * .05, 0.);
    float f = .5 * n(p) + .25 * n(p * 2.03);
    if (uLayers > 2.5) f += .125 * n(p * 4.1);
    float fog = smoothstep(mix(.45, .36, fl), .9, f * mix(1.1667, 1., step(2.5, uLayers))) * smoothstep(.75, 0., uv.y) * .5;
    float dust = motes(ua * 26. + vec2(t * .15, -t * .08), .05, .08, r) * .3;
    return vec3(.6, .62, .7) * (fog + dust);
  }
  float w = sin(uv.y * 28. + sin(uv.x * 6. + t * .6) * 1.4 - t * .5);   // tide: calm bands, caustic shimmer
  float k = sin(ua.x * 22. + t * .7 + sin(uv.y * 17. - t * .5)) * sin(uv.y * 19. - t * .6 + sin(ua.x * 13. + t * .3));
  return mix(vec3(.7, .85, 1.), vec3(1., .86, .78), fl) * (smoothstep(.96, 1., w) * .25 + smoothstep(.8, 1., k) * .07);
}

void main(){
  vec2 uv0 = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  float t = uT * uSpeed;
  // Depth: the far light pools move least with the pointer, the base a little more, the mood particles most.
  vec2 ptr = uPtr * vec2(1., -1.);
  vec2 uvFar = uv0 - ptr * .012, uv = uv0 - ptr * .024, uvNear = uv0 - ptr * .05;
  vec2 q = uv + .35 * vec2(n(uv * 2. + t * .03), n(uv * 2. - t * .03 + 5.2));
  float a = n(q * 1.7 + t * .03), b = n(q * 2.3 - t * .021);
  vec3 c0 = mix(uA[0], uL[0], uLive), c1 = mix(uA[1], uL[1], uLive), c2 = mix(uA[2], uL[2], uLive), c3 = mix(uA[3], uL[3], uLive);
  vec3 col = mix(mix(c0, c1, a), mix(c2, c3, b), smoothstep(.2, .8, q.y));
  vec2 d1 = (uvFar - vec2(.26 + .1 * sin(t * .031), .7 + .08 * cos(t * .027))) * vec2(asp, 1.);
  vec2 d2 = (uvFar - vec2(.8 + .08 * cos(t * .023), .28 + .1 * sin(t * .037))) * vec2(asp, 1.);
  col += (c3 * exp(-dot(d1, d1) * 3.2) * .22 + c2 * exp(-dot(d2, d2) * 4.) * .18) * uIntensity;
  float glow = smoothstep(1.25, .15, length(uv - vec2(.62, .78)));
  col *= .5 + .75 * glow * uIntensity * (1. + .18 * uPulse);
  // Only one mood is drawn once a crossfade has finished.
  vec3 m = uMix > .999 ? mood(uMoodB, uFlavB, uvNear, t, asp)
         : uMix < .001 ? mood(uMoodA, uFlavA, uvNear, t, asp)
         : mix(mood(uMoodA, uFlavA, uvNear, t, asp), mood(uMoodB, uFlavB, uvNear, t, asp), uMix);
  col += m * mix(c3, vec3(1.), .5) * uIntensity * (1. + .5 * uPulse);
  float darken = mix(step(3.5, uMoodA) * step(uMoodA, 4.5), step(3.5, uMoodB) * step(uMoodB, 4.5), uMix);
  col *= 1. - .35 * darken;
  col *= (1. + uWarm * vec3(.07, .015, -.07)) * uDim;                    // time of day
  col *= smoothstep(1.35, .35, length((uv0 - .5) * vec2(1.2, 1.)));     // vignette, fixed to the window
  col += (h(gl_FragCoord.xy + uT) - .5) / 255.;                          // dither: no banding on dark gradients
  o = vec4(max(col, 0.), 1.);
}`;

interface CanvasState {
  /** Palette on screen and the one it glides toward, in OKLab. */
  cur: LabPalette;
  target: LabPalette;
  moodA: Mood;
  moodB: Mood;
  flavA: number;
  flavB: number;
  mixStart: number;
  /** Artwork accent of the focused game (restored when trailer-following ends). */
  accentCss: string | null;
}

/** How often (at most) trailer-following may nudge the page accent, and by how much at least. */
const ACCENT_EVERY_MS = 2600;
const ACCENT_MIN_SHIFT = 0.03;
/** Share of the trailer's accent blended into the game's artwork accent at full follow. */
const ACCENT_FOLLOW = 0.5;
/** OKLab gap below which a palette glide simply lands (well under one 8-bit step on these dark colours). */
const SETTLED = 0.0015;
/** Mood crossfade length (ms). */
const MOOD_MS = 1600;

/** Smootherstep: no visible start or end to a crossfade. */
const easeMix = (x: number) => x * x * x * (x * (6 * x - 15) + 10);

function initialState(): CanvasState {
  const p = toLabPalette(fallbackPalette().ambient);
  return { cur: p, target: p, moodA: 'drift', moodB: 'drift', flavA: 0, flavB: 0, mixStart: 0, accentCss: null };
}

export function LivingCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const settings = useStore((s) => s.settings);
  const focusId = useStore((s) => s.focusGameId);
  const game = useStore((s) => (focusId ? s.gamesById.get(focusId) : undefined));
  const running = useGameRunning();
  const reduce = useReducedMotion();
  const safeMode = useStore((s) => s.info?.safeMode ?? false);
  const coverGame = useCoverGame(); // Track E2b: "Use a game's colours" (or its live preview) holds the accent
  const state = useRef<CanvasState>(initialState());
  const requestFrame = useRef<() => void>(() => {});

  const profile = useMemo(
    () =>
      canvasProfile({
        livingCanvas: !!settings?.['appearance.livingCanvas'],
        quality: settings?.['appearance.quality'],
        cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
        safeMode,
        reduced: reduce,
        gameRunning: running,
        dataSaver: !!settings?.['dataSaver.enabled'],
        parallax: settings?.['canvas.parallax'] !== false,
        audioReact: !!settings?.['canvas.audioReact'],
      }),
    [settings, safeMode, reduce, running],
  );
  const { enabled, quality, animate, layers, scale, parallax } = profile;
  const intensity = settings?.['appearance.canvasIntensity'] ?? 0.7;
  const setAccent = settings?.['appearance.accent'];
  const fixedAccent = coverGame ? 'cover' : setAccent && setAccent !== 'auto' && setAccent !== 'cover' ? setAccent : null;
  const followTrailer = settings?.['canvas.followTrailer'] !== false;
  const live = useRef({ fixedAccent, focusId, follow: followTrailer, intensity, profile });
  live.current = { fixedAccent, focusId, follow: followTrailer, intensity, profile };
  // Intensity is a uniform: a slider drag only redraws, it never rebuilds the GL program.
  useEffect(() => requestFrame.current(), [intensity]);

  // Palette + mood follow the focused game, debounced so fast browsing doesn't thrash.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const palette = game ? await paletteFor(game) : fallbackPalette();
      if (cancelled) return;
      const root = document.documentElement.style;
      const s = state.current;
      if (!fixedAccent) {
        root.setProperty('--game', palette.accent);
        root.setProperty('--game-2', palette.accent2);
        s.accentCss = palette.accent;
      } else s.accentCss = null;
      const now = performance.now();
      // The palette glides from wherever it is now; the mood crossfade restarts from the nearer of its two ends.
      s.target = toLabPalette(palette.ambient);
      if (Math.min(1, (now - s.mixStart) / MOOD_MS) > 0.5) {
        s.moodA = s.moodB;
        s.flavA = s.flavB;
      }
      s.moodB = moodFor(game);
      s.flavB = moodFlavor(s.moodB, game);
      s.mixStart = now;
      requestFrame.current();
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [game, fixedAccent]);

  useEffect(() => {
    if (!fixedAccent || fixedAccent === 'system' || fixedAccent === 'cover') return; // applied by SystemBackdrop / AccentTheme
    const map: Record<string, [string, string]> = {
      violet: ['oklch(0.7 0.17 292)', 'oklch(0.68 0.15 255)'],
      blue: ['oklch(0.7 0.15 255)', 'oklch(0.72 0.12 220)'],
      cyan: ['oklch(0.78 0.12 210)', 'oklch(0.7 0.14 255)'],
      rose: ['oklch(0.74 0.16 5)', 'oklch(0.7 0.15 330)'],
      amber: ['oklch(0.82 0.15 75)', 'oklch(0.74 0.16 45)'],
      emerald: ['oklch(0.78 0.15 160)', 'oklch(0.74 0.12 195)'],
    };
    const [a, b] = map[fixedAccent] ?? map.violet;
    document.documentElement.style.setProperty('--game', a);
    document.documentElement.style.setProperty('--game-2', b);
  }, [fixedAccent]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !enabled) return;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) return;
    const program = link(gl);
    if (!program) return;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(program, n);
    const U = {
      t: u('uT'), res: u('uRes'), mix: u('uMix'), moodA: u('uMoodA'), moodB: u('uMoodB'), flavA: u('uFlavA'), flavB: u('uFlavB'),
      intensity: u('uIntensity'), speed: u('uSpeed'), layers: u('uLayers'), warm: u('uWarm'), dim: u('uDim'), pulse: u('uPulse'),
      ptr: u('uPtr'), a: u('uA'), l: u('uL'), live: u('uLive'),
    };

    let disposed = false;
    const resize = () => {
      const w = Math.max(64, Math.floor(innerWidth * scale));
      const h = Math.max(64, Math.floor(innerHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();

    let raf = 0;
    let last = 0;
    let prev = 0;
    const start = performance.now();
    const setState = (v: string) => {
      if (wrap.current) wrap.current.dataset.state = v;
    };

    // Time of day: re-read once a minute (it changes over hours, never in steps).
    const hourNow = () => new Date().getHours() + new Date().getMinutes() / 60;
    let day: Daylight = daylight(hourNow());
    const dayTimer = window.setInterval(() => (day = daylight(hourNow())), 60_000);

    // Pointer parallax: the raw position is only recorded here; the loop eases toward it.
    const ptrTarget = { x: 0, y: 0 };
    const ptr = { x: 0, y: 0 };
    let pulse = 0;
    const onPointer = (e: PointerEvent) => {
      ptrTarget.x = (e.clientX / Math.max(1, innerWidth)) * 2 - 1;
      ptrTarget.y = (e.clientY / Math.max(1, innerHeight)) * 2 - 1;
    };
    const onLeave = () => {
      ptrTarget.x = 0;
      ptrTarget.y = 0;
    };

    // Trailer following: only while animating (never under reduced motion or while a game runs).
    let follow: FollowState = initialFollow();
    let lastStep = 0;
    let accentAt = 0;
    let appliedAccent: LCh | null = null;
    const followAccent = (now: number) => {
      const { fixedAccent: fixed } = live.current;
      const art = parseOklch(state.current.accentCss);
      if (fixed || !art) return;
      if (follow.weight <= 0.02) {
        // Done following: hand the accent back to the artwork (once).
        if (appliedAccent) {
          appliedAccent = null;
          document.documentElement.style.setProperty('--game', state.current.accentCss!);
        }
        return;
      }
      if (now - accentAt < ACCENT_EVERY_MS) return;
      const next = clampAccent(mixLch(art, labToLch(follow.accent), ACCENT_FOLLOW * (follow.weight / FOLLOW.maxWeight)));
      if (appliedAccent && labDistance(lchToLab(appliedAccent), lchToLab(next)) < ACCENT_MIN_SHIFT) return;
      accentAt = now;
      appliedAccent = next;
      // --game is a registered property with a 900 ms transition, so this glides.
      document.documentElement.style.setProperty('--game', cssOklch(next));
    };

    // Cost counters, published on the element about once a second (local only; read by tests and docs/PERFORMANCE.md).
    let frames = 0;
    let jsMs = 0;
    let statsAt = 0;
    const publish = (now: number, force = false) => {
      const el = wrap.current;
      if (!el || (!force && now - statsAt < 1000)) return;
      statsAt = now;
      el.dataset.frames = String(frames);
      el.dataset.jsMs = (frames ? jsMs / frames : 0).toFixed(3);
    };

    let rgbFor: LabPalette | null = null;
    let rgb = new Float32Array(12);

    /** Draws one frame; returns whether something is still settling (palette or mood). */
    const draw = (now: number): boolean => {
      const t0 = performance.now();
      const s = state.current;
      const p = live.current.profile;
      const dt = prev ? Math.min(250, now - prev) : animate ? 0 : 16;
      prev = now;
      if (s.cur !== s.target) {
        s.cur = approachPalette(s.cur, s.target, dt, PALETTE_TAU);
        if (paletteGap(s.cur, s.target) < SETTLED) s.cur = s.target; // below a visible step: land exactly
      }
      const mixT = Math.min(1, (now - s.mixStart) / MOOD_MS);
      const eased = easeMix(mixT);
      ptr.x = approach(ptr.x, p.parallax ? ptrTarget.x : 0, dt, POINTER_TAU);
      ptr.y = approach(ptr.y, p.parallax ? ptrTarget.y : 0, dt, POINTER_TAU);
      pulse = approach(pulse, p.audio ? ambientLoudness() : 0, dt, AUDIO_TAU);
      gl.uniform1f(U.t, animate ? (now - start) / 1000 : 12);
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.mix, eased);
      gl.uniform1f(U.moodA, MOOD_INDEX[s.moodA]);
      gl.uniform1f(U.moodB, MOOD_INDEX[s.moodB]);
      gl.uniform1f(U.flavA, s.flavA);
      gl.uniform1f(U.flavB, s.flavB);
      gl.uniform1f(U.intensity, live.current.intensity);
      gl.uniform1f(U.speed, moodSpeed(eased > 0.5 ? s.moodB : s.moodA));
      gl.uniform1f(U.layers, layers);
      gl.uniform1f(U.warm, day.warm);
      gl.uniform1f(U.dim, day.dim);
      gl.uniform1f(U.pulse, pulse);
      gl.uniform2f(U.ptr, ptr.x, ptr.y);
      if (rgbFor !== s.cur) {
        rgbFor = s.cur;
        rgb = new Float32Array(labPaletteToRgb(s.cur).flat()); // only while a palette is gliding
      }
      gl.uniform3fv(U.a, rgb);
      if (animate) {
        const tint = useHeroTrailer.getState().tint;
        const target = live.current.follow && tint && tint.gameId === live.current.focusId ? tint : null;
        follow = stepFollow(follow, target, lastStep ? now - lastStep : 0);
        lastStep = now;
        followAccent(now);
      }
      gl.uniform3fv(U.l, followRgb(follow).flat());
      gl.uniform1f(U.live, follow.weight);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frames++;
      jsMs += performance.now() - t0;
      publish(now, !animate);
      return s.cur !== s.target || mixT < 1;
    };

    const loop = (now: number) => {
      raf = 0;
      if (disposed) return;
      if (document.hidden) {
        // Paused: nothing is scheduled until the window is visible again.
        lastStep = 0;
        prev = 0;
        setState('paused');
        return;
      }
      if (now - last >= frameInterval(live.current.profile, document.hasFocus())) {
        last = now;
        draw(now);
      }
      raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      setState('running');
      if (!raf) raf = requestAnimationFrame(loop);
    };
    // Still frames (reduced motion / a game running) redraw only while a palette or mood change settles.
    let settling = 0;
    const settle = () => {
      settling = 0;
      if (disposed || document.hidden) return;
      if (draw(performance.now())) settling = requestAnimationFrame(settle);
    };
    requestFrame.current = () => {
      if (animate) return kick();
      setState('still');
      if (!settling) settling = requestAnimationFrame(settle);
    };
    const onVis = () => {
      if (!document.hidden) requestFrame.current();
    };
    document.addEventListener('visibilitychange', onVis);
    addEventListener('resize', resize);
    if (parallax) {
      addEventListener('pointermove', onPointer, { passive: true });
      document.documentElement.addEventListener('pointerleave', onLeave);
    }
    requestFrame.current();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(settling);
      window.clearInterval(dayTimer);
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('resize', resize);
      removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      requestFrame.current = () => {};
      if (appliedAccent && state.current.accentCss && !live.current.fixedAccent) document.documentElement.style.setProperty('--game', state.current.accentCss);
      gl.deleteProgram(program);
      gl.deleteBuffer(buf);
    };
  }, [enabled, animate, quality, layers, scale, parallax]);

  return (
    <div
      ref={wrap}
      className="living-canvas"
      aria-hidden
      data-enabled={enabled}
      data-quality={quality ?? 'off'}
      data-layers={enabled ? layers : undefined}
      data-fps={enabled ? profile.fps : undefined}
      data-parallax={parallax ? 'on' : 'off'}
      data-audio={profile.audio ? 'on' : 'off'}
      data-state={enabled ? undefined : 'off'}
    >
      {enabled && <canvas ref={ref} className="living-canvas__gl" />}
      <div className="living-canvas__scrim" />
    </div>
  );
}

function link(gl: WebGL2RenderingContext): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[LivingCanvas] shader error', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const v = compile(gl.VERTEX_SHADER, VERT);
  const f = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!v || !f) {
    if (v) gl.deleteShader(v);
    if (f) gl.deleteShader(f);
    return null;
  }
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  // The linked program keeps what it needs; the shader objects can go.
  gl.detachShader(p, v);
  gl.detachShader(p, f);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  gl.useProgram(p);
  return p;
}
