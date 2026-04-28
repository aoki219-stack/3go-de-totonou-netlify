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
    const mode = String(body.mode || body.mood || "診断として見る");
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
        temperature: retry ? 1.0 : 0.85,
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
      return jsonResponse(502, {
        error: "AI生成でエラーが発生しました。",
        detail: raw
      });
    }

    const data = JSON.parse(raw);
    const outputText = extractOutputText(data);
    const result = JSON.parse(outputText);

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
    "処方箋風に出す",
    "静かに整える",
    "前向きに整える",
    "学びとして整える",
    "少し不思議に整える"
  ];

  if (!allowedModes.includes(mode)) {
    return "結果の出し方が正しくありません。";
  }

  return null;
}

function buildSystemPrompt(mode, words) {
  const [a, b, c] = words;

  return `
あなたは「3語で整える」というアプリの診断結果を作るAIです。

目的：
3つの言葉から、今の心の向きと今日の整え方を短く整理すること。

大事な考え方：
当てることより、整理すること。
断定しすぎず、「そういう見方もできる」くらいの距離感で書く。

入力語：
「${a}」「${b}」「${c}」

結果の出し方：
${mode}

必ず守ること：
- 3語すべてを自然に反映する
- 今日の行動が1つ決まる内容にする
- 医療、治療、病名診断のような表現はしない
- 説教っぽくしない
- 同じ表現を繰り返さない
- JSONだけで返す

余白タイプ例：
一時避難タイプ、情報過多タイプ、整理不足タイプ、動き出し前タイプ、人疲れタイプ、回復優先タイプ、境界線タイプ、保留タイプ、小さな挑戦タイプ、余白不足タイプ
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
${retry ? "はい。前回と違う切り口で。" : "いいえ。"}

次のJSON形式で返してください。

{
  "type": "今日の余白タイプ",
  "sign": "今のサイン。80字以内",
  "tuning": "今日の整え方。80字以内",
  "proposals": [
    {"label":"減らすこと","text":"具体的な行動"},
    {"label":"入れること","text":"具体的な行動"},
    {"label":"避けること","text":"具体的な行動"}
  ],
  "oneLine": "今日の一言",
  "reading": "読み解き。120字以内",
  "cardTitle": "SNSカード用タイトル",
  "cardMain": "カード中央の短い言葉",
  "cardSub": "カード補足文"
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

  let proposals = Array.isArray(result.proposals) ? result.proposals : [];

  proposals = proposals.slice(0, 3).map((p) => ({
    label: String(p.label || "").trim().slice(0, 20),
    text: String(p.text || "").trim().slice(0, 80)
  }));

  while (proposals.length < 3) {
    proposals.push({
      label: ["減らすこと", "入れること", "避けること"][proposals.length],
      text: "今日の予定を一つだけ軽くする。"
    });
  }

  const clean = {
    type: String(result.type || "保留タイプ").trim().slice(0, 40),
    sign: String(result.sign || "").trim().slice(0, 140),
    tuning: String(result.tuning || "").trim().slice(0, 140),
    proposals,
    oneLine: String(result.oneLine || "").trim().slice(0, 70),
    reading: String(result.reading || "").trim().slice(0, 220),
    cardTitle: String(result.cardTitle || "今日の余白タイプ").trim().slice(0, 40),
    cardMain: String(result.cardMain || "").trim().slice(0, 80),
    cardSub: String(result.cardSub || `${a}・${b}・${c}`).trim().slice(0, 80),
    mode
  };

  if (!clean.sign) {
    clean.sign = `「${a}」「${b}」「${c}」には、今の負荷を一度下げたい感覚が出ています。`;
  }

  if (!clean.tuning) {
    clean.tuning = "今日は解決を急ぐより、手元の予定を一つ軽くする日です。";
  }

  if (!clean.oneLine) {
    clean.oneLine = "今日の自分に、逃げ場を一つ残す。";
  }

  if (!clean.reading) {
    clean.reading = `「${a}」「${b}」「${c}」を並べると、今日は考えを増やすより、行動を一つに絞る方が合いそうです。`;
  }

  if (!clean.cardMain) {
    clean.cardMain = clean.oneLine;
  }

  return clean;
}
