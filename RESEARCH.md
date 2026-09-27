# 擲筊 研究筆記 / Research notes

These are the references behind the model, physics, sound and wording in the app. They were compiled from about 60 pages in Traditional Chinese and English, plus direct viewing of the Wikimedia Commons photos.

## 1. The object: 筊杯 (桮, poe, moon blocks)

- **Shape**
  - Each block is a crescent (半月形) with "一面平坦、另一面中間凸出" (one flat face, one bulging face). [zh.wikipedia 筊杯](https://zh.wikipedia.org/zh-hk/%E7%AD%8A%E6%9D%AF)
  - The two blocks are the halves of one split body: originally a clam shell or a bamboo root, today mostly wood.
  - A museum record describes a split bamboo pair: "中央圓凸而兩端呈尖椎體…成為一面平坦而另一面浮凸之形式，呈現新月外型". [文化部典藏 NMTH 2006.003.0191](https://collections.culture.tw/Object.aspx?RNO=MjAwNi4wMDMuMDE5MQ%3D%3D&SYSUID=11)
- **Size and weight (medium temple block)**
  - NTM specimen AH000779-001: 11.3 × 4.9 × 2.6 cm, 50 g; its partner is 10.5 × 4.5 × 2.2 cm, 30 g. [國立臺灣博物館](https://collections.culture.tw/ntm_collectionsweb/collection.aspx?GID=MPMEMFMLMD)
  - Retail medium blocks are 9–10.3 cm long.
  - **The model uses 11.7 × 5.2 × 2.28 cm and 44.6 g** (camphor-like wood at 650 kg/m³).
- **Finish**
  - Blocks are red lacquered (「木製，半月狀，紅色」).
  - At 艋舺龍山寺 the flat faces were painted gold/yellow (2009 photo). By 2019 they were worn to grey-brown wood.
  - Paint wears first at the crown of the rounded back and at the tips, which are the parts that strike the floor.
  - The model's worn red back and gold flat face follow these photos. This also makes each face easy to read on screen.
- **Faces**
  - Mainstream Taiwan usage: flat = 陽 (仰), convex = 陰 (俯). Sources: [行天宮](https://www.ht.org.tw/religion207.htm), [ETtoday](https://www.ettoday.net/news/20160206/643813.htm), [客語辭典 陰筊](https://hakkadict.moe.edu.tw/search_result/?id=3449&accent=6).
  - Some Hong Kong and online sources reverse the naming. The app therefore labels each outcome by which physical face is up.

## 2. Procedure

1. Offer incense.
2. State your 姓名、農曆生辰、住址, and one yes/no matter at a time. Sources: [行天宮](https://www.ht.org.tw/religion207.htm), [艋舺龍山寺](https://www.lungshan.org.tw/Tour_Guide/how_to_prays).
3. Cup the blocks in both hands, flat faces up "如蝴蝶形狀" (like a butterfly). Raise them "至眉心間" (to between the eyebrows) and toss them slightly upward so they fall to the floor ("投空擲地"). Sources: [行天宮](https://www.ht.org.tw/religion207.htm), [高雄三鳳宮](https://www.sunfong.org.tw/?act=menuinfo&ml_id=20220720011).
   - The app follows this sequence: raise to the brow, pause, toss.
4. Throw kneeling on a 拜墊 or standing. The blocks land on the hall floor about 1–2 m in front of the offering table.

## 3. Readings (as shown in the app)

| 筊象 | Faces | Meaning |
|---|---|---|
| 聖筊 | one flat, one convex | 神明應允 (yes) |
| 笑筊 | both flat faces up | 神明笑而不答: restate the question and throw again |
| 陰筊 | both convex faces up | 神明不允 (no). Also called 怒筊, 蓋筊 |
| 立筊 | a block stands on its edge or tip | extremely rare; taken as a sign from the deity |

- **三聖筊**
  - Three consecutive 聖筊 confirm important matters.
  - When drawing a 籤 at 龍山寺, you need one 聖筊 to draw, then three consecutive 聖筊 to confirm the stick. [lungshan.org.tw](https://www.lungshan.org.tw/Tour_Guide/how_to_prays)
  - 行天宮 settles a 籤 with a single 聖筊.
- **Physics check**
  - Measured data: in a 1,000-toss science-fair test the convex face landed up 52.9% of the time, and 聖筊 came out at about 50%. [鳴人堂](https://opinion.udn.com/opinion/story/8159/1317267)
  - Simulation: 400 seeded throws with the app's physics (`npm run sim -- 400`) gave 聖 52.0%, 笑 28.0%, 陰 20.0%.

## 4. Where and when

- **Where:** Taiwan, southern Fujian, 潮汕, Hong Kong, Singapore, Malaysia and Yokohama; in temples and in home shrines.
- **Deities and occasions**
  - 媽祖, 關聖帝君, 觀音, 月老 and 土地公.
  - 月老 at 龍山寺 requires 三聖筊 before you take a 紅線.
- **大甲鎮瀾宮**
  - The 媽祖遶境 date is fixed by 擲筊 every 元宵.
  - 2026: settled in two throws on 3 March; departure (起駕) 17 April 2026 at 22:05. Sources: [Focus Taiwan](https://focustaiwan.tw/culture/202603030027), [UDN](https://udn.com/news/story/7325/9401555).
- **元宵 擲筊比賽**
  - 西螺新天宮 2025: a 6-year-old won an EV with 12 consecutive 聖筊. [TDN](https://news.st-media.com.tw/news/45542)
  - 澎湖 乞龜 2025: rice and gold turtles won with 8 consecutive 聖杯. [CNA](https://www.cna.com.tw/news/aloc/202502150058.aspx)

## 5. Sound

- Blocks are "擲地有聲". Bamboo root blocks give "響亮清脆" (a loud, crisp sound). [國家文化記憶庫](https://tcmb.culture.tw/zh-tw/detail?indexCode=MOCCOLLECTIONS&id=17120007180)
- English descriptions: "Clackety-clack" on 北港's floor ([HuffPost](https://www.huffpost.com/rachel-chang/testing-the-fates-at-chao_b_3941928.html)); "crisp clatter".
- How the app makes this sound:
  - Each impact is synthesised with modal synthesis: the Rapier contact impulse gives Δv, which sets loudness and brightness.
  - The block has 5–6 damped modes starting at about 1.7 kHz, and the stone adds a low knock.
  - Scrapes play only while the contact point actually slips.
  - A convolution reverb models a stone-and-timber hall.

## 6. Photos (Wikimedia Commons, CC BY / BY-SA)

- [Category:Jiaobei](https://commons.wikimedia.org/wiki/Category:Jiaobei)
- Blocks at Lungshan Temple:
  - [Box of Jiaobei, Bangka Lungshan Temple 2009](https://commons.wikimedia.org/wiki/File:2009-12-28_box_of_Jiaobei_at_Bangka_Lungshan_Temple.jpg): red backs, gold flat faces.
  - [Moon blocks at Lungshan Temple](https://commons.wikimedia.org/wiki/File:Moon_blocks_at_Lungshan_Temple.jpg): worn blocks on a plate.
  - [龍山寺 280周年](https://commons.wikimedia.org/wiki/File:11.27_%E7%B8%BD%E7%B5%B1%E5%87%BA%E5%B8%AD%E3%80%8C%E9%BE%8D%E5%B1%B1%E5%AF%BA%E5%BB%BA%E5%AF%BA280%E5%91%A8%E5%B9%B4%E7%B4%80%E5%BF%B5%E3%80%8D_%2849131261462%29.jpg): wear close-up.
- Other blocks:
  - [擲筊 stacked blocks](https://commons.wikimedia.org/wiki/File:%E6%93%B2%E7%AD%8A_(4684775644).jpg)
  - [Jiaobei in Yuanbao Temple, Taichung](https://commons.wikimedia.org/wiki/File:Jiaobei_in_Yuanbao_Temple,_Taichung.jpg)
  - [Poe at Yokohama Mazu Temple](https://commons.wikimedia.org/wiki/File:Poe_(Jiaobei)_at_Yokohama_Mazimiao.jpg)
  - [Longmen Guanyin Temple 14](https://commons.wikimedia.org/wiki/File:Longmen_Guanyin_Temple_14_%E7%AD%8A%E6%9D%AF.jpg)
  - [Taichung North City God Temple 28](https://commons.wikimedia.org/wiki/File:Taichung_North_City_God_Temple_28_%E7%AD%8A%E6%9D%AF.jpg)
  - [布袋鎮天宮 23](https://commons.wikimedia.org/wiki/File:%E5%B8%83%E8%A2%8B%E9%8E%AE%E5%A4%A9%E5%AE%AE_Budai_Zhantian_Temple_23_%E7%AD%8A%E6%9D%AF.jpg)
- 立筊 and throwing:
  - [濟安宮 立杯 (立筊)](https://commons.wikimedia.org/wiki/File:%E6%BF%9F%E5%AE%89%E5%AE%AE%E7%AB%8B%E6%9D%AF.jpg)
  - [Right Answer: picking up blocks from a stone floor](https://commons.wikimedia.org/wiki/File:Right_Answer.jpg)
  - [陰陽堂 元宵擲杯](https://commons.wikimedia.org/wiki/File:%E9%99%B0%E9%99%BD%E5%A0%82%EF%BD%9C%E6%88%8A%E6%88%8C%E5%85%83%E5%AE%B5%E6%93%B2%E6%9D%AF_03.jpg)
  - [瓦硐南天廟 擲杯](https://commons.wikimedia.org/wiki/File:%E7%93%A6%E7%A1%90%E5%8D%97%E5%A4%A9%E5%BB%9F_(18)%E7%A5%9E%E6%98%8E%E5%BB%B3%E3%80%81%E6%93%B2%E6%9D%AF.jpg)
- Temple interiors:
  - [Lukang Mazu Temple main hall](https://commons.wikimedia.org/wiki/File:Interior_of_the_Main_Hall,_Lugang_Mazu_Temple-01.2023-07-13.jpg)
  - [鹿港天后宮 正殿](https://commons.wikimedia.org/wiki/File:%E9%B9%BF%E6%B8%AF%E5%A4%A9%E5%90%8E%E5%AE%AE%E6%AD%A3%E6%AE%BF.jpg)
  - [Dajia Jenn Lann Temple interior](https://commons.wikimedia.org/wiki/File:Interior_of_the_Dajia_Jenn_Lann_Temple-01.2024-08-27.jpg)

## 7. Videos

- [2026 大甲 筊筶典禮](https://www.youtube.com/watch?v=y402jtZswQU): the chairman throws to set the pilgrimage date.
- [西螺新天宮 12 聖杯 wins an EV](https://www.youtube.com/watch?v=tg06hxBVQFQ)
- [東森: 西螺新天宮 擲筊賽](https://www.youtube.com/watch?v=vMZZ4RmozWA)
- [TVBS 黏筊](https://www.youtube.com/watch?v=ekrW2rDpafk)
- [民視 彰化地藏庵 立筊](https://www.youtube.com/watch?v=j5C1UTktC-k)
- [宜蘭進安宮 立筊](https://www.youtube.com/watch?v=Z-x8Xmfaki4)
- [擲筊 at Longshan](https://www.youtube.com/watch?v=9hC1d9K8eTY)
- [「籤」怎麼抽？擲3聖筊](https://www.youtube.com/watch?v=tiLZW_3B598)
- [竹頭筊製作 (寶島神很大)](https://www.youtube.com/watch?v=l38SPxZHFvE)
- [科學大爆炸: 聖筊機率](https://www.youtube.com/watch?v=jyCZIIpKWaM)
