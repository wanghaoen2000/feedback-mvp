# 托福口语场景词汇表 - AI提示词（路书）

## 一、项目概述

本项目制作《托福口语场景词汇表》，共589个单词，按场景分为23个List。

**你的任务**：根据指定的List编号，从源文件中读取对应场景的单词，为每个单词补充完整信息，然后输出JSON格式数据。

**重要**：你只需要输出纯JSON数据，不要输出任何代码、解释文字或Markdown格式。

---

## 二、List分配表（场景对应表）

| List | 场景名称 | 单词编号范围 | 词数 |
|------|---------|-------------|------|
| List 1 | ETS官方词汇 | 1-40 | 40词 |
| List 2 | 导览词 | 41-64 | 24词 |
| List 3 | Library | 65-89 | 25词 |
| List 4 | Dormitory | 90-114 | 25词 |
| List 5 | Gym | 115-139 | 25词 |
| List 6 | Student Center | 140-164 | 25词 |
| List 7 | Coffee Shop | 165-189 | 25词 |
| List 8 | Cafeteria | 190-214 | 25词 |
| List 9 | Auditorium | 215-239 | 25词 |
| List 10 | Gallery | 240-264 | 25词 |
| List 11 | Shopping Mall | 265-289 | 25词 |
| List 12 | Supermarket | 290-314 | 25词 |
| List 13 | Shopping Plaza | 315-339 | 25词 |
| List 14 | Movie Theatre | 340-364 | 25词 |
| List 15 | Theatre | 365-389 | 25词 |
| List 16 | Art Museum | 390-414 | 25词 |
| List 17 | Science Museum | 415-439 | 25词 |
| List 18 | Park | 440-464 | 25词 |
| List 19 | Swimming Pool | 465-489 | 25词 |
| List 20 | Restaurant | 490-514 | 25词 |
| List 21 | Bar | 515-539 | 25词 |
| List 22 | Market | 540-564 | 25词 |
| List 23 | Community Service Center | 565-589 | 25词 |

---

## 三、数据源

源数据附在本提示词末尾（第九节），请直接从中读取对应List的单词。

源数据格式示例：
```
65. Librarian (n.) - 图书管理员
66. Library card (n. phrase) - 借书卡
180. brew (v.) 冲泡（咖啡或茶）
```

---

## 四、单词条目内容要求

每个单词必须包含以下7项信息：

| 字段 | 说明 | 示例 |
|------|------|------|
| num | 单词在源文件中的原始编号 | 65 |
| word | 英文单词/词组原形 | Librarian |
| phonetic | 国际音标，用斜杠包围 | /laɪˈbreəriən/ |
| pos | 词性缩写 | n. |
| meaning | 中文释义 | 图书管理员 |
| example | 英文例句（贴合托福口语场景） | The librarian helped me find reference books for my research paper. |
| translation | 例句的中文翻译 | 图书管理员帮我找到了写研究论文需要的参考书。 |

**词性缩写规范**：
- 名词：n. 或 n. phr.（名词短语）
- 动词：v. 或 v. phr.（动词短语）
- 形容词：adj.
- 副词：adv.
- 介词：prep.
- 连词：conj.

---

## 五、JSON输出格式

```json
{
  "listNumber": 3,
  "sceneName": "Library",
  "wordCount": 25,
  "words": [
    {
      "num": 65,
      "word": "Librarian",
      "phonetic": "/laɪˈbreəriən/",
      "pos": "n.",
      "meaning": "图书管理员",
      "example": "The librarian helped me find reference books for my research paper.",
      "translation": "图书管理员帮我找到了写研究论文需要的参考书。"
    },
    {
      "num": 66,
      "word": "Library card",
      "phonetic": "/ˈlaɪbreri kɑːrd/",
      "pos": "n. phr.",
      "meaning": "借书卡",
      "example": "You need a valid library card to borrow books from the circulation desk.",
      "translation": "你需要有效的借书卡才能从流通台借书。"
    }
  ]
}
```

---

## 六、执行流程

当收到任务「完成List X」时：

