# /// script
# requires-python = ">=3.11"
# dependencies = ["torch>=2.4", "numpy"]
# ///
"""
Pop-out footage: follow the dancer in a landscape clip with a 9:16 window and cut them out.

  uv run matte.py <src.mp4> <out-stem> --in 2.0 --seconds 6 [--model rvm.torchscript]

Writes <out-stem>.mp4 (the 1080x1920 window that follows the person, at the source frame
rate) and <out-stem>.alpha.mp4 (the person's matte as grey, same size and frames), for
montage.ts to build the pop-out shot from. Matting is Robust Video Matting (GPL-3.0 model,
run locally, nothing is shipped with the video), whose recurrent state keeps the matte
steady from frame to frame.

Two passes: a quick low-resolution matte finds where the person is in every frame, and the
window's centre follows that track, smoothed so the camera glides instead of jittering; the
second pass mattes the window itself at full resolution.
"""
import argparse
import json
import subprocess

import numpy as np
import torch
import torch.nn.functional as F

p = argparse.ArgumentParser()
p.add_argument("src")
p.add_argument("out")
p.add_argument("--in", dest="start", type=float, default=0.0)
p.add_argument("--seconds", type=float, required=True)
p.add_argument("--model", default="/tmp/rvm/rvm_resnet50_fp32.torchscript")
p.add_argument("--width", type=int, default=1080)
p.add_argument("--height", type=int, default=1920)
a = p.parse_args()

info = json.loads(subprocess.run(
    ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "json", a.src],
    check=True, capture_output=True).stdout)["streams"][0]
W, H, rate = info["width"], info["height"], info["r_frame_rate"]
device = "mps" if torch.backends.mps.is_available() else "cpu"
model = torch.jit.load(a.model, map_location="cpu").eval()
try:
    model = model.to(device)
except Exception:
    device = "cpu"


def frames(width, height):
    cmd = ["ffmpeg", "-v", "error", "-ss", str(a.start), "-t", str(a.seconds), "-i", a.src,
           "-vf", f"scale={width}:{height}:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = width * height * 3
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        yield torch.from_numpy(np.frombuffer(buf, np.uint8).reshape(height, width, 3).copy())
    proc.wait()


def matte(rgb, rec, ratio):
    src = rgb.permute(2, 0, 1).unsqueeze(0).float().div(255).to(device)
    fgr, pha, *rec = model(src, *rec, ratio)
    return pha[0, 0].clamp(0, 1).cpu(), rec


# Pass 1: where is the person? Alpha-weighted centre of mass at 960 px wide.
tw, th = 960, round(960 * H / W / 2) * 2
centres = []
rec = [None] * 4
with torch.no_grad():
    for rgb in frames(tw, th):
        pha, rec = matte(rgb, rec, 0.5)
        mass = pha.sum(0)
        total = float(mass.sum())
        centres.append(float((mass * torch.arange(tw)).sum()) / total / tw if total > 50 else (centres[-1] if centres else 0.5))
n = len(centres)
if n == 0:
    raise SystemExit("no frames decoded")

# A camera that glides: a wide moving average, then the window clamped inside the frame.
cw = round(H * a.width / a.height / 2) * 2  # window width in source pixels
k = max(1, round(n / 6))
padded = np.pad(np.array(centres), k, mode="edge")
smooth = np.convolve(padded, np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k]
xs = np.clip(np.round(smooth * W - cw / 2), 0, W - cw).astype(int)

# Pass 2: crop the window from the full-resolution frame and matte it.
enc = lambda path, pix: subprocess.Popen(
    ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", pix, "-s", f"{a.width}x{a.height}", "-r", rate, "-i", "-",
     "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", path], stdin=subprocess.PIPE)
out_rgb = enc(f"{a.out}.mp4", "rgb24")
out_pha = enc(f"{a.out}.alpha.mp4", "gray")
rec = [None] * 4
with torch.no_grad():
    for i, rgb in enumerate(frames(W, H)):
        x = int(xs[min(i, n - 1)])
        win = rgb[:, x:x + cw].permute(2, 0, 1).unsqueeze(0).float()
        win = F.interpolate(win, size=(a.height, a.width), mode="bicubic", antialias=True, align_corners=False)
        win = win[0].permute(1, 2, 0).clamp(0, 255).round().to(torch.uint8)
        pha, rec = matte(win, rec, 0.25)
        out_rgb.stdin.write(win.numpy().tobytes())
        out_pha.stdin.write((pha * 255).round().to(torch.uint8).numpy().tobytes())
for proc in (out_rgb, out_pha):
    proc.stdin.close()
    proc.wait()
print(json.dumps({"out": a.out, "frames": n, "device": device, "window": cw, "x": [int(xs[0]), int(xs.min()), int(xs.max())]}))
