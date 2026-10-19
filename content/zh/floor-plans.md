# 關於平面圖

[大樓索引](buildings)入面每座大樓都可以有平面圖。瀏覽時可以拖動移動、用滾輪或雙指縮放，雙擊就會自動調整大小。

## 加入平面圖

1. 將每層匯出成圖片（PNG、JPG 或 WebP），闊約 2000 px 已經夠。如果係 PDF，就逐頁匯出成圖片。
2. 上載到 `floorplans/<地點 id>/`，例如 `floorplans/main-building/GF.png`。
3. 喺 `data/places.json` 對應大樓嘅 `floors` 加入：

```
"floors": [
  { "label": "LG1", "src": "floorplans/main-building/LG1.png" },
  { "label": "G/F", "src": "floorplans/main-building/GF.png" },
  { "label": { "en": "1/F", "zh": "一樓" }, "src": "floorplans/main-building/1F.png" }
]
```

樓層會按你列出嘅次序以分頁顯示。

> [!WARNING]
> 只上載你有權分享嘅平面圖，例如你自己畫嘅，或者公開發佈嘅。請勿上載內部或涉及保安嘅圖則。