1. **确认范围**：根据第二节的分配表，确定场景名称和单词编号范围
2. **读取数据**：从源文件中提取对应范围的单词（保留原始编号）
3. **补充信息**：
   - 如果源文件已有音标，保留原音标
   - 如果源文件没有音标，补充正确的IPA音标
   - 为每个单词编写贴合该场景的例句和翻译
4. **输出JSON**：按照第五节的格式输出纯JSON数据

---

## 七、注意事项

1. **保持原始编号**：使用单词在源文件中的原始编号，不要重新编号
2. **场景相关例句**：例句要贴合当前List的场景主题
3. **音标准确性**：确保IPA音标正确，用斜杠包围
4. **纯JSON输出**：
   - ❌ 不要输出 ```json 标记
   - ❌ 不要输出任何解释文字
   - ❌ 不要输出代码
   - ✅ 只输出纯JSON对象
5. **词性保持一致**：如果源文件标注了词性，保持原有标注
6. **中文释义简洁**：多个义项用分号分隔

---

## 八、检查清单

输出前请确认：

- [ ] listNumber 与任务编号一致
- [ ] sceneName 与分配表中的场景名称一致
- [ ] wordCount 与实际单词数量一致
- [ ] 每个单词都有完整的7项信息
- [ ] 音标格式正确（/音标/）
- [ ] 例句贴合场景主题
- [ ] 输出的是纯JSON，无任何额外内容

---

## 九、源数据

【以下为完整词汇源数据，请根据任务编号读取对应场景的单词】


### List 1 - ETS官方词汇（40词）

1. commuting habit (n.) 通勤习惯
2. public transportation (n.) 公共交通
3. stressful (adj.) 有压力的
4. severe decline (n.) 急剧减少
5. perception (n.) 看法，认知
6. overwhelming (adj.) 令人难以承受的
7. leisure activity (n.) 休闲活动
8. dynamic (adj.) 充满活力的
9. drain sb. of energy (v. 短语) 耗尽某人精力
10. green space (n.) 绿地
11. weightlifting (n.) 举重
12. fitness app (n.) 健身应用程序
13. schedule (n.) 日程安排
14. work-life balance (n.) 工作与生活的平衡
15. flexible working hour (n.) 弹性工作时间
16. remote work option (n.) 远程工作选项
17. engagement (n.) 参与度
18. prioritize (v.) 优先考虑
19. strategy (n.) 策略
20. perception (n.) 看法，认知
21. perception (n.) 看法，认知
22. overwhelming (adj.) 令人难以承受的
23. leisure activity (n.) 休闲活动
24. dynamic (adj.) 充满活力的
25. drain sb. of energy (v. 短语) 耗尽某人精力
26. green space (n.) 绿地
27. life satisfaction (n.) 生活满意度
28. urban area (n.) 城市区域
29. participate (v.) 参与
30. attitude (n.) 态度
31. work-life balance (n.) 工作与生活的平衡
32. flexible working hour (n.) 弹性工作时间
33. remote work option (n.) 远程工作选项
34. engagement (n.) 参与度
35. prioritize (v.) 优先考虑
36. strategy (n.) 策略
37. perception (n.) 看法，认知
38. attitude (n.) 态度
39. schedule (n.) 日程安排
40. dynamic (adj.) 充满活力的

### List 2 - 导览词（24词）

41. Follow - 跟随、沿着
42. Proceed straight ahead - 直行
43. Stay with - 紧跟、同行
44. Keep to the left/right - 靠左 / 右侧行走
45. Move forward slowly - 缓慢前行
46. Head towards - 朝向…… 行进
47. Refrain from - 避免、切勿
48. Continue through - 穿过…… 继续前行
49. Gather at - 在…… 集合
50. Maintain a distance from - 与…… 保持距离
51. Take the escalator/elevator - 乘坐扶梯 / 电梯
52. Remain behind - 待在…… 后方
53. Ask the guide for - 向导游咨询……
54. Keep along - 沿…… 前行（补充高频，替换重复感，适配路线指引）
55. Straight ahead - 正前方
56. On your left/right - 在你的左侧 / 右侧
57. Around the corner - 在拐角处（转弯后）
58. Down the corridor - 沿走廊往里
59. Up the stairs/elevator - 上楼 / 乘电梯上行
60. Behind the exhibition hall - 在展厅后方
61. Next to the information desk - 紧邻咨询台
62. Across from the entrance - 在入口对面
63. Along the main path - 沿主路前行
64. Beyond the archway - 拱门另一侧

### List 3 - Library（25词）

65. Librarian (n.) - 图书管理员
66. Library card (n. phrase) - 借书卡
67. Circulation desk (n. phrase) - 流通台
68. Loan period (n. phrase) - 借阅期限
69. Renewal (n.) - 续借
70. Overdue (adj.) - 逾期的
71. Reservation (n.) - 预约
72. Catalog (n. /v.) - 目录；为…… 编目录
73. Stacks (n. pl.) - 书库
74. Reference book (n. phrase) - 参考书
75. Periodical (n. /adj.) - 期刊；定期的
76. Archive (n. /v.) - 档案库；归档
77. Interlibrary loan (n. phrase) - 馆际互借
78. Study carrel (n. phrase) - 单人自习隔间
79. E-resource (n. phrase) - 电子资源
80. Renew (v.) - 续借
81. Reserve (v.) - 预约
82. Retrieve (v.) - 检索（文献 / 图书）
83. Recall (v.) - （图书馆）召回（图书）
84. Index (v.) - 为（文献）编索引
85. Digitize (v.) - 将（纸质文献）数字化（录入图书馆系统）
86. Loan (v.) - （图书馆）借出（资源）
87. Access (v.) - 获取（图书馆资源）
88. Classify (v.) - 为（图书）分类（按学科 / 体系归类）
89. Utilize (v.) - 利用（图书馆设施 / 资源）

### List 4 - Dormitory（25词）

90. Residence hall (n. phrase) - 宿舍楼
91. Housemate (n.) - 同住室友
92. Resident Advisor (n. phrase) - 宿舍助理
93. Utilities (n. pl.) - 公用设施
94. Dorm room (n. phrase) - 宿舍房间
95. Common area (n. phrase) - 公共区域
96. Curfew (n.) - 宵禁时间
97. Laundry room (n. phrase) - 洗衣房
98. Storage space (n. phrase) - 储物空间
99. single room (n. phrase) - 单人间
100. Amenity (n.) - 便利设施
101. Lease (n.) - 住宿合同
102. Damage deposit (n. phrase) - 押金
103. Noise ordinance (n. phrase) - 噪音规定
104. Dormitory wing (n. phrase) - 宿舍单元
105. Check in (v. phrase) - 办理入住
106. Check out (v. phrase) - 办理退宿
107. Occupy (v.) - 占用
108. Furnish (v.) - 为（宿舍）配备家具
109. Rearrange (v.) - 重新布置
110. Maintain (v.) - 维护
111. Vacate (v.) - 腾出
112. Report (v.) - 报修
113. Stock (v.) - 储备
114. Customize (v.) - 定制化改造

### List 5 - Gym（25词）

115. Fitness center (n. phrase) - 健身中心
116. Gym floor (n. phrase) - 体育馆场地
117. Weight room (n. phrase) - 力量训练室
118. Cardio equipment (n. phrase) - 有氧运动设备
119. Locker rental (n. phrase) - 储物柜租赁
120. Group fitness class (n. phrase) - 团体健身课
121. Personal trainer (n. phrase) - 私人教练
122. Gym towel (n. phrase) - 运动毛巾
123. Water fountain (n. phrase) - 饮水机
124. Exercise mat (n. phrase) - 瑜伽垫/健身垫
125. Dumbbell rack (n. phrase) - 哑铃架
< truncated lines 299-519 >
323. Parking structure（n. phr.）- 停车场建筑
324. Concierge desk（n. phr.）- 礼宾服务台
325. shopping wing（n. phr.）- 零售区域（分区）
326. Food court（n. phr.）- 美食专区
327. Courtyard fountain（n. phr.）- 庭院喷泉
328. Storefront display（n. phr.）- 店面展示
329. Membership lounge（n. phr.）- 会员休息室
330. Shop（v.）购物：在各类商铺里挑选商品
331. Browse（v.）浏览：随意查看商品，不急于购买
332. Purchase（v.）购买：完成交易买下商品
333. Try on（v. 短语）试穿：在服装店试穿衣物、鞋子
334. Check out（v. 短语）结账：在收银台结算商品
335. Return（v.）退回：把不满意的商品送回店铺
336. Exchange（v.）调换：用商品更换其他款式或尺码
337. Navigate（v.）穿行；寻找：在购物广场里找店铺或方向
338. Wait（v.）等待：在店铺外或餐厅里等朋友、等餐
339. Carry（v.）携带：拿着购买的商品

### List 14 - Movie Theatre（25词）

340. Book v. 预订
341. Save v. 预留
342. Buy v. 购买
343. Walk into v. 短语 走进
344. Show v. 放映
345. Watch v. 观看
346. Leave v. 离开
347. Line up v. 短语 排队
348. Grab v. 购买（快速）
349. Adjust v. 调节
350. Box office（n. phr.）- 售票处
351. Concession stand（n. phr.）- 零食小卖部
352. Screening room（n. phr.）- 放映厅
353. Reserved seat（n. phr.）- 预留座位
354. 3D glasses（n. phr.）- 3D 眼镜
355. Movie poster（n. phr.）- 电影海报
356. Showtime schedule（n. phr.）- 放映时间表
357. Premiere event（n. phr.）- 首映活动
358. Ticket stub（n. phr.）- 票根
359. IMAX screen（n. phr.）- IMAX 巨幕
360. Trailer trailer（n. phr.）- 预告片合集
361. VIP lounge（n. phr.）- 贵宾休息室
362. Seating chart（n. phr.）- 座位分布图
363. Parking validation（n. phr.）- 停车优惠券
364. Crowded showing（n. phr.）- 满场放映

### List 15 - Theatre（25词）

365. Perform v. 表演
366. Audition v. 试镜
367. Direct v. 执导
368. Stage v. 上演
369. Act v. 扮演
370. Applaud v. 鼓掌
371. Attend v. 出席
372. Rehearse v. 排练
373. Host v. 主持
374. Exit v. 退场
375. Live stage production（n. phr.）- 现场舞台演出（区别于电影放映）
376. Lead actor/actress（n. phr.）- 男女主角（戏剧专用）
377. Orchestra pit（n. phr.）- 乐池（剧院乐队位置）
378. Curtain call（n. phr.）- 谢幕（戏剧结束后演员致意环节）
379. Playbill（n.）- 演出节目单（剧院专属）
380. Stage director（n. phr.）- 舞台导演
381. Costume department（n. phr.）- 服装部
382. Proscenium arch（n. phr.）- 舞台拱形台口
383. Soliloquy（n.）- 独白（戏剧中角色独自抒发情感的台词）
384. Backstage crew（n. phr.）- 后台工作人员
385. theatrical script（n. phr.）- 戏剧剧本
386. Box seat（n. phr.）- 包厢座位
387. Lighting technician（n. phr.）- 灯光技师
388. Intermission（n.）- 幕间休息（戏剧分幕间的暂停）
389. Theatre repertoire（n. phr.）- 剧院常备剧目

### List 16 - Art Museum（25词）

390. Visit v. 参观
391. Explore v. 探寻
392. Admire v. 欣赏
393. Observe v. 观察
394. Learn v. 学习
395. Photograph v. 拍摄
396. Guide v. 引导
397. Curate v. 策划
398. Donate v. 捐赠
399. Wander v. 闲逛
400. Classical art gallery（n. phr.）- 古典艺术馆
401. Ancient cultural relic（n. phr.）- 古代文化文物
402. Renaissance masterpiece（n. phr.）- 文艺复兴杰作
403. Curator’s commentary（n. phr.）- 策展人解说
404. Exhibit inscription（n. phr.）- 展品铭文
405. Permanent art collection（n. phr.）- 永久艺术馆藏
406. Temporary thematic exhibition（n. phr.）- 临时主题展览
407. Outdoor sculpture garden（n. phr.）- 户外雕塑花园
408. Historical document archive（n. phr.）- 历史文献档案库
409. Museum catalog（n. phr.）- 博物馆馆藏目录
410. Cultural heritage exhibit（n. phr.）- 文化遗产展览
411. Vintage oil painting（n. phr.）- 复古油画
412. Hand-carved marble sculpture（n. phr.）- 手工雕刻大理石雕塑
413. Museum docent（n.）- 博物馆讲解员
414. Art conservation lab（n. phr.）- 艺术品保护实验室

### List 17 - Science Museum（25词）

415. Visit v. 参观
416. Explore v. 探寻
417. Admire v. 欣赏
418. Observe v. 观察
419. Learn v. 学习
420. Photograph v. 拍摄
421. Guide v. 引导
422. Curate v. 策划
423. Donate v. 捐赠
424. Wander v. 闲逛
425. Interactive science installation（n. phr.）- 互动科学装置
426. Planetarium dome show（n. phr.）- 天文馆球幕电影
427. Demonstration lab（n. phr.）- 实验演示实验室
428. Fossil excavation exhibit（n. phr.）- 化石挖掘展区
429. Guided inquiry program（n. phr.）- 引导式探究项目
430. Quantum physics gallery（n. phr.）- 量子物理展厅
431. Virtual reality simulation（n. phr.）- 虚拟现实模拟体验
432. Observation notebook（n. phr.）- 科学观察笔记
433. Biological evolution display（n. phr.）- 生物进化展览
434. Laboratory-grade equipment exhibit（n. phr.）- 实验室级设备展品
435. Astronomical telescope exhibit（n. phr.）- 天文望远镜展品
436. Eco-system simulation model（n. phr.）- 生态系统模拟模型
437. Exhibit explanatory pamphlet（n. phr.）- 展品说明手册
438. STEM education workshop（n. phr.）- STEM 教育工作坊
439. Geological specimen collection（n. phr.）- 地质标本藏品

### List 18 - Park（25词）

440. Picnic v. 野餐
441. Wander v. 漫步
442. Hike v. 徒步
443. Camp v. 露营
444. Play v. 游玩
445. Relax v. 休憩
446. Plant v. 栽种
447. Feed v. 投喂
448. Cycle v. 骑行
449. Gather v. 聚集
450. Scenic overlook（n. phr.）- 观景台
451. Picnic pavilion（n. phr.）- 野餐凉亭
452. Hiking trail（n. phr.）- 徒步小径
453. Wildlife sanctuary（n. phr.）- 野生动物保护区
454. Campsite reservation（n. phr.）- 营地预约
455. Boat rental kiosk（n. phr.）- 船只租赁处
456. Playground equipment（n. phr.）- 游乐场设施
457. Botanical garden section（n. phr.）- 植物园区域
458. Park ranger station（n. phr.）- 公园管理员站
459. Lakeside boardwalk（n. phr.）- 湖边木板路
460. Barbecue grill（n. phr.）- 烧烤架
461. Restroom facility（n. phr.）- 公共卫生间设施
462. Nature interpretive center（n. phr.）- 自然解说中心
463. Bicycle rack（n. phr.）- 自行车停放架
464. Seasonal festival area（n. phr.）- 季节性节庆区域

### List 19 - Swimming Pool（25词）

465. Swim v. 游泳
466. Dive v. 跳水
467. Splash v. 泼水
468. Float v. 漂浮
469. Stroke v. 划水
470. Kick v. 蹬腿
471. Glide v. 滑行
472. Submerge v. 潜水
473. Tread v. 踩水
474. dry off v. 擦干
475. Lane divider（n. phr.）- 泳道分隔线
476. Diving board（n. phr.）- 跳板
477. Shallow end（n. phr.）- 浅水区
478. Lifeguard tower（n. phr.）- 救生员岗亭
479. Pool filter system（n. phr.）- 泳池过滤系统
480. Changing room（n. phr.）- 更衣室
481. Swim cap（n. phr.）- 泳帽
482. Water temperature gauge（n. phr.）- 水温计
483. No diving sign（n. phr.）- 禁止跳水标识
484. Chlorine level（n. phr.）- 氯含量
485. Starting block（n. phr.）- 出发台（比赛用）
486. Pool deck（n. phr.）- 泳池周边平台
487. Floatation device（n. phr.）- 漂浮装置
488. Swim lesson schedule（n. phr.）- 游泳课时间表
489. Overflow drain（n. phr.）- 溢水排水口

### List 20 - Restaurant（25词）

490. Dine v. 用餐
491. Order v. 点餐
492. Serve v. 上菜
493. Tip v. 付小费
494. Reserve v. 预订
495. Wait v. 等候
496. Eat v. 进食
497. Drink v. 饮用
498. Pay v. 付款
499. Complain v. 投诉
500. Menu（n. phr.）- 点餐菜单
501. Waitstaff（n.）- 服务员团队
502. Reserved table（n. phr.）- 预留座位
503. Table setting（n. phr.）- 餐桌布置
504. Appetizer course（n. phr.）- 前菜套餐
505. Wine list（n. phr.）- 酒水单
506. Host stand（n. phr.）- 迎宾台
507. Private dining room（n. phr.）- 私人包间
508. Bill folder（n. phr.）- 账单夹
509. Specialty dish（n. phr.）- 特色菜
510. Service charge（n. phr.）- 服务费
511. Outdoor patio（n. phr.）- 户外露台
512. Chef’s recommendation（n. phr.）- 主厨推荐
513. Takeout container（n. phr.）- 外卖餐盒
514. Dining etiquette（n. phr.）- 用餐礼仪

### List 21 - Bar（25词）

515. Sip v. 啜饮
516. Order v. 点单
517. Toast v. 干杯
518. Mix v. 调饮
519. Serve v. 上酒
520. Tip v. 付小费
521. Chat v. 闲谈
522. Dance v. 跳舞
523. Pay v. 结账
524. Lounge v. 闲坐
525. Craft brewery（n. phr.）- 精酿啤酒厂（酒吧常见合作方）
526. Bar station（n. phr.）- 调酒台
527. Wine cellar（n. phr.）- 酒窖（高端酒吧配备）
528. Happy hour specials（n. phr.）- 欢乐时光特惠（特定时段折扣）
529. Bar stool（n. phr.）- 吧台高脚凳
530. Cocktail shaker（n. phr.）- 鸡尾酒摇酒器
531. ID verification（n. phr.）- 身份证件核验（查年龄）
532. Live music stage（n. phr.）- 现场音乐舞台
533. Tab system（n. phr.）- 记账系统（先消费后结算）
534. Premium liquor（n. phr.）- 高端烈酒
535. Bar menu（n. phr.）- 酒吧菜单（含饮品和小食）
536. Designated driver（n. phr.）- 代驾司机
537. Martini glass（n. phr.）- 马提尼酒杯
538. Pub crawl（n. phr.）- 酒吧巡游（连续走访多家酒吧）
539. Alcohol license（n. phr.）- 售酒许可证

### List 22 - Market（25词）

540. Bargain v. 议价
541. Purchase v. 购买
542. Browse v. 浏览
543. Select v. 挑选
544. Haggle v. 讨价还价
545. Sell v. 售卖
546. Carry v. 携带
547. Inspect v. 查看
548. Trade v. 交易
549. Stock v. 备货
550. Open-air marketplace（n. phr.）- 露天市场
551. Artisanal produce stall（n. phr.）- 手工农产品摊位
552. Local merchant（n. phr.）- 本地商户
553. Handwoven carrying basket（n. phr.）- 手工编织购物篮
554. Seasonal agricultural yield（n. phr.）- 季节性农产品收成
555. Cultural haggling norms（n. phr.）- 议价文化规范
556. Handicraft bazaar section（n. phr.）- 手工艺品集市区域
557. Street food kiosk（n. phr.）- 街头小吃摊
558. Market alleyway（n. phr.）- 市场小巷
559. Fresh seafood vendor（n. phr.）- 新鲜海鲜商贩
560. Artisanal preserves（n. phr.）- 手工腌制食品
561. Flea market kiosk（n. phr.）- 跳蚤市场货摊
562. Morning market peak hour（n. phr.）- 早市高峰时段
563. Organic produce vendor（n. phr.）- 有机农产品商贩
564. Market entrance archway（n. phr.）- 市场入口拱门

### List 23 - Community Service Center（25词）

565. Volunteer v. 志愿服务
566. Assist v. 协助
567. Register v. 登记
568. Counsel v. 咨询指导
569. Organize v. 组织
570. Distribute v. 分发
571. Participate v. 参与
572. Support v. 帮扶
573. Conduct v. 开展
574. Donate v. 捐赠
575. Outreach program（n. phr.）- 外展服务项目
576. Skill-building workshop（n. phr.）- 技能培训工作坊
577. Neighborhood association（n. phr.）- 社区居民协会
578. Senior center wing（n. phr.）- 老年人活动区
579. After-school care（n. phr.）- 课后托管服务
580. Food bank facility（n. phr.）- 食物银行设施
581. Counseling office（n. phr.）- 咨询办公室
582. Community garden plot（n. phr.）- 社区菜园地块
583. Cultural event venue（n. phr.）- 文化活动场地
584. Volunteer coordination desk（n. phr.）- 志愿者协调处
585. Youth development program（n. phr.）- 青少年发展项目
586. Emergency assistance service（n. phr.）- 紧急援助服务
587. Meeting room reservation（n. phr.）- 会议室预约
588. Parenting resource library（n. phr.）- 育儿资源图书馆
589. Community bulletin board（n. phr.）- 社区公告栏看到问题了！
错误信息：Unexpected token '', "```json { "...
问题根因：
路书里写了：
4. **纯JSON输出**：
   - ❌ 不要输出 ```json 标记
   - ❌ 不要输出任何解释文字
   - ✅ 只输出纯JSON对象
但AI还是输出了 ```json 这个Markdown代码块标记，导致JSON解析失败。

解决方案有两个：
方案A：后端增加容错处理（推荐）
让Manus在解析JSON前，先清理掉可能的Markdown标记：
markdown## 任务：JSON解析增加容错处理

### 背景
AI有时会输出 ```json 标记包裹JSON，导致解析失败。

### 目标
在解析JSON前，自动清理Markdown代码块标记。

### 具体要求

修改 batchRoutes.ts 中词汇卡片的JSON解析逻辑，在 JSON.parse 之前添加清理：
```typescript
// 清理可能的Markdown代码块标记
let cleanContent = aiContent.trim();
if (cleanContent.startsWith('```json')) {
  cleanContent = cleanContent.slice(7); // 去掉 ```json
}
if (cleanContent.startsWith('```')) {
  cleanContent = cleanContent.slice(3); // 去掉 ```
}
if (cleanContent.endsWith('```')) {
  cleanContent = cleanContent.slice(0, -3); // 去掉结尾的 ```
}
cleanContent = cleanContent.trim();

const jsonData = JSON.parse(cleanContent);
```

### 验收标准
- [ ] AI输出带 ```json 标记时，能正常解析
- [ ] AI输出纯JSON时，也能正常解析
```

---

### 方案B：修改路书（备用）

如果方案A不够，可以在路书里更强调：

把第七节的第4点改成：
```
4. **纯JSON输出**：
   - ❌ 绝对不要输出 ```json 标记
   - ❌ 绝对不要输出 ``` 标记
   - ❌ 不要输出任何解释文字
   - ✅ 第一个字符必须是 {
   - ✅ 最后一个字符必须是 }

建议：先让Manus做方案A，这样更稳健——不管AI怎么输出都能处理。