exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "POSTメソッドで送信してください。" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!apiKey) {
      return jsonResponse(500, {
        error: "OPENAI_API_KEY が設定されていません。NetlifyのEnvironment variablesに追加してください。"
      });
    }

    const body = JSON.parse(event.body || "{}");
    const words = Array.isArray(body.words) ? body.words.map(String) : [];
    const mood = String(body.mood || "静かに整える");
    const retry = Boolean(body.retry);

    const validation = validateInput(words, mood);
    if (validation) {
      return jsonResponse(400, { error: validation });
    }

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.85,
        input: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(words, mood, retry) }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "three_words_reflection",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                theme: { type: "string" },
                insight: { type: "string" },
                thanks: { type: "string" },
                improve: { type: "string" },
                goal: { type: "string" },
                phrase: { type: "string" }
              },
              required: ["theme", "insight", "thanks", "improve", "goal", "phrase"]
            }
          }
        }
      })
    });

    const raw = await aiResponse.text();

    if (!aiResponse.ok) {
      console.error("OpenAI API error:", raw);
      return jsonResponse(502, {
        error: "AI生成でエラーが発生しました。APIキーや利用上限を確認してください。"
      });
    }

    const data = JSON.parse(raw);
    const outputText = extractOutputText(data);
    const result = JSON.parse(outputText);

    return jsonResponse(200, sanitizeResult(result));
  } catch (error) {
    console.error(error);
    return jsonResponse(500, {
      error: "生成中にエラーが発生しました。少し内容を変えてもう一度お試しください。"
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

function validateInput(words, mood) {
  if (words.length !== 3 || words.some((word) => !word.trim())) {
    return "3つの言葉を入力してください。";
  }

  if (words.some((word) => word.length > 20)) {
    return "1つの言葉は20文字以内にしてください。";
  }

  const allowedMoods = [
    "静かに整える",
    "前向きに整える",
    "学びとして整える",
    "少し不思議に整える"
  ];

  if (!allowedMoods.includes(mood)) {
    return "雰囲気の指定が正しくありません。";
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

function buildSystemPrompt() {
  return `
あなたは「3語で整える」という内省アプリの文章生成AIです。

ユーザーが入力した3つの言葉をもとに、
今日の小さな気づきと、感謝・改善・目標の3行日記を作ってください。

目的：
読者が、何気なく入力した3語から、
「なるほど、今の自分にはこういう見方もあるのか」
と感じられるようにすること。

出力ルール：
- 占いのように断定しすぎない
- 「あなたはこういう人です」と決めつけない
- 医療的、診断的、治療的な表現はしない
- 心理学や日常の気づきを少し含める
- 説教っぽくしない
- やさしいが、ふわっとしすぎない
- 少し知的で、落ち着いた文体にする
- insightは180〜260字程度
- 3行日記は「感謝・改善・目標」の形にする
- phraseは短く、印象に残る一文にする
- 未来、性格、健康状態を断定しない
- 医療、法律、金銭、人間関係の重大判断を助言しない

必ずJSONのみで返してください。
`.trim();
}

function buildUserPrompt(words, mood, retry) {
  return `
入力キーワード：
1. ${words[0]}
2. ${words[1]}
3. ${words[2]}

雰囲気：
${mood}

再生成：
${retry ? "はい。前回と少し違う角度で作ってください。" : "いいえ。"}

次のJSON形式で返してください。

{
  "theme": "見えてきたテーマ。短く印象的に。",
  "insight": "今日のなるほど。読者がなるほどと思える具体的な気づき。",
  "thanks": "感謝の1行。",
  "improve": "改善の1行。反省を責めず、次への教訓にする。",
  "goal": "目標の1行。明日できる小さな行動にする。",
  "phrase": "今日の一言。短く印象的に。"
}
`.trim();
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  const texts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
    }
  }

  if (!texts.length) {
    throw new Error("AIの出力を読み取れませんでした。");
  }

  return texts.join("");
}

function sanitizeResult(result) {
  const clean = {};
  for (const key of ["theme", "insight", "thanks", "improve", "goal", "phrase"]) {
    clean[key] = String(result[key] || "").trim().slice(0, key === "insight" ? 600 : 160);
  }

  if (Object.values(clean).some((value) => !value)) {
    throw new Error("AIの出力形式が不完全です。");
  }

  return clean;
}
