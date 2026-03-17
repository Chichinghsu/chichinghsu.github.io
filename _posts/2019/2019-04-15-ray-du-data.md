---
title: 阿滴英文歷年愚人節影片留言分析
date: '2019-04-15T10:19:37.088Z'
categories: data
thumbnail: /images/2019-04-15-ray-du-data/2.webp
description: "身為 YouTube 重度使用者，本文決定用 YouTube Data API 來撈阿滴英文從 2017以來連續三年的愚人節影片留言，看一下這三年留言趨勢有什麼變化。第一次嘗試寫技術性的內容，請多指教。懶得看細節可以直接拉到最下面看結論。"
---

身為 YouTube 重度使用者，本文決定用 YouTube Data API 來撈阿滴英文從 2017以來連續三年的愚人節影片留言，看一下這三年留言趨勢有什麼變化。第一次嘗試寫技術性的內容，請多指教。懶得看細節可以直接拉到最下面看結論。

## Introduction

[阿滴英文](https://www.youtube.com/channel/UCeo3JwE3HezUWFdVcehQk9Q)是台灣少數三個訂閱數量達 200萬的 YouTuber之一（今年年初時達 200萬訂閱），他們從 2016年起每年愚人節都有發布愚人節影片，十分有創意。在此用 [YouTube Data API](https://developers.google.com/youtube/v3/) 做個簡單小分析，分析這些愚人節影片的留言行為。這些愚人節影片的標題如下：

> 2016 [【愚人節】阿滴彩妝頻道介紹影片](https://www.youtube.com/watch?v=RlQpWNXBxZs)<br>
> 2017 [【愚人節】我要離開這個頻道了。](https://www.youtube.com/watch?v=lrgCrpJCh34)<br>
> 2018 [【愚人節】我其實沒有妹妹。](https://www.youtube.com/watch?v=GMRUHvqHbMY)<br>
> 2019 [我開了一間全科補習班。](https://www.youtube.com/watch?v=mVehfzHZ2B4)

但是 2016年的那支影片是發在「滴妹」頻道底下，並不是在「阿滴英文」的頻道發布，且觀看次數 (267,367) 低於另外三支很多，所以就不列入本次分析範圍內。下表為這三支影片的基本資料。

<figure class="post-figure-small">
  <img src="/images/2019-04-15-ray-du-data/1.webp" alt="愚人節影片的基本資料">
  <figcaption>三支愚人節影片的基本資料（取材日期：2019/04/13）；製圖：蘇黎世金城武本人</figcaption>
</figure>

此文將討論平均留言字數、留言粉絲人數、粉絲於不同年份的重疊數等等與留言相關的數據。有沒有人連續兩年都留言？甚至連續三年都留言？先說結論，有，但不多。本文使用的資料皆來自 [YouTube Data API](https://developers.google.com/youtube/v3/) ，撈出這三支影片中的所有留言資料，使用語言為 Python，通通撈起來！以下資料皆擷取於2019 年 04 月 13日。

## Results

### 留言者是否重疊？鐵粉？韓粉？

這邊先假設會留言的人都是粉絲，那麼每年的粉絲相同嗎？是同樣的那群人（這群人？）嗎？有沒有人連續兩年都留言？甚至連續三年都留言？讓我們來看圖說故事。

<figure class="post-figure-small">
  <img src="/images/2019-04-15-ray-du-data/2.webp" alt="每年留言人數與重疊人數">
  <figcaption>每年留言人數與重疊人數 ；製圖：金城武本人</figcaption>
</figure>

從左圖（PowerPoint 萬能）可以看到 2019年有 7706位不重複的使用者在影片下面留言，2018年則有 8568，2017年有5675位。

有 327位民眾在 2017年與 2018年的愚人節影片都有留言，有 486位民眾在 2018年與 2019年的影片都留言，依此類推。核心的那 49位民眾我們可以稱之為「鐵粉」，在三年的影片中都有留言。

我們來看看這些鐵粉這三年間分別說了什麼，隨意取幾個來看看：


> **鐵粉一號**  
2017: '4/1'  
2018: '4/1來囉'  
2019: '愚人節由一天升級到七天了嗎﹖'

> **鐵粉二號**  
2017: '你想嚇使我啊QAQ'  
2018: '還是整個YouTube的Youtuber都是假的(ﾟДﾟ)'  
2019: '未看先猜愚人節影片'

> **鐵粉三號**  
2017: '不要叫阿嬤說謊啦XDDD'  
2018: '原來我遇見的3D投影的滴妹！？好真實啊！'  
2019: '愚人節快樂!'

有蠻大一部分的人是第一次留言，連續兩年甚至三年都留言的人非常的少，不知這是否代表粉絲的組成緩緩地在變化。

<div class="video-container">
<iframe width="560" height="315" src="https://www.youtube.com/embed/mVehfzHZ2B4?si=eWd85rdwb0HqD4lw" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div>

### 2019年補習班影片出現的 YouTuber，誰被提到比較多次？

2019 的影片大致上是在說他開了一個補習班，裡面其他 YouTuber 擔任各科老師。我們把 2019這部影片的全部留言丟進「[結巴分詞](https://github.com/fxsjy/jieba)」（一個非常好用的中文分詞系統）裡面，然後再看這些詞出現的頻率，請見下圖。在此大膽宣布，女性聲量大於男性。這可能可以當作以後要找誰 Feat 你影片會比較有話題性的參考。

<figure class="post-figure">
  <img src="/images/2019-04-15-ray-du-data/3.webp" alt="留言中提到 YouTuber 次數分布">
  <figcaption>留言中提到 YouTuber 次數分布；製圖：蘇黎世金城武本人</figcaption>
</figure>

這邊我自己想了不少組字詞，像是 Joeman就包含了「九妹 50次 + JOEMAN 1次 + Joeman 17次 + joeman 7次 + 九面 3次」；呱吉就有「呱吉 106次 +議員 29次」等等。當然這些詞可能取的不是很精準，也許留言中會提到其他議員。上圖中所有人都有出現在影片中，應該沒有漏掉誰（吧）如果有的話請跟我說一下。其他沒出現在影片中的 YouTuber也有不少出現在留言中，例如小玉出現 93次、放火 90次、展榮 84次、展瑞 57次、千千 40次、魚乾 34次、HowHow 24次等等。亂下個結論，阿滴的觀眾群跟小玉、放火及展榮展瑞的重疊度頗高。

順帶一提一些比較有趣的詞出現的次數

>'😂', 2445  
'愚人節', 1940  
'假', 769  
'快樂', 668  
'騙', 303  
'妹妹', 239  
'綁架', 201  
'笑死', 124  
'退訂', 120  
'警察', 50

### 留言字數

接著我們來看每年影片留言字數的變化，2017年平均留言字數為 18.18字，2018年為 19.78字，而今年則為 18.37字。須注意字數是用 Python的 len()去算的，所以例如英文 ‘Hello’ 會算 5個字，而「阿滴英文」則算 4個字，表情符號「😂」算一個字，空格也算 1個字。下圖可以看到不同年份留言字數的分布，下圖最大值只取到 60字，因為超過 60字的回覆並不常見，大多數的回應字數都集中在 3到 20字。這三年間留言字數趨勢並無太明顯的變化。

<figure class="post-figure">
  <img src="/images/2019-04-15-ray-du-data/4.webp" alt="不同年份留言字數分布">
  <figcaption>不同年份留言字數分布，須注意 y軸留言次數的數值並不同；製圖：蘇黎世金城武本人</figcaption>
</figure>

### 「總留言數」、「留言數」、「使用者數」、「平均留言字數」、「最長留言字數」

<figure class="post-figure">
  <img src="/images/2019-04-15-ray-du-data/5.webp" alt="不同年份留言字數分布">
  <figcaption>（取材日期：2019/04/13）；製圖：蘇黎世金城武本人</figcaption>
</figure>

「總留言數」包含「留言的留言」數量，也就是說如果有人在留言下面留言，這樣就算兩個留言；而「留言數」只算主留言數量，不含「留言的留言」。以下圖為例：總留言數 = 3，留言數 = 1。

<figure class="post-figure-small">
  <img src="/images/2019-04-15-ray-du-data/6.webp" alt="不同年份留言字數分布">
  <figcaption>覺得帥 +1 ；製圖：蘇黎世金城武本人</figcaption>
</figure>

「使用者數」則為在「留言數」中不重複的的使用者，也就是說如果有個瘋狂粉絲留了 10則留言，留言數 = 10 但使用者數 = 1。依比例（半島）來看的話，這三年「留言數」比例 (0.264%, 0.292%, 0.415%) 呈現上升的趨勢（「總留言數」比例也是上升）。也就是說 2017年時每 1000個觀看次數會有 3.22 個人留言，2018年時有 3.6個人，2019年上升到 4.76個人，但每個人留言的字數在三年內並無太大變化。也就是說越來越多人願意留言，但他們的話並沒有比較多。

## Conclusions

1.  你還真的直接拉下來看結論，好吧，讓你看
2.  會留言的人不到百分之一是菁英中的菁英，但會留言的人數逐年上漲中
3.  留言平均字數 18~19字左右，三年來沒太大變化，大家話並沒有變多也沒有變少，也沒有懶得打字
4.  大家很喜歡這個臉 😂😂😂😂😂😂😂😂😂 出現了2445次
5.  三年都有留言的民眾有 49位，鐵粉值得頒發獎牌
6.  寫這種文章好累啊，歡迎批評指教，留言分享訂閱小鈴鐺開啟來