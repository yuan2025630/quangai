const RENDERER_ORIGIN = "https://renderer.quangai-wallpaper.local";

export class WallpaperPlayback {
  constructor(onError) {
    this.onError = onError;
    this.stage = document.createElement("div");
    this.stage.className = "wallpaper-stage";
    this.stage.setAttribute("aria-hidden", "true");
    document.body.prepend(this.stage);
    this.active = null;
    this.pending = null;
    this.generation = 0;
    this.settings = {};
    this.appearance = {};
    this.blurPaused = !document.hasFocus();
    this.minimized = false;
    window.chrome?.webview?.addEventListener("message", ({ data }) => {
      if (data?.type !== "window-state" || typeof data.isMinimized !== "boolean") return;
      this.minimized = data.isMinimized;
      document.body.dataset.wallpaperMinimized = String(this.minimized);
      this.sync();
    });
    document.addEventListener("visibilitychange", () => this.sync());
    window.addEventListener("blur", () => { this.blurPaused = true; this.sync(); });
    window.addEventListener("focus", () => { this.blurPaused = false; this.sync(); });
    window.addEventListener("pagehide", () => this.destroy());
  }

  shouldPlay() {
    return this.settings.animated && !document.hidden && !this.minimized && !(this.settings.pauseWhenBlurred && this.blurPaused);
  }

  update(settings, appearance) {
    this.settings = settings;
    this.appearance = appearance;
    this.sync();
  }

  sync() {
    const active = this.active;
    if (!active) return;
    const play = this.shouldPlay();
    if (active.video) {
      active.video.playbackRate = this.settings.speed;
      active.video.volume = this.settings.volume / 100;
      active.video.muted = this.settings.volume === 0;
      if (play) active.video.play().catch(error => this.onError(Error(`视频播放失败：${error.message}`)));
      else active.video.pause();
    }
    active.control?.({ play, fit: this.appearance.fit, fps: this.settings.fps, volume: this.settings.volume / 100, speed: this.settings.speed });
    document.body.dataset.wallpaperPlaying = String(Boolean(play && (active.video || active.dynamic)));
  }

  async prepare(wallpaper) {
    const generation = ++this.generation;
    this.pending?.destroy();
    const layer = document.createElement("div");
    layer.className = "wallpaper-layer wallpaper-loading";
    const resource = { layer, destroy: () => { layer.remove(); } };
    this.pending = resource;
    this.stage.append(layer);
    try {
      if (wallpaper.baseUrl) {
        await this.prepareRenderer(resource, wallpaper);
      } else if (wallpaper.video || wallpaper.videoBlob) {
        await this.prepareVideo(resource, wallpaper);
      } else if (wallpaper.src) {
        await this.prepareImage(resource, wallpaper.src);
      }
      if (generation !== this.generation) throw Error("壁纸切换已取消。");
      return resource;
    } catch (error) {
      resource.destroy();
      if (this.pending === resource) this.pending = null;
      throw error;
    }
  }

  commit(resource) {
    const previous = this.active;
    previous?.destroy();
    this.active = resource;
    this.pending = null;
    resource.layer.classList.remove("wallpaper-loading");
    if (resource.video) resource.video.id = "wallpaper-video";
    this.sync();
  }

  prepareImage(resource, src) {
    const image = new Image();
    image.alt = "";
    image.className = "wallpaper-media";
    resource.layer.append(image);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => done(Error("壁纸图片读取超时。")), 15000);
      function done(error) {
        clearTimeout(timeout);
        image.onload = image.onerror = null;
        if (error) reject(error); else resolve();
      }
      image.onload = () => done();
      image.onerror = () => done(Error("壁纸图片已丢失或无法读取。"));
      resource.destroy = () => { done(Error("壁纸切换已取消。")); image.removeAttribute("src"); resource.layer.remove(); };
      image.src = src;
    });
  }

  prepareVideo(resource, wallpaper) {
    const video = document.createElement("video");
    Object.assign(video, { className: "wallpaper-media", loop: true, muted: true, playsInline: true, preload: "auto" });
    if (wallpaper.src) video.poster = wallpaper.src;
    resource.video = video;
    resource.layer.append(video);
    const url = wallpaper.videoBlob ? URL.createObjectURL(wallpaper.videoBlob) : wallpaper.video;
    let cancel;
    resource.destroy = () => {
      cancel?.(); video.pause(); video.removeAttribute("src"); video.load(); resource.layer.remove();
      if (wallpaper.videoBlob) URL.revokeObjectURL(url);
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => done(Error("视频首帧读取超时，请使用 MP4（H.264）或 WebM。")), 25000);
      const failed = () => done(Error(`视频无法解码（${video.error?.code ?? "未知错误"}），请换用 MP4（H.264）或 WebM。`));
      const loaded = () => done();
      function done(error) {
        clearTimeout(timeout); video.removeEventListener("loadeddata", loaded); video.removeEventListener("error", failed);
        cancel = null;
        if (error) reject(error); else resolve();
      }
      cancel = () => done(Error("壁纸切换已取消。"));
      video.addEventListener("loadeddata", loaded, { once: true });
      video.addEventListener("error", failed, { once: true });
      video.src = url;
    }).then(() => {
      video.addEventListener("error", () => this.onError(Error("当前视频已无法播放，请重新选择壁纸。")));
    });
  }

  prepareRenderer(resource, wallpaper) {
    const frame = document.createElement("iframe");
    const token = crypto.randomUUID();
    frame.className = "wallpaper-media wallpaper-renderer";
    frame.title = "动态壁纸渲染器";
    frame.sandbox = "allow-scripts allow-same-origin";
    frame.setAttribute("allow", "autoplay");
    const media = wallpaper.kind === "video" || wallpaper.kind === "image";
    resource.dynamic = wallpaper.kind !== "image";
    const url = new URL(media ? "/media.html" : "/scene.html", RENDERER_ORIGIN);
    url.searchParams.set("source", wallpaper.baseUrl);
    if (media) {
      url.searchParams.set("media", wallpaper.video ?? wallpaper.src);
      url.searchParams.set("kind", wallpaper.kind);
    }
    url.searchParams.set("token", token);
    frame.src = url.href;
    resource.control = options => frame.contentWindow?.postMessage({ type: "wallpaper-control", token, ...options }, RENDERER_ORIGIN);
    return new Promise((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => finish(Error("壁纸首帧读取超时，请选择其他壁纸。")), 45000);
      function finish(error) {
        clearTimeout(timeout);
        if (error) reject(error); else { ready = true; resolve(); }
      }
      const receive = event => {
        if (event.origin !== RENDERER_ORIGIN || event.source !== frame.contentWindow || event.data?.token !== token) return;
        if (event.data.type === "wallpaper-ready") {
          resource.layer.dataset.renderer = event.data.kind;
          finish();
        } else if (event.data.type === "wallpaper-error") {
          const error = Error(`壁纸加载失败：${event.data.message}`);
          if (ready) this.onError(error); else finish(error);
        }
      };
      window.addEventListener("message", receive);
      resource.destroy = () => {
        clearTimeout(timeout); window.removeEventListener("message", receive);
        resource.control({ destroy: true }); frame.remove(); resource.layer.remove();
        if (!ready) reject(Error("壁纸切换已取消。"));
      };
      resource.layer.append(frame);
    });
  }

  destroy() {
    ++this.generation;
    this.pending?.destroy(); this.active?.destroy();
    this.pending = this.active = null;
  }
}
