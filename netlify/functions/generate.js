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
    if (validation) return jsonResponse(400, { error: validation });

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.95,
        input: [
          { role: "system", content: buildSystemPrompt(mood, words) },
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
      return jsonResponse(502, { error: "AI生成でエラーが発生しました。" });
    }

    const data = JSON.parse(raw);
    const outputText = extractOutputText(data);
    const result = JSON.parse(outputText);

    return jsonResponse(200, sanitizeResult(result, words));
  } catch (error) {
    console.error(error);
    return jsonResponse(500, { error: "生成中にエラーが発生しました。" });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}

function validateInput(words, mood) {
  if (words.length !== 3 || words.some((word) => !word.trim())) return "3つの言葉を入力してください。";
  if (words.some((word) => word.length > 20)) return "1つの言葉は20文字以内にしてください。";
  const allowedMoods = ["静かに整える", "前向きに整える", "学びとして整える", "少し不思議に整える"];
  if (!allowedMoods.includes(mood)) return "雰囲気の指定が正しくありません。";
  const joined = words.join(" ");
  const blocked = [/住所|電話番号|メールアドレス|パスワード|クレジットカード/i, /殺す|死ね|自殺|爆弾|薬物|違法/i];
  if (blocked.some((pattern) => pattern.test(joined))) return "個人情報や危険な内容は入力しないでください。";
  return null;
}

function buildSystemPrompt(mood, words) {
  const [a, b, c] = words;
  const moodRules = {
    "静かに整える": "静かで落ち着いた内省文。余白、立ち止まる、眺める、呼吸の感覚を使う。",
    "前向きに整える": "明日へつながる前向きな文体。小さな行動、一歩、試してみる方向にする。",
    "学びとして整える": "心理学や認知、感情の言語化などの説明を少し入れる。知的で具体的にする。",
    "少し不思議に整える": "偶然、合図、物語、手紙、景色などの比喩を使い、余韻を残す。"
  };

  return `
あなたは「3語で整える」という内省アプリの文章生成AIです。

入力語は「${a}」「${b}」「${c}」です。

最重要：
- themeには「${a}」「${b}」「${c}」のうち最低2語を必ず入れる
- insightの冒頭文には「${a}」「${b}」「${c}」を必ずすべて入れる
- thanks/improve/goalの3つを合わせて「${a}」「${b}」「${c}」がすべて出るようにする
- phraseには「${a}」「${b}」「${c}」のうち最低1語を必ず入れる
- 雰囲気「${mood}」で文体をはっきり変える

雰囲気ルール：
${moodRules[mood] || moodRules["静かに整える"]}

共通ルール：
- 占いのように断定しすぎない
- 医療的、診断的、治療的な表現はしない
- 説教っぽくしない
- insightは180〜280字程度
- phraseは短く印象的に
- JSONのみで返す
`.trim();
}

function buildUserPrompt(words, mood, retry) {
  const [a, b, c] = words;
  return `
入力キーワード：
1. ${a}
2. ${b}
3. ${c}

雰囲気：
${mood}

再生成：
${retry ? "はい。前回と違う角度で作ってください。" : "いいえ。"}

JSON形式で返してください。

{
  "theme": "必ず3語のうち最低2語を含める",
  "insight": "冒頭に必ず「${a}」「${b}」「${c}」を含める",
  "thanks": "感謝の1行",
  "improve": "改善の1行",
  "goal": "目標の1行",
  "phrase": "必ず3語のうち最低1語を含める"
}
`.trim();
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const texts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") texts.push(content.text);
    }
  }
  if (!texts.length) throw new Error("AIの出力を読み取れませんでした。");
  return texts.join("");
}

function sanitizeResult(result, words) {
  const [a, b, c] = words;
  const clean = {};
  for (const key of ["theme", "insight", "thanks", "improve", "goal", "phrase"]) {
    clean[key] = String(result[key] || "").trim().slice(0, key === "insight" ? 700 : 180);
  }

  if (!clean.theme.includes(a) && !clean.theme.includes(b) && !clean.theme.includes(c)) {
    clean.theme = `${a}・${b}・${c}から見える小さな気づき`;
  }
  const countThemeWords = [a, b, c].filter(w => clean.theme.includes(w)).length;
  if (countThemeWords < 2) clean.theme = `${a}・${b}から見える、${c}の気配`;

  if (!clean.insight.includes(a) || !clean.insight.includes(b) || !clean.insight.includes(c)) {
    clean.insight = `「${a}」「${b}」「${c}」という3つの言葉から見ると、` + clean.insight;
  }

  const diaryAll = clean.thanks + clean.improve + clean.goal;
  if (!diaryAll.includes(a)) clean.thanks = `「${a}」に気づけたことを大切にする。`;
  if (!diaryAll.includes(b)) clean.improve = `「${b}」を見過ごしていたかもしれない。明日は少し意識してみる。`;
  if (!diaryAll.includes(c)) clean.goal = `明日は「${c}」に関係する小さな行動をひとつ試してみる。`;

  if (!clean.phrase.includes(a) && !clean.phrase.includes(b) && !clean.phrase.includes(c)) {
    clean.phrase = `${a}・${b}・${c}は、今日を整える小さな入口になる。`;
  }

  return clean;
}
