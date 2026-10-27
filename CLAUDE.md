# CLAUDE.md

This repo is the GitHub profile README for SeoulSKY. Its two animated
images are recordings of [www.seoulsky.dev](https://www.seoulsky.dev),
whose source is the `website` repo (`SeoulSKY/SeoulSKY.github.io`):

| File | Shows | Size |
| --- | --- | --- |
| `assets/hero.gif` | the lit hero, typing both taglines, one full cycle | 1200×630, 20 fps, ~1.5 MB |
| `assets/skills.gif` | the three skill rows of the Skills section | 800×371, 15 fps, 24 s, ~9.5 MB |

The README links each image to the site and references it by a relative
path (`assets/hero.gif`), with alt text.

## Making the GIFs

Rerun this whenever the hero or the Skills section changes how it looks:

```bash
tools/make-gifs.sh            # the website checked out at ../website
tools/make-gifs.sh ~/code/website
```

It takes about a minute: it builds the website, serves the production
build, records both GIFs and writes them over the ones in `assets/`.
Watch both before committing.

Requirements: macOS, Node 22+ (for the global `fetch` and `WebSocket`),
ffmpeg, Google Chrome, and the website repo with `npm install` done and
its `.env` in place (its build fails without the EmailJS variables).

Settings, as environment variables:

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3871` | where the site is served |
| `CDP_PORT` | `9333` | Chrome's DevTools port |
| `CHROME` | `/Applications/Google Chrome.app/…` | the Chrome binary |
| `SKILLS_LOOP` | `24` | seconds in the skills loop |
| `SKILLS_FPS` | `15` | skills frame rate |
| `SKILLS_WIDTH` | `800` | skills viewport width, which is also the GIF's |

## How the recording works

`tools/record.mjs` drives headless Chrome over the DevTools protocol
directly, with no dependencies.

- **A virtual clock.** A script that runs before the page's own replaces
  `requestAnimationFrame`, the timers, `performance.now()` and
  `Date.now()`, and CSS animations are set to the same time. Time moves
  only when the recorder says so, so every frame is exactly one frame
  apart however long its screenshot takes, and every run is the same.
- **The production build.** The dev server is slower and adds the intro
  scrubber, so the script always records `next build` output.
- **Hero.** The navbar and the two buttons are hidden: the whole picture
  is already a link, and buttons cannot be clicked in a GIF. The intro
  plays through on the virtual clock, then the script watches
  `.hero-typed` to learn the taglines' order and records from the moment
  the last tagline is erased until it is erased again. The GIF opens on
  the first tagline typing and loops without a jump, and a change to the
  taglines needs no change here.
- **Skills.** The script scrolls the window, not the element:
  ScrollSmoother follows the window's scroll, and `scrollIntoView` would
  move its fixed wrapper instead, so the rows would never rise in. It
  waits in real time for the lazily loaded icons. Then the clock stops
  and the rows are moved by hand. On the site each row loops on its own
  (38, 44 and 50 s), so the rows never line up again; in the GIF each one
  moves exactly one set of its pills over the same `SKILLS_LOOP`, in the
  site's directions, so it loops without a jump. That makes the rows run
  about 1.6 to 2.1 times as fast as on the site.
- **Clips.** A screenshot's clip is measured from the top of the
  document, not the viewport, so the skills clip adds `scrollY`.

## Encoding

Each GIF gets one palette for all its frames, so a pixel that stays still
keeps its colour and GIF can skip it between frames.

- The hero is mostly still (only the typing and small lights change), so
  it can afford 256 colours with ordered (Bayer) dithering, which keeps
  the sky from banding and, unlike error diffusion, gives a still pixel
  the same colour in every frame.
- In skills every row moves on every frame, and GIF compresses each
  frame on its own, so each one costs about 26 KB whatever is done. It
  uses 128 colours and no dithering, since dither noise on moving pixels
  costs megabytes. The only trace is slight striping where the rows fade
  out at the edges.

## Size budget

Keep each GIF under 10 MB, GitHub's limit for an uploaded image; both
load on every visit to the profile. The script warns when one is over.
Skills is the one that grows. To shrink it, shorten `SKILLS_LOOP` (the
rows run faster), lower `SKILLS_FPS` (they step more) or narrow
`SKILLS_WIDTH` (fewer pills in view). Things that do not help:

- Scaling the frames down after recording. Resampling changes the
  anti-aliasing on every frame, and a 1000 px recording scaled to 800 px
  came out at 18 MB against 9.5 MB recorded at 800 px.
- Animated WebP. It has no motion compensation either: 13 MB for the
  same 30 s loop.

## When the website changes

The recorder relies on these hooks in the website's markup. If one is
renamed there, update `tools/record.mjs`:

- `header`, and `.hero-content a` for the hero's buttons (hidden)
- `.hero-typed`, the element the taglines are typed into
- `#skills`, `.mq-rows` and `.mq-track`: the section, its rows, and each
  row's track holding two copies of its pills
