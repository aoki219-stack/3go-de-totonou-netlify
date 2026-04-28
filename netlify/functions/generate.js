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
    const mode = String(body.mode || body.mood || "診断として見る");
    const retry = Boolean(body.retry);

    const validation = validateInput(words, mode);
    if (validation) return jsonResponse(400, { error: validation });

    const prompt = buildPrompt(words, mode, retry);

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: retry ? 0.95 : 0.8,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "あなたは『3語で整える』という日本語アプリの診断結果を作るAIです。必ずJSONだけを返してください。Markdown、説明文、コードブロックは禁止です。"
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
    return jsonResponse(200, sanitizeResult(result, words, mode));

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

function validateInput(words, mode) {
  if (words.length !== 3 || words.some((word) => !word.trim())) {
    return "3つの言葉を入力してください。";
  }

  if (words.some((word) => word.length > 20)) {
    return "1つの言葉は20文字以内にしてください。";
  }

  const allowedModes = [
    "診断として見る",
    "行動に変える",
    "心理学的に見る",
    "小説風に読む",
    "格言として読む",
    "処方箋風に出す"
  ];

  if (!allowedModes.includes(mode)) {
    return "結果の出し方が正しくありません。";
  }

  return null;
}

function buildPrompt(words, mode, retry) {
  const [a, b, c] = words;

  return `
あなたは「3語で整える」というアプリの診断結果を作ります。

【アプリの目的】
3つの言葉から、今の心の向きと今日の整え方を短く整理すること。
当てることではなく、整理することが目的です。

【最重要の前提】
入力された3語は、「これからやること」ではありません。
すでに目に留まったもの、頭に浮かんだもの、今いる場面の断片として扱ってください。

たとえば、
「黄色い・花・散歩」は、
これから散歩して花を探すという意味ではありません。
すでに散歩中に黄色い花が目に留まった、またはその3語がふと浮かんだ、という前提で読みます。

【入力語】
${a}・${b}・${c}

【結果の出し方】
${mode}

【再生成】
${retry ? "はい。前回と違う切り口で作る。" : "いいえ。"}

【絶対に禁止】
- 入力語と同じ行動をそのまま提案しない
- 「散歩」と入力された場合に「散歩しましょう」と言わない
- 「花」と入力された場合に「花を探しましょう」と言わない
- 「外」「空」「雨」「駅」「コンビニ」「帰り道」などを、これから行く場所として扱わない
- 「行動に移す一歩が必要です」のように、まだ何もしていない前提で書かない
- 「今日は外に出ましょう」のように、すでに外にいる可能性を無視しない
- 医療、治療、病名診断のような表現はしない
- 占いのように断定しすぎない
- 説教っぽくしない
- きれいなだけの文章にしない

【正しい読み方】
- 3語は、すでに見たもの・気になったもの・今いる場面の断片として読む
- 「何を見たか」より「それに反応した今の状態」を読む
- 提案は、追加行動よりも「受け取り方」「終わり方」「帰宅後の整え方」「今日これ以上増やさないこと」に寄せる
- 3語すべてを自然に反映する
- 今日の行動が1つ決まる内容にする

【良い例】
入力：黄色い・花・散歩

悪い：
今日は外に出て、黄色い花を探しましょう。

良い：
黄色い花が目に留まったこと自体に、今の反応が出ています。今日は新しい予定を足すより、帰ったあとにその場面を一言だけ残すとよさそうです。

良い：
散歩中に色や花へ意識が向いたなら、強い刺激よりも自然な明るさを拾いやすい状態かもしれません。

【余白タイプ例】
一時避難タイプ
情報過多タイプ
整理不足タイプ
動き出し前タイプ
人疲れタイプ
回復優先タイプ
境界線タイプ
保留タイプ
小さな挑戦タイプ
余白不足タイプ
観察回復タイプ
感覚優先タイプ
意味づけ保留タイプ

【結果の出し方ごとの方針】
診断として見る：
今の状態を冷静にはっきり整理する。

行動に変える：
今日これ以上増やさないこと、帰ってからすること、明日に回すことに落とす。

心理学的に見る：
注意、認知、感情の言語化、刺激への反応、負荷の下げ方として読む。

小説風に読む：
今いる場面を短い一場面として映す。次に何かをさせすぎない。

格言として読む：
3語から格言風の一文を作る。実在の名言は使わない。

処方箋風に出す：
処方、用法、避けたいことの形にする。ただし医療っぽく断定しすぎない。

【返すJSON】
次のJSON形式だけで返してください。

{
  "type": "今日の余白タイプ",
  "sign": "今のサイン。80字以内",
  "tuning": "今日の整え方。80字以内",
  "proposals": [
    { "label": "減らすこと", "text": "具体的な行動" },
    { "label": "残すこと", "text": "具体的な行動" },
    { "label": "避けること", "text": "具体的な行動" }
  ],
  "oneLine": "今日の一言",
  "reading": "読み解き。120字以内",
  "cardTitle": "SNSカード用タイトル",
  "cardMain": "カード中央の短い言葉",
  "cardSub": "カード補足文"
}
`.trim();
}

function sanitizeResult(result, words, mode) {
  const [a, b, c] = words;

  let proposals = Array.isArray(result.proposals) ? result.proposals : [];

  proposals = proposals.slice(0, 3).map((p) => ({
    label: String(p.label || "").trim().slice(0, 20),
    text: String(p.text || "").trim().slice(0, 80)
  }));

  while (proposals.length < 3) {
    proposals.push({
      label: ["減らすこと", "残すこと", "避けること"][proposals.length],
      text: "今日これ以上、予定を増やさない。"
    });
  }

  const clean = {
    type: String(result.type || "観察回復タイプ").trim().slice(0, 40),
    sign: String(
      result.sign ||
      `「${a}」「${b}」「${c}」に反応したこと自体が、今の心の向きを少し映しています。`
    ).trim().slice(0, 140),

    tuning: String(
      result.tuning ||
      "今日は新しい行動を足すより、見えたものをそのまま受け取る日です。"
    ).trim().slice(0, 140),

    proposals,

    oneLine: String(
      result.oneLine ||
      "目に留まったものは、今の心が拾ったしるし。"
    ).trim().slice(0, 70),

    reading: String(
      result.reading ||
      `「${a}」「${b}」「${c}」は、これから探すものではなく、すでに心が拾った断片として読めます。`
    ).trim().slice(0, 220),

    cardTitle: String(result.cardTitle || "今日の余白タイプ").trim().slice(0, 40),
    cardMain: String(
      result.cardMain ||
      result.oneLine ||
      "目に留まったものは、今の心が拾ったしるし。"
    ).trim().slice(0, 80),

    cardSub: String(result.cardSub || `${a}・${b}・${c}`).trim().slice(0, 80),
    mode
  };

  return clean;
}
