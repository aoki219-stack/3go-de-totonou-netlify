exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "POSTメソッドで送信してください。" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!apiKey) {
      return jsonResponse(500, {
        error: "OPENAI_API_KEY が設定されていません。"
      });
    }

    const body = JSON.parse(event.body || "{}");
    const words = Array.isArray(body.words) ? body.words.map(String) : [];
    const mode = String(body.mood || body.mode || "診断として見る");
    const retry = Boolean(body.retry);

    const validation = validateInput(words, mode);
    if (validation) return jsonResponse(400, { error: validation });

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: retry ? 1.05 : 0.9,
        input: [
          { role: "system", content: buildSystemPrompt(mode, words) },
          { role: "user", content: buildUserPrompt(words, mode, retry) }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "three_words_condition",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string" },
                sign: { type: "string" },
                tuning: { type: "string" },
                proposals: {
                  type: "array",
                  minItems: 3,
                  maxItems: 3,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      label: { type: "string" },
                      text: { type: "string" }
                    },
                    required: ["label", "text"]
                  }
                },
                oneLine: { type: "string" },
                reading: { type: "string" },
                cardTitle: { type: "string" },
                cardMain: { type: "string" },
                cardSub: { type: "string" }
              },
              required: [
                "type",
                "sign",
                "tuning",
                "proposals",
                "oneLine",
                "reading",
                "cardTitle",
                "cardMain",
                "cardSub"
              ]
            }
          }
        }
      })
    });

    const raw = await aiResponse.text();

    if (!aiResponse.ok) {
      console.error("OpenAI API error:", raw);
      return jsonResponse(502, { error: "AI生成でエラーが発生しました。" });
    }

    const data = JSON.parse(raw);
    const outputText = extractOutputText(data);
    const result = JSON.parse(outputText);

    return jsonResponse(200, sanitizeResult(result, words, mode));
  } catch (error) {
    console.error(error);
    return jsonResponse(500, { error: "生成中にエラーが発生しました。" });
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
    "処方箋風に出す",
    "静かに整える",
    "前向きに整える",
    "学びとして整える",
    "少し不思議に整える"
  ];

  if (!allowedModes.includes(mode)) {
    return "結果の出し方が正しくありません。";
  }

  const joined = words.join(" ");
  const blocked = [
    /住所|電話番号|メールアドレス|パスワード|クレジットカード/i,
    /殺す|死ね|自殺|爆弾|薬物|違法/i
  ];

  if (blocked.some((pattern) => pattern.test(joined))) {
    return "個人情報や危険な内容は入力しないでください。";
  }

  return null;
}

function buildSystemPrompt(mode, words) {
  const [a, b, c] = words;

  return `
あなたは「3語で整える」というアプリの診断結果を作るAIです。

このアプリの目的：
3つの言葉から、今の心の向きと今日の整え方を短く整理すること。

大事な考え方：
当てることより、整理すること。
3語を心の状態そのものと断定しすぎない。
「今の心の向きが少し表れているかもしれない」くらいの距離感で書く。

入力語：
「${a}」「${b}」「${c}」

結果の出し方：
${mode}

必ず守ること：
- 「${a}」「${b}」「${c}」の3語すべてを自然に反映する
- 文章をきれいにまとめるより、今日の行動が1つ決まる内容にする
- 占いのように断定しすぎない
- 医療、治療、病名診断のような表現はしない
- 説教っぽくしない
- 「少し」「小さな」「整える」「余白」「気づき」「無理しない」「立ち止まる」を多用しない
- 毎回同じ型の文章にしない

出力項目：
type：今日の余白タイプ
sign：今のサイン
tuning：今日の整え方
proposals：3つの提案
oneLine：今日の一言
reading：読み解き
cardTitle：SNSカード用タイトル
cardMain：SNSカード中央の言葉
cardSub：SNSカード補足文

余白タイプ例：
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

結果の出し方ごとのルール：
- 診断として見る：今の状態を冷静にはっきり整理する
- 行動に変える：今日やること、やらないこと、明日に回すことに落とす
- 心理学的に見る：認知、感情、注意、負荷、言語化などの観点を入れる
- 小説風に読む：短い一場面のように客観視する
- 格言として読む：3語から格言風の一文を作り、短く読み解く
- 処方箋風に出す：処方、用法、避けたいことのように出す

JSONだけで返してください。
`.trim();
}

