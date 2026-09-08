# -*- coding: utf-8 -*-
"""
说话人扫描 —— 一份录音里是不是只有一个人

    cd D:/GPT-SoVITS-v2pro-20250604
    PYTHONUTF8=1 ./runtime/python.exe -s <本脚本> <音频1> [音频2 ...]

用整合包自带的 **ERes2NetV2 声纹模型**（`pretrained_models/sv/`，
v2Pro 训练本来就要用它）。逐 2 秒算一个嵌入，跟全片的重心比余弦相似度，
**不像的那些窗口就是别人**。

为什么不用基频判：2026-09-08 试过，四段素材的 F0 在正文里本身就在 94~156Hz
之间跳（自然的语调起伏），拿 F0 分辨说话人会**全部误报**。声纹嵌入才是为这件事做的。

⚠ 混进第二个人的声音对克隆是**致命**的 —— 比噪声严重得多。
噪声只是脏，第二个人是**教模型学一个不存在的混合音色**。
"""
import os
import sys

sys.path.append(os.getcwd())
sys.path.append(os.path.join(os.getcwd(), "GPT_SoVITS"))
sys.path.append(os.path.join(os.getcwd(), "GPT_SoVITS", "eres2net"))

import torch
import torchaudio
import numpy as np
from ERes2NetV2 import ERes2NetV2
import kaldi as Kaldi

SV_PATH = "GPT_SoVITS/pretrained_models/sv/pretrained_eres2netv2w24s4ep4.ckpt"
WIN = 2.0        # 每个窗口 2 秒 —— 再短声纹不稳，再长会把切换点糊掉
HOP = 1.0
SR = 16000       # 这个模型吃 16k


def load_model():
    state = torch.load(SV_PATH, map_location="cpu")
    m = ERes2NetV2(baseWidth=24, scale=4, expansion=4)
    m.load_state_dict(state)
    m.eval()
    return m


def embed(model, wav):
    """wav: 1-D tensor，16k，-1~1"""
    with torch.no_grad():
        feat = torch.stack([Kaldi.fbank(wav.unsqueeze(0), num_mel_bins=80,
                                        sample_frequency=SR, dither=0)])
        return model.forward3(feat).squeeze(0).flatten()


def scan(model, path):
    wav, sr = torchaudio.load(path)
    if wav.shape[0] > 1:
        wav = wav.mean(0, keepdim=True)
    if sr != SR:
        wav = torchaudio.transforms.Resample(sr, SR)(wav)
    x = wav[0]
    n = int(WIN * SR)
    h = int(HOP * SR)
    embs, times, lv = [], [], []
    for s in range(0, len(x) - n, h):
        seg = x[s:s + n]
        rms = float(torch.sqrt((seg ** 2).mean()))
        # 太安静的窗口没有声纹可言，跳过
        if rms < 0.005:
            continue
        embs.append(embed(model, seg).numpy())
        times.append(s / SR)
        lv.append(20 * np.log10(max(rms, 1e-9)))
    if not embs:
        return None
    E = np.stack(embs)
    E = E / (np.linalg.norm(E, axis=1, keepdims=True) + 1e-9)
    # 重心用**中位数**不用均值 —— 均值会被离群的那几个窗口拽过去
    c = np.median(E, axis=0)
    c /= np.linalg.norm(c) + 1e-9
    sim = E @ c
    return np.array(times), sim, np.array(lv)


def main():
    files = sys.argv[1:]
    if not files:
        print("用法: python 说话人扫描.py <音频...>")
        return
    model = load_model()
    for f in files:
        r = scan(model, f)
        if r is None:
            print(f"{f}  没有够响的窗口")
            continue
        t, sim, lv = r
        med = float(np.median(sim))
        # ⚠ 报告里必须带**文件名和时长** —— 2026-09-08 踩过：
        # 只印 v1/v2 这种代号，看报告的时候靠文件名排序去猜对应关系，猜反了两次。
        # 手上有能对上的数（时长、窗口数）就别猜。
        dur = float(t[-1] + WIN) if len(t) else 0.0
        # 判据：低于「中位数 − 4×MAD」且绝对值也偏低的窗口，算「不是同一个人」
        mad = float(np.median(np.abs(sim - med))) or 1e-6
        thr = med - 4 * mad
        bad = [(t[i], sim[i]) for i in range(len(sim)) if sim[i] < thr]
        print(f"\n{os.path.basename(f)}　（约 {dur:.0f}s，窗口 {len(sim)} 个）")
        print(f"  相似度中位 {med:.3f}　MAD {mad:.4f}　阈值 {thr:.3f}")
        print("  开头 12 秒逐窗:", " ".join(f"{sim[i]:.2f}" for i in range(min(12, len(sim)))))
        if bad:
            # 合并成区间
            segs = []
            for tt, ss in bad:
                if segs and tt - segs[-1][1] <= HOP * 1.5:
                    segs[-1][1] = tt + WIN
                    segs[-1][2] = min(segs[-1][2], ss)
                else:
                    segs.append([tt, tt + WIN, ss])
            print(f"  ⚠ {len(segs)} 段疑似别人:")
            for a, b, s in segs[:12]:
                print(f"     {a:6.1f}s ~ {b:6.1f}s   相似度 {s:.3f}")
        else:
            print("  ✅ 全程同一个人")


main()
