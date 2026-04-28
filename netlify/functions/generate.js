export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "POSTメソッドで送信してください。" }, 405);
    }

    try {
      const apiKey = env.OPENAI_API_KEY;
      const model = env.OPENAI_MODEL || "gpt-4.1-mini";

      if (!apiKey) {
        return jsonResponse({ error: "OPENAI_API_KEY が設定されていません。" }, 500);
      }

      const body = await request.json();

      const words = Array.isArray(body.words) ? body.words.map(String) : [];
      const genre = String(body.genre || "随筆");
      const viewpoint = String(body.viewpoint || "おまかせ");
      const length = Number(body.length || 800);
      const retry = Boolean(body.retry);

      const validation = validateInput(words, genre, viewpoint, length);
      if (validation) return jsonResponse({ error: validation }, 400);

      const prompt = buildPrompt(words, genre, viewpoint, length, retry);

      const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          temperature: retry ? 1.05 : 0.9,
          max_tokens: Math.min(4500, Math.max(1200, Math.ceil(length * 2.7))),
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "あなたは日本語の文章発想支援AIです。必ずJSONだけを返してください。Markdown、説明文、コードブロックは禁止です。"
            },
            {
              role: "user",
              content: prompt
            }
          ]
        })
      });

      const raw = await aiResponse.text();

      if (!aiResponse.ok) {
        console.error("OpenAI API error:", raw);
        return jsonResponse({
          error: "AI生成でエラーが発生しました。",
          detail: raw
        }, 502);
      }

      const data = JSON.parse(raw);
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("AIの返答を読み取れませんでした。");
      }

      const result = JSON.parse(content);

      return jsonResponse(sanitizeResult(result, words, genre, viewpoint, length), 200);
    } catch (error) {
      console.error(error);
      return jsonResponse({
        error: "生成中にエラーが発生しました。",
        detail: String(error.message || error)
      }, 500);
    }
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders()
    }
  });
}

function validateInput(words, genre, viewpoint, length) {
  if (words.length !== 3 || words.some((word) => !word.trim())) {
    return "3つの言葉を入力してください。";
  }

  if (words.some((word) => word.length > 20)) {
    return "1つの言葉は20文字以内にしてください。";
  }

  const allowedGenres = [
    "日記",
    "随筆",
    "短い小説",
    "絵本風",
    "詩",
    "note本文",
    "Instagram投稿",
    "ミステリー風",
    "俳句・短歌風",
    "手紙風",
    "キャッチコピー",
    "コラム",
    "プロット"
  ];

  const allowedViewpoints = [
    "おまかせ",
    "自分目線",
    "第三者目線",
    "未来の自分",
    "過去の自分",
    "子どもの目線",
    "通りすがりの人",
    "物の目線"
  ];

  if (!allowedGenres.includes(genre)) return "文章タイプが正しくありません。";
  if (!allowedViewpoints.includes(viewpoint)) return "視点の指定が正しくありません。";

  if (!Number.isFinite(length) || length < 100 || length > 1000) {
    return "文字数は100〜1000字の範囲で指定してください。";
  }

  return null;
}

