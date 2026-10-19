# 參與編輯

GPS-HKU 係放喺 GitHub Pages 嘅靜態網站。所有內容都係普通檔案，直接喺 github.com 就改到，唔使識寫程式。

## 喺地圖標示大樓

1. 開啟 [3D 地圖](map)，按 **✎ 編輯**。
2. 點選你認得嘅大樓，會顯示佢嘅模型 ID，例如 `B322421612701063C0`。
3. 喺「將此大樓標示為…」揀返對應地點。一個地點可以有幾座大樓，例如百周年校園。
4. 標示完其他大樓之後，按**匯出 places.json**。
5. 喺 GitHub 打開 `data/places.json`，按 ✎，貼上匯出嘅檔案，然後 commit。

列表冇你要嘅地點？喺 `data/places.json` 加一項：

```
{ "id": "my-place", "cat": "amenity",
  "name": { "en": "My Place", "zh": "我的地方" },
  "desc": { "en": "Short description", "zh": "簡短介紹" },
  "buildings": [], "floors": [] }
```

## 編輯指南頁面

每頁底部都有 **✎ 在 GitHub 編輯此頁** 連結。頁面係 `content/zh/` 同 `content/en/` 入面嘅 Markdown 檔案，側欄喺 `content/nav.json` 設定。

## 檔案結構

```
index.html            網站框架
assets/               app.js（網站）、map.js（3D 檢視器）、app.css
assets/model/         hku.glb（已優化 3D 校園）+ buildings.json
content/en, zh        指南頁面（Markdown）
content/nav.json      側欄章節
data/places.json      地點、地圖標籤、平面圖列表
data/routes.json      步行路線
floorplans/           平面圖圖片
model/                由 3dmap.gov.hk 下載嘅原始檔案
tools/                由 model/ 重新生成 hku.glb 嘅程式
```

## 重新生成 3D 模型

如果你由地政總署 3D 平台下載咗更多圖幅，將 zip 放入 `model/`，再執行 `tools/` 入面嘅程式，詳見 `tools/README.md`。
