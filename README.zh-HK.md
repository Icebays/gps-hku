# GPS-HKU

[![Live site](https://img.shields.io/badge/live-icebays.github.io%2Fgps--hku-0f4c3a?style=for-the-badge&logo=googlemaps&logoColor=white)](https://icebays.github.io/gps-hku/)
[![Copyright: all rights reserved](https://img.shields.io/badge/copyright-all%20rights%20reserved-c62828?style=for-the-badge)](LICENSE)
[![three.js](https://img.shields.io/badge/three.js-3D-000000?style=for-the-badge&logo=threedotjs&logoColor=white)](https://threejs.org/)
[![English · 繁體中文](https://img.shields.io/badge/English%20%C2%B7%20%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87-1971c2?style=for-the-badge)](https://icebays.github.io/gps-hku/)
[![Last commit](https://img.shields.io/github/last-commit/icebays/gps-hku?style=for-the-badge)](https://github.com/icebays/gps-hku/commits/main)

[English](README.md) · **繁體中文**

香港大學 3D 地圖、步行及平面圖指南。

**網站：** https://icebays.github.io/gps-hku/

## 宣傳片

https://github.com/user-attachments/assets/64d3104e-427e-4a7b-9d8e-738cbeb77997

影片於網站實機拍攝；天氣鏡頭中的暴雨及雷暴警告為示範資料，並非當日真實天氣。原創配樂，音效來自
[Mixkit](https://mixkit.co/license/#sfxFree)。

## 為甚麼要有 GPS-HKU

港大依山而建。一座大樓的「地下」可能比隔壁高出或低出好幾層；舊主校園與百周年校園之間靠天橋、平台、升降機塔及上下兩層的大學街連接；港鐵站更深藏山底。一張平面地圖表達不到這些。GPS-HKU 以地政總署的測量數據，按真實比例把校園以 3D 呈現，讓你一眼看清哪一層才是地面、天橋通往哪裏、哪部升降機能帶你上山。

## 功能

**以 3D 探索港大**
- 主校園、百周年校園、沙宣道校園、蒲飛路校園（興建中）、各宿舍及周邊街道，像 Google Earth 一樣按畫面逐塊載入，只下載看得見的部分。
- 港大建築以實體顯示，其他建築則半透明，校園一目了然。
- 高度以主水平基準以上米數（mPD）標示，方便比較兩座建築在山坡上的高低。

**三種外觀**
- **地圖**：簡潔地圖，有地勢陰影、每 10 米等高線、道路、行人路及路面標記。
- **深色模式**：同一地圖的夜間版，深色地面配灰色建築。
- **衛星**：航空照片、附相片紋理的港大建築、相片路面及立體樹冠。

**真實天空（衛星模式）**
- 天空跟隨太陽於港大上空的真實位置：日間藍天，之後是金黃時刻、日落、藍調時刻及夜晚。
- 雲及雨跟隨香港天文台的即時天氣：晴天無雲，轉陰時雲量增加，下雨時有灰色雨雲，雨勢按中西區過去一小時雨量（或暴雨警告）而定。
- 天色會照在建築及地面上：日落偏暖、黃昏偏藍、入夜變暗。

**太陽、影子及天氣**
- 太陽位於此刻的真實位置；建築、天橋及樹木投下柔和影子，有雲或下雨時影子會變淡。
- 左下角的天氣顯示氣溫、濕度、本區雨量及所有生效中的警告：熱帶氣旋警告信號、暴雨（黃、紅、黑）、雷暴、酷熱或寒冷天氣、強烈季候風、火災危險、山泥傾瀉、水浸、霜凍及海嘯。每 10 分鐘更新。

**搜尋地點**
- 共 160 個地點：港大官方校園地圖上的所有建築，以及圖書館、宿舍、餐廳、港鐵出口及地標，按類別配以圖示。
- 各校園及宿舍群（賽馬會舍堂村及學生村、沙宣道舍堂、薄扶林道宿舍等）於地面上以框線圈出並標示名稱。
- 可以中文或英文名稱、或港大校園地圖上的編號搜尋；地圖會飛到該處並以金色標示。按 `/` 即可跳到搜尋框。
- 地點較密時，標籤會收起成圓形圖示；各類別可自行顯示或隱藏。

**3D 樓層平面圖**
- **總圖書館**（舊翼及新翼，G 至 6 樓）、**百周年校園**平台（CPD LG 至 4 樓，附每個課室的編號及座位數），以及港鐵**香港大學站**、**西營盤站**及**堅尼地城站**。
- 選擇樓層後，建築會在該層以上剖開：自修區、書架、桌椅、樓梯、洗手間、升降機、走火通道及打印機均按真實高度繪出。
- 車站的地底樓層以 X 光方式透過淡化的地圖顯示，包括月台、大堂、閘機、扶手電梯、出口及升降機井。

**港鐵**
- 香港大學站、西營盤站及堅尼地城站的每個出口，按港鐵指示牌標示出口編號；港島綫按路軌的真實深度繪出。

**餐廳**
- 港大膳食服務的全部 26 間餐廳、飯堂及咖啡店都在地圖上；大樓的資料卡會列出其中的餐廳。
- 每間都有相片、服務模式、食物種類、營業時間及詳情連結。
- **網上點餐**：其中 14 間提供網上點餐，按鈕會開啟餐廳自己的點餐頁面。
- **掃描枱號**：坐低後，在資料卡按「掃描枱號」，用相機對準枱上的 QR Code，即可開啟該枱的點餐頁面。

**你的位置**
- 🎯 以平放在地面的藍點顯示你的 GPS 位置，並有隨你面向而轉動的光束。位置資料不會離開你的手機。

**指南**
- 中英文指南：前往港大的方法、上下大學街、升降機及無障礙路線、建築目錄、樓層平面圖、步行路線及地圖操作。
- 步行路線會繪在 3D 地形上，附距離、爬升高度及步行時間。路線由維護者實地走過後才加入，目前尚未發佈。

**分享及隨處使用**
- 網址會跟隨你正在看的地方（例如 `#/zh/map?place=main-library&floor=2`），分享連結即可開啟同一地點及樓層。
- 以手機為先：支援 Google / Apple 地圖手勢（拖動、雙指縮放、旋轉、雙指傾斜、雙擊放大），並為 iPhone 控制記憶體用量。提供英文及繁體中文、淺色及深色模式。

## 地圖操作

| 動作 | 滑鼠 | 觸控 |
|---|---|---|
| 移動 | 左鍵拖動 | 單指拖動 |
| 旋轉／傾斜 | 右鍵拖動（或 Ctrl + 拖動） | 雙指扭動旋轉；雙指一同向上或向下推以傾斜 |
| 縮放 | 滾輪 | 雙指開合，或雙擊後按住再拖動；雙擊放大 |
| 選擇建築 | 點擊 | 輕按 |

| 按鈕 | 功能 |
|---|---|
| 🧭 指南針 | 北向上；再按一次面向南 |
| ↺ 重設 | 返回起始視角，如港大校園地圖般面向南 |
| ◇ 平面／3D | 由上而下的「平面圖」視角或傾斜 3D 視角 |
| 🎯 位置 | 你的 GPS 位置及面向 |
| ⤴ 路線 | 步行路線 |
| 圖層 | 地圖、地圖加真實建築或衛星 |
| 篩選 | 顯示或隱藏地點類別 |
| ☾（頂欄） | 淺色或深色模式 |

## 在本機運行

純靜態網站，無需建置（three.js，無框架）：

```bash
python3 -m http.server 8000   # 然後開啟 http://localhost:8000
```

網站以 GitHub Pages 發佈（Settings → Pages → *Deploy from a branch* → `main` / `(root)`）。

## 檔案位置

| | |
|---|---|
| `index.html`、`assets/` | 網站：`app.js`（頁面）、`map.js`（3D 地圖）、`tiles.js`（分塊載入）、`indoor.js`（平面圖）、`sky.js`（衛星模式天空）、`roads.js`、`icons.js`、`weather.js` |
| `content/en`、`content/zh` | 指南頁面（Markdown） |
| `data/places.json` | 地點：建築、餐廳、港鐵出口及其模型建築編號 |
| `data/campus.json` | 校園及宿舍群範圍、港大建築 |
| `data/indoor/` | 樓層平面圖 |
| `data/eateries.json`、`data/mtr-lines.json`、`data/routes.json` | 餐廳資料、港鐵綫、步行路線 |
| `assets/tiles/`、`assets/model/` | 3D 分塊及模型 |
| `tools/` | 以上各項如何由原始數據製作（見 `tools/README.md`） |
| `vendor/` | three.js、marked、jsQR（瀏覽器沒有內置 QR 讀取時用於掃描枱號） |
| `promo/` | 宣傳片 |

網站只由維護者編輯，不設公開編輯。網站模組更新時，請同時更新 `index.html` import map 內的 `?v=` 版本號，避免手機混用新舊檔案。

## 資料來源

- 三維空間數據及三維室內地圖（IMDF）© 香港特別行政區政府地政總署
- 建築及地點：港大校園地圖（maps.hku.hk）；餐廳：港大膳食服務（catering.hku.hk），相片連結自該網站
- 樓層平面圖：按港大圖書館平面圖及港大考試處 CPD 課室平面圖重繪
- 港鐵出口及路綫、道路及小徑：© OpenStreetMap 貢獻者（ODbL）
- 天氣及警告：香港天文台
- QR 讀取：[jsQR](https://github.com/cozmo/jsQR)（Apache-2.0）

GPS-HKU 為非官方學生項目，與香港大學及香港鐵路有限公司並無關連。

## 版權

© 2026 icebays。版權所有，保留一切權利。GPS-HKU 並非開源項目：未經本人事先書面許可，不得複製、修改、分發或使用本項目任何部分，
亦不允許商業用途。使用前請先透過 [issue](https://github.com/icebays/gps-hku/issues) 查詢。第三方材料保留其原有條款。詳見
[LICENSE](LICENSE)。
