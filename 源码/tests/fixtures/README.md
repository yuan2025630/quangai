# 测试素材

`wallpaper.webm` 是 FFmpeg `testsrc2` 生成的 320 × 180、10 FPS、两秒无声 VP9 测试画面，用于真实视频解码、静音与循环播放回归，不含 Wallpaper Engine 或其他第三方壁纸素材。

生成命令：

```powershell
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=10 -t 2 -an -c:v libvpx-vp9 -b:v 40k wallpaper.webm
```
