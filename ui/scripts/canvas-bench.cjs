// Track E2b: Living Canvas shader cost, measured with GPU timer queries (EXT_disjoint_timer_query_webgl2) in
// Playwright's Chromium on the real GPU (ANGLE/Direct3D 11). Shaders are read from component sources, so a
// before/after compares two versions of LivingCanvas.tsx:
//   git show <rev>:ui/src/components/shell/LivingCanvas.tsx > before.tsx
//   node scripts/canvas-bench.cjs 3 before=before.tsx after=src/components/shell/LivingCanvas.tsx
// Each round draws every shader × mood × resolution (Balanced 768×480, High 1056×660) 120 times, interleaved;
// the table shows the best per-round median GPU time in ms (least disturbed by other work on the machine).
const fs = require('fs');
const { chromium } = require('@playwright/test');

const rounds = Number(process.argv[2]);
const shaders = process.argv.slice(3).map((a) => {
  const [label, file] = a.split('=');
  const src = fs.readFileSync(file, 'utf8');
  const grab = (name) => new RegExp('const ' + name + ' = `([\\s\\S]*?)`;').exec(src)[1];
  return { label, VERT: grab('VERT'), FRAG: grab('FRAG') };
});

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.setContent('<canvas id=c></canvas>');
  const out = await page.evaluate(async ({ shaders, rounds }) => {
    const canvas = document.getElementById('c');
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const progs = shaders.map((s) => {
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, s.VERT));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, s.FRAG));
      gl.linkProgram(p);
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      const uniforms = [];
      for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); uniforms.push({ name: u.name.replace(/\[0\]$/, ''), type: u.type, size: u.size, loc: gl.getUniformLocation(p, u.name) }); }
      return { label: s.label, p, uniforms };
    });
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const bytes = new Uint8Array(256 * 256);
    let seed = 0x9e3779b9;
    for (let i = 0; i < bytes.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; bytes[i] = seed >>> 24; }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 256, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const pal = [0.1, 0.08, 0.16, 0.2, 0.1, 0.25, 0.3, 0.14, 0.2, 0.36, 0.2, 0.3];
    const set = (pr, w, h, t, mood) => {
      for (const u of pr.uniforms) {
        const v = { uRes: null, uT: t, uMoodA: mood, uMoodB: mood, uMix: 1, uIntensity: 0.7, uSpeed: 1, uLayers: w > 900 ? 3 : 2, uDim: 1, uWarm: 0.3, uPulse: 0, uLive: 0, uFlavA: 0, uFlavB: 0 }[u.name];
        if (u.name === 'uN') gl.uniform1i(u.loc, 0);
        else if (u.name === 'uRes') gl.uniform2f(u.loc, w, h);
        else if (v !== undefined) gl.uniform1f(u.loc, v);
        else if (u.type === gl.FLOAT_VEC3) gl.uniform3fv(u.loc, pal.slice(0, 3 * u.size));
        else if (u.type === gl.FLOAT_VEC2) gl.uniform2f(u.loc, 0.1, -0.05);
      }
    };
    const px = new Uint8Array(4);
    const best = {};
    for (let r = 0; r < rounds; r++) {
      for (const [res, w, h] of [['balanced', 768, 480], ['high', 1056, 660]]) {
        canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h);
        for (let mood = 0; mood < 6; mood++) {
          for (const pr of progs) {
            gl.useProgram(pr.p);
            const times = [];
            const qs = [];
            for (let f = 0; f < 140; f++) {
              set(pr, w, h, 10 + f / 30, mood);
              const q = timer && f >= 20 ? gl.createQuery() : null;
              if (q) gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
              gl.drawArrays(gl.TRIANGLES, 0, 3);
              if (q) { gl.endQuery(timer.TIME_ELAPSED_EXT); qs.push(q); }
              if (f % 10 === 9) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            }
            gl.finish();
            for (let tries = 0; tries < 200 && qs.length && !gl.getQueryParameter(qs[qs.length - 1], gl.QUERY_RESULT_AVAILABLE); tries++) await new Promise((r) => setTimeout(r, 5));
            for (const q of qs) { if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(timer.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
            times.sort((a, b) => a - b);
            const med = times[times.length >> 1];
            const k = `${res}|${mood}|${pr.label}`;
            best[k] = Math.min(best[k] ?? Infinity, med);
          }
        }
      }
    }
    return { renderer, timerQuery: !!timer, best };
  }, { shaders, rounds });
  // Table: rows res×mood, columns shaders.
  const moods = ['drift', 'velocity', 'cosmos', 'ember', 'dread', 'tide'];
  const labels = shaders.map((s) => s.label);
  console.log(out.renderer, 'timer query:', out.timerQuery);
  console.log(['res', 'mood', ...labels].join('\t'));
  for (const res of ['balanced', 'high']) for (let m = 0; m < 6; m++) console.log([res, moods[m], ...labels.map((l) => out.best[`${res}|${m}|${l}`].toFixed(2))].join('\t'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
