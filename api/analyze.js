
const { createClient } = require("@supabase/supabase-js");

const GEMINI_MODEL = "gemini-2.5-flash";

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase 환경 변수 SUPABASE_URL 또는 서버용 키가 없습니다."
    );
  }

  return createClient(url, key);
}

function normalizeNumbers(value) {
  let arr = value;

  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = arr.replace(/[\[\]{}]/g, "").split(",");
    }
  }

  if (!Array.isArray(arr)) return null;

  arr = arr.map(Number);

  if (
    arr.length !== 6 ||
    arr.some((n) => !Number.isInteger(n) || n < 1 || n > 45) ||
    new Set(arr).size !== 6
  ) {
    return null;
  }

  return arr.sort((a, b) => a - b);
}

function makeStats(rows) {
  const frequency = Array(46).fill(0);
  let totalDraws = 0;

  for (const row of rows) {
    const nums = normalizeNumbers(row.numbers);
    if (!nums) continue;

    totalDraws++;

    for (const n of nums) {
      frequency[n]++;
    }
  }

  const ranking = Array.from({ length: 45 }, (_, i) => ({
    number: i + 1,
    count: frequency[i + 1],
  }));

  return {
    totalDraws,
    hotNumbers: [...ranking]
      .sort((a, b) => b.count - a.count || a.number - b.number)
      .slice(0, 10),
    coldNumbers: [...ranking]
      .sort((a, b) => a.count - b.count || a.number - b.number)
      .slice(0, 10),
  };
}

function makeCombination() {
  const result = new Set();

  while (result.size < 6) {
    result.add(Math.floor(Math.random() * 45) + 1);
  }

  return [...result].sort((a, b) => a - b);
}

function makeFallbackExplanation(numbers, stats) {
  const odd = numbers.filter((n) => n % 2 === 1).length;
  const low = numbers.filter((n) => n <= 22).length;

  const hot = stats.hotNumbers
    .slice(0, 5)
    .map((x) => `${x.number}번(${x.count}회)`)
    .join(", ");

  return [
    `분석 번호는 ${numbers.join(", ")}입니다.`,
    `홀수 ${odd}개, 짝수 ${6 - odd}개로 구성되어 있습니다.`,
    `1~22 구간은 ${low}개, 23~45 구간은 ${6 - low}개입니다.`,
    `저장된 ${stats.totalDraws}회 데이터에서 출현 빈도가 높은 번호는 ${hot || "아직 없습니다"}.`,
    "이 해설은 과거 기록을 요약한 것이며 미래 당첨을 예측하거나 당첨 확률을 높여 주지는 않습니다.",
    "현재 AI 서버가 응답하지 않아 기본 통계 해설을 표시했습니다.",
  ].join(" ");
}

async function getExplanation(numbers, stats) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY 환경 변수가 없습니다.");
  }

  const prompt = `
다음 로또 번호의 통계 해설을 쉬운 한국어로 4~6문장 작성해 줘.
분석 번호: ${numbers.join(", ")}
분석한 회차 수: ${stats.totalDraws}
출현 빈도가 높은 번호: ${stats.hotNumbers
    .slice(0, 10)
    .map((x) => `${x.number}번 ${x.count}회`)
    .join(", ")}
출현 빈도가 낮은 번호: ${stats.coldNumbers
    .slice(0, 10)
    .map((x) => `${x.number}번 ${x.count}회`)
    .join(", ")}

번호 구성과 과거 출현 빈도를 설명해 줘.
과거 기록이 미래 당첨 확률을 높여 준다고 말하지 마.
`;

  let lastError = "";

  // 최대 3회 요청, 실패할 때마다 대기 시간을 늘림
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 800,
            },
          }),
        }
      );

      const body = await response.text();

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${body}`;

        // 일시적인 서버 오류에 대해서만 재시도
        if (
          ![408, 429, 500, 502, 503, 504].includes(response.status)
        ) {
          throw new Error(lastError);
        }
      } else {
        const data = JSON.parse(body);
        const text = data.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || "")
          .join("")
          .trim();

        if (text) return { explanation: text, aiUsed: true };

        lastError = "Gemini가 해설을 반환하지 않았습니다.";
      }
    } catch (error) {
      lastError = error.message || String(error);

      if (
        !/HTTP (408|429|500|502|503|504)/.test(lastError) &&
        !/fetch failed|network|timeout/i.test(lastError)
      ) {
        throw error;
      }
    }

    if (attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
    }
  }

  console.error("Gemini 재시도 실패:", lastError);

  return {
    explanation: makeFallbackExplanation(numbers, stats),
    aiUsed: false,
    aiError: lastError,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: "POST 요청만 허용됩니다.",
    });
  }

  try {
    const supabase = getSupabase();

    const { data: rows, error } = await supabase
      .from("lotto_history")
      .select("draw_number, numbers")
      .order("draw_number", { ascending: false })
      .limit(1000);

    if (error) {
      throw new Error(`Supabase 조회 실패: ${error.message}`);
    }

    if (!rows || rows.length === 0) {
      throw new Error(
        "당첨 데이터가 없습니다. lotto_history 테이블을 확인해 주세요."
      );
    }

    const validRows = rows.filter(
      (row) =>
        Number.isInteger(Number(row.draw_number)) &&
        Number(row.draw_number) > 0 &&
        normalizeNumbers(row.numbers) !== null
    );

    if (validRows.length === 0) {
      throw new Error(
        "유효한 당첨 번호가 없습니다. numbers 배열을 확인해 주세요."
      );
    }

    const stats = makeStats(validRows);
    const numbers = makeCombination();
    const aiResult = await getExplanation(numbers, stats);

    return res.status(200).json({
      success: true,
      numbers,
      recommendedNumbers: numbers,
      explanation: aiResult.explanation,
      aiExplanation: aiResult.explanation,
      analysis: aiResult.explanation,
      aiUsed: aiResult.aiUsed,
      aiError: aiResult.aiError || null,
      stats,
      totalDraws: stats.totalDraws,
      message: aiResult.aiUsed
        ? "AI 분석이 완료되었습니다."
        : "기본 통계 분석을 표시했습니다. AI 서버는 일시적으로 사용할 수 없습니다.",
    });
  } catch (error) {
    console.error("Analysis error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "분석에 실패했습니다.",
      message: error.message || "분석에 실패했습니다.",
    });
  }
};
