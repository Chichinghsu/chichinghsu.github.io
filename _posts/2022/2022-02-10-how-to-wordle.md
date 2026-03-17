---
title: Wordle 英文版跟注音版之你不知道的事
date: '2022-02-10T08:16:07.973Z'
categories: data
thumbnail: /images/2022-02-10-how-to-wordle/1.webp
description: "本文來談談最近隨處可見的神祕方塊⬛\U0001F7E8\U0001F7E9背後勢力 Wordle。本文微追根究柢 Wordle 的前世今生與怎麼玩比較好。"
---

本文來談談最近隨處可見的神祕方塊⬛🟨🟩背後勢力 [Wordle](https://www.powerlanguage.co.uk/wordle/)，不知道這在幹啥的讀者可以點上面連結去玩，一場大概五分鐘，一天只能玩一次。常看此廢文網誌的讀者可能會知道單純玩並不是本網誌的作風，所以本文微追根究柢 Wordle 背後的故事以及到底要用什麼「策略」玩比較好（暴雷本文結論之一就是別用「策略」當注音版開頭第一個猜的詞）。

<figure class="post-figure-small">
  <img src="/images/2022-02-10-how-to-wordle/1.webp" alt="蘇黎世金城武版本 Wordle">
  <figcaption>蘇黎世金城武版本 Wordle</figcaption>
</figure>

其實 Wordle 就是台灣常玩猜數字 1A2B 英文單字版，只是從數字變成英文字母，加上可以知道誰 A、誰 B。在這遊戲中，字母對、位置對：綠色🟩，字母對、位置錯：黃色🟨，假設答案沒這個字母的話就灰色⬛（見下圖範例）。遊戲獲勝的話要五綠🟩🟩🟩🟩🟩，但也不能亂猜，每次猜的字都必須要是真正存在的英文單字。

<figure class="post-figure-extra-small">
  <img src="/images/2022-02-10-how-to-wordle/2.webp" alt="Wordle">
  <figcaption>英文版 <a href="https://powerlanguage.co.uk/wordle/">連結</a></figcaption>
</figure>

好奇一查發現這是 Reddit 前軟體工程師 Josh Wardle（最近 Josh 好像很紅！？）的作品。起於他和他老婆 Palak Shah 喜歡玩紐約時報的拼字遊戲，但可能覺得不夠好玩，所以決定自己做更好玩的 Wordle （算是用自己的名字諧音）送給老婆，看到新聞說 Wordle 已被紐約時報買走。

五個字母的英文單字大概有 12000個左右，他以他老婆當標準，老婆不知道的字就代表過於艱深，最後刪到剩下 2500字左右作為答案，也就是說所有答案單字都是他老婆知道的單字，本文接下來都稱這個篩選過後的答案清單為「老婆清單」。雖說只有 2500字，但一天一字也夠玩近七年了。有興趣知道更多背景者可看這篇紐約時報的文章，有更詳細的來龍去脈。

[**Wordle Is a Love Story**](https://www.nytimes.com/2022/01/03/technology/wordle-word-game-creator.html)

## Information Theory

朋友前幾天分享下面這個影片，用 Wordle 來探討 Information Theory，有在搞 Machine Learning 的人應該或多或少都聽過這東西，不過我承認我聽了好幾百次還是一知半解。為了不獻醜加上本網誌自我定位為廢文專用而非技術型網誌，致力於老嫗能解，所以以下不談任何理論內容，敬請安心往下閱讀。有興趣認真討論者我們可以另外 schedule Zoom 討論（我開玩笑的）。

簡而言之這影片說明了怎麼開始猜「最好」根據 Information Theory。裡面提到如果作弊偷看 2500 字左右的老婆清單，最好的開頭字是 crane（正常來說你不應該知道老婆清單的內容，所以算作弊，你有的只有你自己腦中單字清單）。有興趣者可以看看此影片，裡面還有微提到本校傑出校友 John von Neumann 大大 ，但影片偏長（半小時），請小心服用。

<div class="video-container">
<iframe width="560" height="315" src="https://www.youtube.com/embed/v68zYyaEmEA?si=X7FNdRA-CK2mqy-X" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div>

## 如果用在注音版會怎樣？

得知有香港人做出了[注音版的 Wordle](https://words.hk/static/bopomofo-wordle/)，玩法跟英文的類似，只是變成注音且沒有聲調，你可能會覺得三小？這時候你就可以猜ㄙㄢㄒㄧㄠ。上面那影片大大好心附上他的 [code](https://github.com/3b1b/videos/blob/master/_2022/wordle.py)，我借用他的 code 算了一下注音版誰最適合當開頭詞（沒有考慮任何影片中進階的方法像是考慮字詞出現頻率之類的）。原作者寫了超過五千行 code，我借用了其中大概 100 行，把 26 個字母改成 37 個注音符號（題外話，我試著算注音符號有幾個，結果發現我無法從ㄅ開始照順序唸完全部…）。如果我 code 沒改錯，原作大大 code 也沒寫錯的話，以下結論供大家參考。大家可以猜猜看注音版最好的開頭詞是什麼？

注音版總共有 21721 個詞語，比英文版的多很多，不過老婆清單只有 988 個，比英文版少。我偷看一下完整清單裡面有一大堆詞我沒看過，例如：把突兒（武士）、瓝槊（武器名）、博洽（博學多聞）、冰翼紙（古代名紙）之類的，ㄅ還沒看到一半就不想再看了。不過偷看一下老婆清單發現大部分是常見的字，但因為這些字會是未來某天的答案，所以我就不暴雷了（結果下一段還是暴雷了，抱歉）。

所以最好開頭猜什麼？只看注音版老婆清單的話最好開頭詞是ㄒㄧㄥㄨㄣ，乍看之下以為是新聞，但是ㄥ不是ㄣ，結果是「行文」。相反的，那絕對不要猜哪個詞？其實就是本文第一段已經暴雷的ㄘㄜㄌㄩㄝ，也就是「策略」。（供有興趣者參考：「行文」的 entropy 5.13 bit 而「策略」只有 2.14 bit）。

請看下圖，橫軸是各種你猜了之後的各種可能性，我把它逆時針旋轉了，所以第一格在最下面。縱軸則是可能的字數，第一個猜策略的話有 68.22% 出現五灰，也就是說你雖然排除了五個注音，但還有 674 個可能為答案的候選字，但如果你第一個猜行文，最慘的話也只剩下 105 個可能字（當出現 ⬛⬛⬛🟨⬛時）。當然這只是很初步的結論，而且還偷看了老婆清單。之後可以像影片那樣不作弊的話用字詞出現頻率等等之類的各種小技巧來更有效率命中答案。

<figure class="post-figure-small">
  <img src="/images/2022-02-10-how-to-wordle/3.webp" alt="注音版最好與最爛的開頭詞">
  <figcaption>注音版最好與最爛的開頭詞ㄒㄧㄥㄨㄣ與ㄘㄜㄌㄩㄝ</figcaption>
</figure>

## 未來展望

通常這種文章寫到最後都要寫一下未來展望，以注音來說也許可以嘗試不使用五個注音，而用更少或者甚至六七八九個之類的。另外，常玩注音的人應該會莫名有種六次不太夠，常常用完六次還是猜不到之感，是不是平均上六次並不夠（英文 Wordle 平均約落在三到四次左右）？歡迎有興趣者研究研究再跟大家分享。

讀到這邊你可能好奇ㄙㄢㄒㄧㄠ真的是可以使用的詞彙嗎？是，只是不是你想的三小，而是「三消」，這也是我剛剛才知道的新詞，指類似神魔之塔那種把三個同樣東西連在一起消除的遊戲，稱為「三消遊戲」。同時也是「三笑」，好像是一部香港電影。不過ㄙㄢㄒㄧㄠ並不在「老婆清單」之中，而且有 22.17% 全灰，所以建議大家還是不要猜ㄙㄢㄒㄧㄠ，不然真的是不知道你在猜ㄙㄢㄒㄧㄠ。
