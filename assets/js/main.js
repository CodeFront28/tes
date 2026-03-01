// assets/js/main.js
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- DOM ----------
  const startVideo = $(".hero__start");
  const endVideo = $(".hero__end");
  const flagVideo = $(".flag");
  const colorEl = $("h1 .color");
  const stonesWrap = $(".stones");
  const stones = stonesWrap ? $$(".stones > div") : [];

  const preloader = $("#preloader");
  const preloaderBar = $("#preloaderBar");
  const preloaderText = $("#preloaderText");

  if (
    !startVideo ||
    !endVideo ||
    !colorEl ||
    !stonesWrap ||
    stones.length === 0 ||
    !preloader ||
    !preloaderBar ||
    !preloaderText
  )
    return;

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function pickStoneColor(stone) {
    const path = stone.querySelector("svg path[fill]");
    const fill = path?.getAttribute("fill");
    if (fill && fill !== "none" && fill !== "transparent") return fill;

    const anyPath = stone.querySelector("svg path");
    if (anyPath) {
      const cs = getComputedStyle(anyPath);
      if (cs.fill && cs.fill !== "none" && cs.fill !== "transparent")
        return cs.fill;
    }
    return "#ffffff";
  }

  function setPreloadText(text) {
    preloaderText.textContent = text;
  }

  function setProgress(p) {
    const pct = clamp(Math.round(p * 100), 0, 100);
    preloaderBar.style.width = `${pct}%`;
  }

  function waitForEvent(el, eventName, timeoutMs = 12000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve(true);
      };
      const cleanup = () => {
        el.removeEventListener(eventName, finish);
        if (timer) clearTimeout(timer);
      };
      el.addEventListener(eventName, finish, { once: true });
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
    });
  }

  function waitForVideoFirstFrame(video, timeoutMs = 15000) {
    // We want "first frame decoded" as a practical readiness signal.
    // loadeddata => first frame available.
    // requestVideoFrameCallback => even better when available.
    return new Promise(async (resolve) => {
      try {
        // iOS/Safari sometimes needs load() to kick metadata/data fetch.
        video.load?.();
      } catch (_) {}

      const ok = await waitForEvent(video, "loadeddata", timeoutMs);
      if (!ok) return resolve(false);

      if (typeof video.requestVideoFrameCallback === "function") {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(true);
        }, 400); // small grace
        try {
          video.requestVideoFrameCallback(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(true);
          });
        } catch (_) {
          clearTimeout(timer);
          resolve(true);
        }
      } else {
        resolve(true);
      }
    });
  }

  function preloadImage(src, timeoutMs = 12000) {
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;

      const finish = (ok) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(ok);
      };

      const cleanup = () => {
        img.onload = null;
        img.onerror = null;
        if (timer) clearTimeout(timer);
      };

      img.onload = () => finish(true);
      img.onerror = () => finish(false);

      const timer = setTimeout(() => finish(false), timeoutMs);
      img.src = src;
    });
  }

  async function fadeOutPreloader() {
    preloader.classList.add("is-hidden");
    preloader.setAttribute("aria-hidden", "true");
    // remove after transition
    await new Promise((r) => setTimeout(r, 420));
    preloader.remove();
    document.body.classList.remove("is-loading");
  }

  // ---------- Stones init ----------
  stones.forEach((stone) => {
    stone.style.setProperty("--glow", pickStoneColor(stone));
  });

  // ---------- video initial state ----------
  endVideo.style.opacity = "0";
  endVideo.currentTime = 0;
  endVideo.pause();

  // On iOS, these attributes help autoplay/muted stability
  [startVideo, endVideo, flagVideo].forEach((v) => {
    if (!v) return;
    v.muted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
  });

  // ---------- Scramble ----------
  function createStableScrambleTarget(el) {
    const finalText = el.textContent.trim();
    el.textContent = "";

    const wrap = document.createElement("span");
    wrap.className = "scramble-wrap";
    wrap.style.display = "inline-block";
    wrap.style.position = "relative";

    const finalSpan = document.createElement("span");
    finalSpan.className = "final";
    finalSpan.textContent = finalText;
    finalSpan.style.opacity = "0";
    finalSpan.style.pointerEvents = "none";

    const scrambleSpan = document.createElement("span");
    scrambleSpan.className = "scramble";
    scrambleSpan.style.position = "absolute";
    scrambleSpan.style.left = "0";
    scrambleSpan.style.top = "0";
    scrambleSpan.style.right = "0";

    wrap.appendChild(finalSpan);
    wrap.appendChild(scrambleSpan);
    el.appendChild(wrap);

    return { finalText, scrambleSpan };
  }

  const scrambleTarget = createStableScrambleTarget(colorEl);

  function scrambleToText(targetEl, finalText, duration = 2000) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    const start = performance.now();
    let raf = 0;

    const tick = (now) => {
      const t = clamp((now - start) / duration, 0, 1);
      const reveal = Math.floor(finalText.length * t);

      let out = "";
      for (let i = 0; i < finalText.length; i++) {
        if (i < reveal) out += finalText[i];
        else out += chars[Math.floor(Math.random() * chars.length)];
      }

      targetEl.textContent = out;

      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      targetEl.textContent = finalText;
    };
  }

  // ---------- warm up 2nd video for seamless swap ----------
  async function warmUpVideo(video) {
    try {
      video.setAttribute("preload", "auto");
      video.load();

      const ok = await waitForVideoFirstFrame(video, 15000);
      if (!ok) return;

      // Try decode pipeline warm-up: play briefly then pause/reset
      try {
        await video.play();
        // let it advance just a tiny bit
        await new Promise((r) => setTimeout(r, 40));
      } catch (_) {}
      try {
        video.pause();
        video.currentTime = 0;
      } catch (_) {}
    } catch (_) {}
  }

  // ---------- Stones animation ----------
  function animateStonesIn() {
    stonesWrap.classList.remove("svg-on");

    stones.forEach((stone) => stone.classList.remove("is-in"));

    // ensure they are offscreen instantly (avoid flash)
    // (CSS already positions them outside via translateX, but this ensures class state is consistent)
    let i = 0;
    const step = () => {
      if (i >= stones.length) {
        // glow a bit позже
        setTimeout(() => stonesWrap.classList.add("svg-on"), 1000);
        return;
      }
      stones[i].classList.add("is-in");
      i += 1;
      setTimeout(step, 170); // темп вылета
    };
    step();
  }

  // ---------- Main flow ----------
  async function run() {
    // Start first video (it should be ready already after preloader, but still safe)
    try {
      await startVideo.play();
    } catch (_) {}

    // Warm up end video in background during start video
    warmUpVideo(endVideo);

    // Determine duration for syncing scramble
    const ensureDuration = async () => {
      if (isFinite(startVideo.duration) && startVideo.duration > 0)
        return startVideo.duration;
      await waitForEvent(startVideo, "loadedmetadata", 12000);
      if (isFinite(startVideo.duration) && startVideo.duration > 0)
        return startVideo.duration;
      return 2.4; // fallback
    };

    const durationSec = await ensureDuration();

    // Scramble runs exactly as long as the first video
    const stopScramble = scrambleToText(
      scrambleTarget.scrambleSpan,
      scrambleTarget.finalText,
      Math.max(300, durationSec * 1000),
    );

    // Wait for first video end, then swap
    const ended = await waitForEvent(
      startVideo,
      "ended",
      Math.max(1200, durationSec * 1000 + 2500),
    );

    // Even if ended didn't fire (rare), still proceed after timeout
    stopScramble();

    // Seamless swap: near-instant opacity flip
    startVideo.style.opacity = "0";
    endVideo.style.opacity = "1";

    try {
      endVideo.currentTime = 0;
    } catch (_) {}

    // Start looping end video
    try {
      await endVideo.play();
    } catch (_) {}

    // Now stones come in
    animateStonesIn();
  }

  // ---------- Preloader flow ----------
  async function startWithPreloader() {
    document.body.classList.add("is-loading");
    setProgress(0);
    setPreloadText("LOADING…");

    // 1) Preload critical images (bg + moon)
    // bg is CSS background, so we fetch it manually here
    const bgSrc = "assets/img/bg1.webp";
    const moonImg = $(".moon");
    const moonSrc = moonImg?.getAttribute("src") || "assets/img/moon.webp";

    setPreloadText("LOADING VISUALS…");
    const imgTasks = [preloadImage(bgSrc, 12000), preloadImage(moonSrc, 12000)];

    // 2) Ensure first frames for videos
    // We intentionally do not wait for "canplaythrough"
    // We just want first frame decoded to avoid black flashes.
    setPreloadText("LOADING VIDEO…");

    // If you have multiple <source>, browser picks one; we just wait readiness.
    // Force a sensible preload strategy during preloader:
    startVideo.setAttribute("preload", "auto");
    endVideo.setAttribute("preload", "auto"); // during preloader we actually want it ready
    if (flagVideo) flagVideo.setAttribute("preload", "auto");

    // Kick load() to ensure fetch begins immediately
    try {
      startVideo.load();
    } catch (_) {}
    try {
      endVideo.load();
    } catch (_) {}
    try {
      flagVideo?.load?.();
    } catch (_) {}

    const videoTasks = [
      waitForVideoFirstFrame(startVideo, 20000),
      waitForVideoFirstFrame(endVideo, 20000),
      flagVideo
        ? waitForVideoFirstFrame(flagVideo, 20000)
        : Promise.resolve(true),
    ];

    const allTasks = [...imgTasks, ...videoTasks];
    const total = allTasks.length;
    let done = 0;

    // Progress as tasks resolve
    allTasks.forEach((p) => {
      Promise.resolve(p).then(() => {
        done += 1;
        setProgress(done / total);
      });
    });

    // Wait all (even if some fail, we continue — but progress still advances)
    await Promise.allSettled(allTasks);

    // Small “settle” delay so decode pipeline calms down before we animate
    setPreloadText("STARTING…");
    setProgress(1);
    await new Promise((r) => setTimeout(r, 180));

    await fadeOutPreloader();

    // Start your original logic
    run();
  }

  // Start
  startWithPreloader();
})();