function buildUserPrompt(words, mode, retry) {
  const [a, b, c] = words;

  return `
3語：
${a}・${b}・${c}

結果の出し方：
${mode}

再生成：
${retry ? "はい。前回と違う切り口で作ってください。" : "いいえ。"}

返すJSON：
{
  "type": "今日の余白タイプ",
  "sign": "今のサイン。80字以内",
  "tuning": "今日の整え方。80字以内",
  "proposals": [
    {"label":"提案1の見出し","text":"具体的な行動。50字以内"},
    {"label":"提案2の見出し","text":"具体的な行動。50字以内"},
    {"label":"提案3の見出し","text":"避けること、減らすこと、明日に回すことなど。50字以内"}
  ],
  "oneLine": "今日の一言。35字以内",
  "reading": "読み解き。120字以内",
  "cardTitle": "SNSカード用タイトル",
  "cardMain": "SNSカード中央の短い言葉",
  "cardSub": "SNSカード補足文"
}
`.trim();
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;

  const texts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
    }
  }

  if (!texts.length) throw new Error("AIの出力を読み取れませんでした。");
  return texts.join("");
}

function sanitizeResult(result, words, mode) {
  const [a, b, c] = words;

  const proposals = Array.isArray(result.proposals)
    ? result.proposals.slice(0, 3).map((p) => ({
        label: String(p.label || "").trim().slice(0, 20),
        text: String(p.text || "").trim().slice(0, 80)
      }))
    : [];

  while (proposals.length < 3) {
    proposals.push({
      label: ["減らすこと", "入れること", "避けること"][proposals.length],
      text: "今日の予定を一つだけ軽くする。"
    });
  }

  const clean = {
    type: String(result.type || "一時避難タイプ").trim().slice(0, 40),
    sign: String(result.sign || "").trim().slice(0, 140),
    tuning: String(result.tuning || "").trim().slice(0, 140),
    proposals,
    oneLine: String(result.oneLine || "").trim().slice(0, 70),
    reading: String(result.reading || "").trim().slice(0, 220),
    cardTitle: String(result.cardTitle || "今日の余白タイプ").trim().slice(0, 40),
    cardMain: String(result.cardMain || "").trim().slice(0, 80),
    cardSub: String(result.cardSub || "").trim().slice(0, 80),
    mode
  };

  const allText = [
    clean.type,
    clean.sign,
    clean.tuning,
    clean.oneLine,
    clean.reading,
    clean.cardTitle,
    clean.cardMain,
    clean.cardSub,
    ...clean.proposals.map((p) => p.label + p.text)
  ].join("");

  if (!allText.includes(a) || !allText.includes(b) || !allText.includes(c)) {
    clean.reading = `「${a}」「${b}」「${c}」を並べると、今は考えを増やすより、今日やることを一つに絞る方が合いそうです。`;
  }

  if (!clean.sign) {
    clean.sign = `「${a}」「${b}」「${c}」には、今の負荷を一度下げたい感覚が出ています。`;
  }

  if (!clean.tuning) {
    clean.tuning = "今日は解決を急ぐより、手元の予定を一つ軽くする日です。";
  }

  if (!clean.oneLine) {
    clean.oneLine = "今日の自分に、逃げ場を一つ残す。";
  }

  if (!clean.cardMain) {
    clean.cardMain = clean.oneLine;
  }

  if (!clean.cardSub) {
    clean.cardSub = `${a}・${b}・${c}`;
  }

  return clean;
}
