// Vigila ön sayfası: kahraman sahnesindeki canlı örnek, sürüm bilgisi ve kopyalama düğmeleri.
(() => {
  const COLORS = { visual: "#f2546b", audio: "#16a5c9", av: "#9a6cf0" };
  const KINDS = ["visual", "audio", "visual", "av", "audio", "visual"];
  const WINDOW_MS = 9000;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const stage = document.getElementById("stage");
  const strip = document.getElementById("strip");
  const lastRtEl = document.getElementById("lastRt");
  const hitEl = document.getElementById("hitRate");
  if (!stage || !strip) return;

  const shapes = [
    '<circle cx="20" cy="20" r="15" fill="currentColor"/>',
    '<rect x="6" y="6" width="28" height="28" rx="7" fill="currentColor"/>',
    '<path d="M20 4 L36 34 H4 Z" fill="currentColor"/>',
  ];

  let counter = 0;
  let hits = 0;
  let shown = 0;
  const pulses = [];

  /** Video üzerinde bir uyaran belirir; işitselse dalga halkaları yayılır. Tepki gecikmeyle zaman şeridine düşer. */
  function spawn() {
    const id = counter++;
    const kind = KINDS[id % KINDS.length];
    const missed = id % 7 === 5;
    const rt = missed ? null : Math.round(260 + Math.random() * 240 - (kind === "av" ? 60 : 0));
    const color = COLORS[kind];

    const el = document.createElement("div");
    el.className = "stim";
    el.style.left = `${12 + Math.random() * 74}%`;
    el.style.top = `${16 + Math.random() * 54}%`;
    el.style.color = color;
    if (kind !== "audio") el.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true">${shapes[id % 3]}</svg>`;
    if (kind !== "visual") {
      for (let r = 0; r < 3; r++) {
        const ring = document.createElement("span");
        ring.className = "ring";
        ring.style.animationDelay = `${r * 0.18}s`;
        el.appendChild(ring);
      }
    }
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1300);

    const blk = document.createElement("div");
    blk.className = "blk";
    blk.style.background = color;
    blk.style.borderColor = color;
    strip.appendChild(blk);
    const pulse = { born: performance.now(), rt, kind, blk, bar: null };
    pulses.push(pulse);

    setTimeout(() => {
      shown++;
      if (rt != null) {
        hits++;
        lastRtEl.textContent = `${rt} ms`;
        const bar = document.createElement("div");
        bar.className = "rtbar";
        bar.style.background = color;
        bar.style.width = `${(rt / WINDOW_MS) * strip.clientWidth}px`;
        strip.appendChild(bar);
        pulse.bar = bar;
      } else {
        blk.style.background = "transparent";
        blk.style.borderColor = "#ffb547";
        blk.style.borderStyle = "dashed";
      }
      hitEl.textContent = `%${Math.round((hits / shown) * 100)}`;
    }, rt ?? 1200);
  }

  function frame(now) {
    const width = strip.clientWidth;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      const x = width - ((now - p.born) / WINDOW_MS) * width;
      if (x < -60) {
        p.blk.remove();
        p.bar?.remove();
        pulses.splice(i, 1);
        continue;
      }
      p.blk.style.transform = `translateX(${x}px)`;
      if (p.bar) p.bar.style.transform = `translateX(${x}px)`;
    }
    requestAnimationFrame(frame);
  }

  spawn();
  if (!reduce) {
    setInterval(() => document.visibilityState === "visible" && spawn(), 1700);
    requestAnimationFrame(frame);
  } else {
    for (let i = 0; i < 4; i++) setTimeout(spawn, i * 50);
    setTimeout(() => frame(performance.now() + 1500), 1400);
  }

  // Son sürümün numarasını ve dosya boyutlarını GitHub'dan güncelle; erişilemezse sayfadaki değerler kalır.
  fetch("https://api.github.com/repos/SonerKeser/Vigila/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((release) => {
      if (!release) return;
      const fmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
      for (const asset of release.assets ?? []) {
        const el = document.querySelector(`[data-size="${CSS.escape(asset.name)}"]`);
        if (el) el.textContent = `${fmt.format(asset.size / 1048576)} MB`;
      }
      const meta = document.querySelector("[data-release]");
      if (meta && release.tag_name) meta.textContent = meta.textContent.replace(/Sürüm [^.]+(\.[0-9]+)*\./, `Sürüm ${release.tag_name.replace(/^v/, "")}.`);
    })
    .catch(() => {});

  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.textContent = "Kopyalandı";
        setTimeout(() => (button.textContent = "Kopyala"), 1600);
      } catch {
        /* pano erişimi yok */
      }
    });
  }
})();
