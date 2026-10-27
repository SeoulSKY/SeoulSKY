// Records www.seoulsky.dev frame by frame on a virtual clock, through
// Chrome's DevTools protocol, into numbered PNGs.
//
//   node tools/record.mjs <hero|skills> <outDir>
//
// Expects the site on SITE_URL and a headless Chrome listening on
// CDP_PORT. tools/make-gifs.sh sets both up; see CLAUDE.md.
import { mkdir, writeFile } from "node:fs/promises";

const [mode, outDir] = process.argv.slice(2);
if (!["hero", "skills"].includes(mode) || !outDir) {
  console.error("usage: node tools/record.mjs <hero|skills> <outDir>");
  process.exit(2);
}
const SITE_URL = process.env.SITE_URL ?? "http://localhost:3871/";
const CDP_PORT = process.env.CDP_PORT ?? "9333";
const HERO = { width: 1200, height: 630, fps: 20 };
const SKILLS = {
  width: Number(process.env.SKILLS_WIDTH ?? 800),
  height: 900,
  fps: Number(process.env.SKILLS_FPS ?? 15),
  loop: Number(process.env.SKILLS_LOOP ?? 24),
};
const view = mode === "hero" ? HERO : SKILLS;
const STEP = 1000 / view.fps;
await mkdir(outDir, { recursive: true });

// Installed before any of the page's scripts run: the page's clocks only
// move when __advance() is called, so every frame is exactly STEP apart
// however long a screenshot takes.
const CLOCK = `(() => {
  let now = 0;
  const dateStart = Date.now();
  performance.now = () => now;
  Date.now = () => dateStart + now;
  let nextId = 0;
  const rafs = new Map();
  const timers = new Map();
  window.requestAnimationFrame = (cb) => { rafs.set(++nextId, cb); return nextId; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };
  window.setTimeout = (cb, ms = 0, ...args) => { timers.set(++nextId, { at: now + Math.max(0, ms), cb, args }); return nextId; };
  window.setInterval = (cb, ms = 0, ...args) => { timers.set(++nextId, { at: now + Math.max(1, ms), cb, args, every: Math.max(1, ms) }); return nextId; };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  function run(fn, ...args) { try { if (typeof fn === "function") fn(...args); } catch (e) { console.error(e); } }
  window.__advance = (ms, tick = 1000 / 60) => {
    const end = now + ms;
    while (now < end - 1e-6) {
      now = Math.min(end, now + tick);
      const due = [...timers].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [id, t] of due) {
        if (t.every) t.at += t.every; else timers.delete(id);
        run(t.cb, ...t.args);
      }
      const cbs = [...rafs.values()];
      rafs.clear();
      for (const cb of cbs) run(cb, now);
    }
    // CSS animations (the tagline's caret) follow the same clock
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = now; }
    return now;
  };
})();`;

const target = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, {
  method: "PUT",
}).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
let lastId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++lastId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function js(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.error || r.result?.exceptionDetails) {
    throw new Error(JSON.stringify(r.error ?? r.result.exceptionDetails));
  }
  return r.result?.result?.value;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
/** Moves page time on in chunks, letting the browser render between. */
async function advance(ms, chunk = 200) {
  for (let done = 0; done < ms; done += chunk) {
    await js(`__advance(${Math.min(chunk, ms - done)})`);
    await sleep(15);
  }
}
let frame = 0;
async function shot(clip) {
  const r = await send("Page.captureScreenshot", {
    format: "png",
    clip: { ...clip, scale: 1 },
  });
  const name = `f${String(frame++).padStart(4, "0")}.png`;
  await writeFile(`${outDir}/${name}`, Buffer.from(r.result.data, "base64"));
}

await new Promise((r) => {
  ws.onopen = r;
});
await send("Emulation.setDeviceMetricsOverride", {
  width: view.width,
  height: view.height,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: CLOCK });
await send("Page.navigate", { url: SITE_URL });
await sleep(4000); // real time for the network: scripts, fonts, images

if (mode === "hero") {
  // The README links the whole picture to the site, so the nav and the
  // buttons would only be clutter. The hero's own text stays.
  await js(`(() => {
    const s = document.createElement("style");
    s.textContent = "header, .hero-content a { visibility: hidden !important; }";
    document.head.append(s);
  })()`);

  // The taglines type, hold and erase in turn, forever. The GIF starts
  // the moment the last tagline has been erased, so it opens on the first
  // one typing, and ends as that last one is erased again: it loops
  // without a jump.
  let longest = "";
  let previous = "";
  /** Returns the tagline just erased, if this step erased one. */
  async function step() {
    await js(`__advance(${STEP})`);
    const text = await js(
      `document.querySelector(".hero-typed")?.textContent ?? ""`,
    );
    if (text.length > longest.length) longest = text;
    const erased = text === "" && previous !== "" ? longest : null;
    if (erased) longest = "";
    previous = text;
    return erased;
  }

  /** Steps until a tagline is erased (one that `want` accepts). */
  async function untilErased(want = () => true, limit = 120000) {
    for (let t = 0; t < limit; t += STEP) {
      const erased = await step();
      if (erased && want(erased)) return erased;
    }
    throw new Error("the taglines stopped cycling");
  }

  // play the intro and the entrance through: the first tagline erased is
  // the first one typed, and a full cycle on, the last one erased before
  // it again is the last tagline
  const first = await untilErased();
  let last = first;
  for (let erased = null; erased !== first; ) {
    erased = await untilErased();
    if (erased !== first) last = erased;
  }
  await untilErased((erased) => erased === last);

  const clip = { x: 0, y: 0, width: view.width, height: view.height };
  await shot(clip);
  for (let erased = null; erased !== last; ) {
    erased = await step();
    if (erased !== last) await shot(clip);
    if (frame > 2000) throw new Error("no repeating tagline cycle found");
  }
  console.log(`hero: ${frame} frames, ${((frame * STEP) / 1000).toFixed(2)}s`);
} else {
  // let the intro finish, then ride to Skills and let its rows rise in
  await advance(30000);
  // ScrollSmoother follows the window's scroll; scrollIntoView would move
  // its fixed wrapper instead, which nothing listens to
  await js(`(() => {
    const top = document.getElementById("skills").getBoundingClientRect().top + scrollY;
    window.scrollTo(0, top);
  })()`);
  await advance(3000);
  await sleep(2500); // the skill icons load lazily, over the real network
  await advance(3000);

  const rows = await js(`(() => {
    const r = document.querySelector("#skills .mq-rows").getBoundingClientRect();
    // a screenshot's clip is measured from the top of the document
    return { top: r.top + scrollY, height: r.height };
  })()`);
  const pad = 24;
  const clip = {
    x: 0,
    y: Math.round(rows.top) - pad,
    width: view.width,
    height: Math.round(rows.height) + pad * 2,
  };

  // On the site each row loops on its own (38, 44 and 50s), so the rows
  // never line up again. Here the clock stands still and the rows are
  // moved by hand, each by exactly one set of its pills (half the track)
  // over the same loop, in the site's directions.
  const frames = Math.round(view.loop * view.fps);
  for (let i = 0; i < frames; i++) {
    const p = i / frames;
    await js(`(() => {
      document.querySelectorAll("#skills .mq-track").forEach((track, k) => {
        const x = k % 2 === 0 ? -50 * ${p} : -50 + 50 * ${p};
        track.style.transform = "translate(" + x + "%, 0)";
      });
    })()`);
    await shot(clip);
  }
  console.log(`skills: ${frame} frames, ${view.loop}s`);
}

ws.close();
process.exit(0);