function buildPrompt(words, genre, viewpoint, length, retry) {
  const [a, b, c] = words;

  return `
あなたは「3語で整える」という文章発想ツールのAIです。

【目的】
3つの言葉を材料にして、文章を書く人のための「使える途中」を作る。
完成品を押しつけず、書き手が続きを考えたくなる文章のたたき台を作る。

【入力された3語】
${a}・${b}・${c}

【必ず反映する文章タイプ】
${genre}

【視点】
${viewpoint}

【本文の目安文字数】
${length}字前後

【再生成】
${retry ? "はい。前回とは違う切り口・展開・語り口にする。" : "いいえ。"}

【絶対条件】
- draft本文は、必ず「${genre}」として読めるものにする
- 文章タイプを無視して、普通の随筆風にしない
- 視点「${viewpoint}」を自然に反映する
- 3語「${a}」「${b}」「${c}」をすべて自然に使う
- 指定文字数に近づける。ただし無理に引き延ばさない
- 本文を途中で省略しない
- 「続きは〜」「以下省略」「…」で終わらせない
- 完成品ではなく、書き手が直したくなる余地を残す
- ありきたりな癒し文にしない
- 「少し」「小さな」「整える」「気づき」「余白」を多用しない

【文章タイプごとの必須ルール】
日記：
一日の記録として自然に書く。「今日」「帰り道」「ふと」など日記らしい実感を入れる。

随筆：
日常のものから考えを広げる。結論を急がず、考えの流れを見せる。

短い小説：
人物、場面、出来事、変化を入れる。説明文ではなく物語にする。

絵本風：
やさしい言葉で、情景と動きを入れる。子どもにも読める文章にする。

詩：
短い行分け、比喩、リズムを使う。説明しすぎない。

note本文：
タイトル性、導入、本文、読後の問いや余韻がある文章にする。段落を分ける。

Instagram投稿：
短い行で改行し、共感しやすく、最後に保存したくなる一言を入れる。

ミステリー風：
違和感、謎、引っかかりを入れる。怖すぎず、続きを読みたくなる入口にする。

俳句・短歌風：
俳句案、短歌案、季語候補、発想メモ、別案を必ず入れる。

手紙風：
誰かに宛てた自然な文章にする。「あなたへ」など手紙らしい距離感を入れる。

キャッチコピー：
コピー案を複数出す。短い案、やわらかい案、少し尖った案を分ける。狙いも添える。

コラム：
読み手に役立つ視点を入れる。日常の例から考えを広げる。

プロット：
本文を書かず、物語や記事の骨組みを作る。
必ず「タイトル案」「ジャンル」「主人公」「舞台」「きっかけ」「展開」「結末案」「使えそうな一文」「別ルート案」を含める。

【返すJSON】
必ずこの形式だけで返してください。

{
  "title": "タイトル案",
  "angle": "今回の切り口を一言で",
  "draft": "本文またはプロット。${genre}として読める内容。指定文字数に近づけ、省略しない。",
  "hint": "書き手向けの発想メモ",
  "altIdeas": [
    "別の切り口1",
    "別の切り口2",
    "別の切り口3"
  ],
  "cardTitle": "SNSカード用タイトル",
  "cardMain": "カード中央に置く短い言葉",
  "cardSub": "補足文"
}
`.trim();
}

function sanitizeResult(result, words, genre, viewpoint, length) {
  const [a, b, c] = words;

  const clean = {
    title: String(result.title || `${a}・${b}・${c}から`).trim().slice(0, 100),
    angle: String(result.angle || `${genre}として3語をつなぐ切り口`).trim().slice(0, 160),
    draft: String(result.draft || "").trim().slice(0, 8000),
    hint: String(result.hint || "この文章は完成品ではなく、書き出すためのたたき台です。").trim().slice(0, 600),
    altIdeas: Array.isArray(result.altIdeas)
      ? result.altIdeas.slice(0, 3).map(x => String(x || "").trim().slice(0, 160))
      : [],
    cardTitle: String(result.cardTitle || "3語で整える").trim().slice(0, 80),
    cardMain: String(result.cardMain || `${a}・${b}・${c}`).trim().slice(0, 120),
    cardSub: String(result.cardSub || `${genre}のたたき台`).trim().slice(0, 120),
    words,
    genre,
    viewpoint,
    length
  };

  while (clean.altIdeas.length < 3) {
    clean.altIdeas.push([
      `${a}を中心に書く`,
      `${b}を場面として使う`,
      `${c}を結末のきっかけにする`
    ][clean.altIdeas.length]);
  }

  if (!clean.draft) {
    clean.draft = `「${a}」「${b}」「${c}」。この3つの言葉を使って、${genre}として文章を始めるための入口を作ります。`;
  }

  return clean;
}
