exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "POSTメソッドで送信してください。" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!apiKey) {
      return jsonResponse(500, { error: "OPENAI_API_KEY が設定されていません。" });
    }

    const body = JSON.parse(event.body || "{}");

    const words = Array.isArray(body.words) ? body.words.map(String) : [];
    const genre = String(body.genre || body.mode || body.mood || "随筆");
    const viewpoint = String(body.viewpoint || "おまかせ");
    const length = Number(body.length || 800);
    const retry = Boolean(body.retry);

    const validation = validateInput(words, genre, viewpoint, length);
    if (validation) return jsonResponse(400, { error: validation });

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
      return jsonResponse(502, {
        error: "AI生成でエラーが発生しました。",
        detail: raw
      });
    }

    const data = JSON.parse(raw);
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("AIの返答を読み取れませんでした。");
    }

    const result = JSON.parse(content);

    return jsonResponse(200, sanitizeResult(result, words, genre, viewpoint, length));
  } catch (error) {
    console.error(error);
    return jsonResponse(500, {
      error: "生成中にエラーが発生しました。",
      detail: String(error.message || error)
    });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
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
    "コラム"
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

  if (!allowedGenres.includes(genre)) {
    return "文章タイプが正しくありません。";
  }

  if (!allowedViewpoints.includes(viewpoint)) {
    return "視点の指定が正しくありません。";
  }

  if (!Number.isFinite(length) || length < 100 || length > 3000) {
    return "文字数は100〜3000字の範囲で指定してください。";
  }

  return null;
}

function buildPrompt(words, genre, viewpoint, length, retry) {
  const [a, b, c] = words;

  return `
あなたは「3語で整える」という文章発想ツールのAIです。

【アプリの目的】
3つの言葉を材料にして、文章を書く人のための「使える途中」を作ること。
完成品を押しつけるのではなく、発想の入口、下書き、別角度のヒントを出してください。

【入力された3語】
${a}・${b}・${c}

【文章タイプ】
${genre}

【視点】
${viewpoint}

【目安文字数】
${length}字前後

【再生成】
${retry ? "はい。前回とは違う切り口・視点・展開にしてください。" : "いいえ。"}

【大事な方針】
- 3語をすべて自然に使う
- 3語をただ並べるだけにしない
- 3語の関係から、思わぬ切り口を作る
- 完成度よりも、書く人が続きを考えたくなる余白を残す
- 説明しすぎない
- きれいにまとめすぎない
- ありきたりな癒し文にしない
- 「少し」「小さな」「整える」「気づき」「余白」を多用しない
- そのまま投稿にも使えるが、書き手が直したくなる余地も残す

【文章タイプ別の方針】
日記：
今日の出来事のように自然に書く。個人的な実感を入れる。

随筆：
日常のものから考えを広げる。押しつけず、静かに考える。

短い小説：
場面、人物、変化を入れる。短くても物語として読めるようにする。

絵本風：
やさしく、情景が浮かぶように。子どもにも読める言葉にする。

詩：
説明よりもリズムと余韻を大切にする。

note本文：
読みやすい段落で、テーマを立て、考えが少し深まる文章にする。

Instagram投稿：
短めの行、共感しやすい言葉、最後に保存したくなる一言を入れる。

ミステリー風：
不穏さ、違和感、謎の入口を作る。ただし怖すぎない。

俳句・短歌風：
俳句案、短歌案、季語候補、発想メモ、別案を出す。

手紙風：
誰かに宛てた自然な文章にする。宛名はぼかしてよい。

キャッチコピー：
短いコピー案を複数出し、それぞれの狙いも短く添える。

コラム：
読み手に役立つ視点を入れる。日常の例から少し考えを広げる。

【視点の扱い】
おまかせ：
文章タイプに合う視点を自由に選ぶ。

自分目線：
「私」の実感として書く。

第三者目線：
人物や景色を外側から見る。

未来の自分：
未来の自分が今を振り返るように書く。

過去の自分：
昔の自分に語りかけるように書く。

子どもの目線：
難しい言葉を避け、素直な発見として書く。

通りすがりの人：
少し距離のある観察者として書く。

物の目線：
入力語のどれか一つを語り手にしてよい。

【返すJSON】
次の形式だけで返してください。

{
  "title": "タイトル案",
  "angle": "今回の切り口を一言で",
  "draft": "本文または作品",
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
    title: String(result.title || `${a}・${b}・${c}から`).trim().slice(0, 80),
    angle: String(result.angle || "3つの言葉をつないだ文章の入口").trim().slice(0, 120),
    draft: String(result.draft || "").trim().slice(0, 5000),
    hint: String(result.hint || "この文章は、完成品というより発想のたたき台として使えます。").trim().slice(0, 400),
    altIdeas: Array.isArray(result.altIdeas)
      ? result.altIdeas.slice(0, 3).map((x) => String(x || "").trim().slice(0, 120))
      : [],
    cardTitle: String(result.cardTitle || "3語で整える").trim().slice(0, 60),
    cardMain: String(result.cardMain || `${a}・${b}・${c}`).trim().slice(0, 100),
    cardSub: String(result.cardSub || "言葉から文章の入口を作る").trim().slice(0, 100),
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
    clean.draft = `「${a}」「${b}」「${c}」。この3つを並べると、まだ文章になる前の景色が見えてきます。ここから先は、出来事として書いてもいいし、誰かの記憶として書いてもいい。大事なのは、正解を探すことではなく、言葉が動き出す方向を見つけることです。`;
  }

  return clean;
}
