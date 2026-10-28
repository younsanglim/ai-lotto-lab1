
const { createClient } = require("@supabase/supabase-js");

const GEMINI_MODEL = "gemini-3.8-flash";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase 환경 변수를 확인해 주세요. SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다."
    );
  }

  return createClient(url, key);
}

function normalizeNumbers(value) {
  let numbers = value;

  // numbers가 문자열로 반환되는 경우도 처리
  if (typeof numbers === "string") {
    try {
      numbers = JSON.parse(numbers);
    } catch {
      numbers = numbers
        .replace(/[\[\]{}]/g, "")
        .split(",")
        .map((n) => Number(n.trim()));
    }
  }

  if (!Array.isArray(numbers)) {
    return null;
  }

  const parsed = numbers.map(Number);

  if (
    parsed.length !== 6 ||
    parsed.some(
      (n) => !Number.isInteger(n) || n < 1 || n > 45
    ) ||
    new Set(parsed).size !== 6
  ) {
    return null;
  }

  return parsed.sort((a, b) => a - b);
}

function makeStats(rows) {
  const frequency = Array(46).fill(0);
  let totalNumbers = 0;

  for (const row of rows) {
    const numbers = normalizeNumbers(row.numbers);
    if (!numbers) continue;

    for (const n of numbers) {
      frequency[n]++;
      totalNumbers++;
    }
  }

  const ranked = Array.from({ length: 45 }, (_, i) => ({
    number: i + 1,
    count: frequency[i + 1],
  }));

  const hotNumbers = [...ranked]
    .sort((a, b) => b.count - a.count || a.number - b.number)
    .slice(0, 10);

  const coldNumbers = [...ranked]
    .sort((a, b) => a.count - b.count || a.number - b.number)
    .slice(0, 10);

  return {
    totalDraws: rows.filter(
      (row) => normalizeNumbers(row.numbers)
    ).length,
    totalNumbers,
    hotNumbers,
    coldNumbers,
  };
}

function makeCombination() {
  const selected = new Set();

  while (selected.size < 6) {
    selected.add(Math.floor(Math.random() * 45) + 1);
  }

  return [...selected].sort((a, b) => a - b);
}

async function getExplanation(numbers, stats) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY 환경 변수가 없습니다. Vercel 설정을 확인해 주세요."
    );
  }

  const hotText = stats.hotNumbers
    .map((item) => `${item.number}번(${item.count}회)`)
    .join(", ");

  const coldText = stats.coldNumbers
    .map((item) => `${item.number}번(${item.count}회)`)
    .join(", ");

  const prompt = `
너는 AI 로또 연구소의 번호 통계 해설 담당자야.

다음 데이터를 바탕으로 한국어 해설을 작성해 줘.

분석 대상 번호: ${numbers.join(", ")}
분석에 사용한 유효 회차 수: ${stats.totalDraws}회
과거 출현 빈도가 높은 번호: ${hotText}
과거 출현 빈도가 낮은 번호: ${coldText}

다음 내용을 쉬운 말로 설명해 줘.
1. 추천 번호 6개의 특징
2. 홀수와 짝수의 구성
3. 1~22와 23~45 구간의 구성
4. 과거 출현 빈도 통계와의 관계
5. 분석의 한계

번호를 추천한 이유를 통계적으로 설명하되,
당첨 가능성이 높다고 단정하지 마.
과거 출현 횟수가 미래 당첨 확률을 높여 주는 것처럼
표현하지 마.
학생도 이해할 수 있도록 4~6문장으로 작성해 줘.
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 800,
        },
      }),
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Gemini API 요청 실패 (HTTP ${response.status}): ${responseText}`
    );
  }

  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("Gemini 응답을 JSON으로 읽을 수 없습니다.");
  }

  const explanation = result.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  if (!explanation) {
    throw new Error(
      "Gemini가 해설을 반환하지 않았습니다: " +
        JSON.stringify(result.promptFeedback || {})
    );
  }

  return explanation;
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

    const { data: rows, error: dbError } = await supabase
      .from("lotto_history")
      .select("draw_number, numbers")
      .order("draw_number", { ascending: false })
      .limit(1000);

    if (dbError) {
      throw new Error(
        `Supabase 데이터 조회 실패: ${dbError.message}`
      );
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
        "유효한 당첨 번호가 없습니다. numbers는 1~45 사이의 숫자 6개 배열이어야 합니다."
      );
    }

    const stats = makeStats(validRows);
    const numbers = makeCombination();

    const explanation = await getExplanation(numbers, stats);

    return res.status(200).json({
      success: true,
      numbers,
      recommendedNumbers: numbers,
      explanation,
      aiExplanation: explanation,
      analysis: explanation,
      stats,
      totalDraws: stats.totalDraws,
      message: "AI 번호 분석이 완료되었습니다.",
    });
  } catch (error) {
    console.error("Analysis error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "알 수 없는 분석 오류가 발생했습니다.",
      message: error.message || "분석에 실패했습니다.",
    });
  }
};
