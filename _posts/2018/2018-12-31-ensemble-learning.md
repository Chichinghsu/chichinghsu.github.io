---
title: 讀機器學習 Ensemble learning有感而發之民主制度的反思
date: '2018-12-31T00:02:42.891Z'
categories: eth
thumbnail: /images/2018-12-31-ensemble-learning/1.webp
description: "機器學習中有個 Ensemble Learning，本篇不含方程式，請大家放心閱讀。這是個奇怪的標題，最近讀到 Ensemble Learning 時教授提到這跟民主有點關係，想了一下決定把它紀錄下來。"
---

機器學習中有個 Ensemble Learning，本篇不含方程式，請大家放心閱讀。這是個奇怪的標題，最近讀到 Ensemble Learning 時教授提到這跟民主有點關係，想了一下決定把它紀錄下來。

### 什麼是 Ensemble Learning ?

懶人包「三個臭皮匠，勝過一個諸葛亮。」（諸葛亮也懂機器學習！？）只要有很多個不怎麼樣的 classifier，且 classifier數量足夠，就可以有更準確的預測結果。看到這邊一定會覺得，完全不懶人，到底在講什麼東西？說個故事你就明白（真人真事，長話短說），很久以前有個英國統計學家 [Francis Galton](https://en.wikipedia.org/wiki/Francis_Galton)首用了優生學 eugenic這個詞，他對指紋也略懂，現在要講的故事如下，1906年有隻牛要被宰了，他請近 800位村民來預測牛隻體重，結果大家猜的平均為 1197磅（約 542.95 kg），真正的體重為1198磅（約 543.40 kg），這你敢信？所以以後你想知道正妹／帥哥體重，可以去訪問一下 800+個路人，最後平均應該就是答案了。

在 Ensemble Learning中，上述所謂 classifier 或者小故事中的村民，需要符合幾個假設  

1. 必須表現的比隨便亂猜好，也就是說大家會有基本 sense，不要亂猜  
2. 每個 classifier之間要有差異存在，如果說村民中有一家人，討論之後取得92 kg共識，全部猜 92 kg ，那這家人就沒有差異了（一家親）

<figure class="post-figure">
  <img src="/images/2018-12-31-ensemble-learning/1.webp" alt="學校餐廳食物：斯里蘭卡咖哩">
  <figcaption>學校餐廳食物：斯里蘭卡咖哩，要價 6.2 CHF（約 186台幣），而且那塊很像肉的東西不是肉是餅乾。奇怪，咖哩跟民主制度有什麼關係？對，完全沒有。</figcaption>
</figure>

### 民主制度

上面講一堆跟民主制度有什麼關係？每個人的意識形態南轅北轍，大家關心的議題、在意的事情也都大相逕庭。每個人可視為一個 classifier且符合上面第二個假設，差異存在在所有人之間，沒有一模一樣的兩人，無論外在內在。至於第一個假設，相信大家都比隨便亂猜好，因為你關心你的利益，你不會排隊去投票所然後閉起眼睛 random亂蓋章。乍看之下民主制度好像行得通，可惜事情通常不會這麼美麗，介紹一種人叫做 demagogue

#### demagogue  
1. a leader who makes use of popular prejudices and false claims and promises in order to gain power, from: [https://www.merriam-webster.com/](https://www.merriam-webster.com/)  
1. a person, especially a political leader, who wins support by exciting the emotions of ordinary people rather than by having good or morally right ideas, and I will not read any English sentences, from: [https://dictionary.cambridge.org](https://dictionary.cambridge.org)  
1. 通常指政治人物，利用偏見、藉由激發大眾情緒、煽動民心、或幹話來贏得支持，而不是提出有用、可行的辦法（by 我自己亂翻）


看完上面的解釋，是不是腦海中有浮現誰？先前上德語課時講到這個字，一直印象深刻，demagogue (德語：Demagoge)源自古希臘文，前面 dema-為「人民」之意，後面則為「領導」。原意是指口若懸河的好領導者以其口才吸引普羅大眾，但後來 18世紀後漸漸轉為貶抑，變成幹話王。順便一提，民主 democracy (德語：Demokratie)也是同樣的字首，後面-cracy則為「治理」的意思。

還記得上面的第二個假設嗎──每個 classifier之間要有差異存在（小問題，這年代還有人在用破折號嗎？這個場合可以用嗎？兩撇占六格），當demagogue出現時，事情就會發生變化，在他的煽動之下，民眾的想法開始趨於一致，此時就算有一百個臭皮匠，臭味可能一百倍，但還是勝不過一個諸葛亮。
