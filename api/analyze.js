
const { createClient } = require("@supabase/supabase-js");

function makeStats(rows) {
  const frequency = Array.from({ length: 45 }, (_, i) => ({
    number: i + 1,
    count: 0
  }));

  const oddEven = [
    { label: "홀수", count: 0 },
    { label: "짝수", count: 0 }
  ];

  const ranges = [
    { label: "1–10", count: 0 },
    { label: "11–20", count: 0 },
    { label: "21–30", count: 0 },
    { label: "31–40", count: 0 },
    { label: "41–45", count: 0 }
  ];

  for (const row of rows) {
    const numbers = Array.isArray(row.numbers)
      ? row.numbers.map(Number)
      : [];

    for (const n of numbers) {
      if (!Number.isInteger(n) || n < 1 || n > 45) continue;

      frequency[n - 1].count++;
      oddEven[n % 2 === 1 ? 0 : 1].count++;

      const rangeIndex = Math.min(Math.floor((n - 1) / 10), 4);
      ranges[rangeIndex].count++;
    }
  }

  return {
    roundCount: rows.length,
    latestRound: rows.length
      ? Math.max(...rows.map(row => Number(row.draw_number) || 0))
      : 0,
    frequency: frequency
      .sort((a, b) => b.count - a.count || a.number - b.number)
      .slice(0, 5),
    oddEven,
    ranges
  };
}

function makeCombination() {
  const pool = Array.from({ length: 45 }, (_, i) => i + 1);

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, 6).sort((a, b) => a - b);
}

async function getExplanation(stats, numbers) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Vercel의 GEMINI_API_KEY 설정을 확인해 주세요.");
  }

  const prompt = `
너는 로또 과거 당첨 번호 통계를 쉽게 설명하는 데이터 분석 도우미야.

아래 통계는 Supabase에 저장된 과거 데이터에서 계산했어.
추천 번호는 무작위로 생성했으며 당첨 예측이 아니야.

통계:
${JSON.stringify(stats)}

생성 번호:
${JSON.stringify(numbers)}

한국어로 쉽고 구체적으로 설명해.
출현 빈도가 높다고 미래 당첨 확률이 높다고 말하지 마.
데이터에서 확인할 수 없는 내용은 추측하지 마.

다음 JSON 형식으로만 답해. 마크다운은 사용하지 마.
{
  "summary": "분석 데이터와 회차 수 요약",
  "frequency": "출현 빈도 상위 번호와 그 한계",
  "distribution": "홀짝 비율과 번호 구간 분포",
  "combination": "생성된 번호 조합의 홀짝 및 구간 분포",
  "caution": "무작위 추첨과 과거 통계에 관한 주의사항"
}
`;

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.4
        }
      })
    }
  );

  if (!response.ok) {
    const details = await response.text();
    console.error("Gemini API error:", response.status, details);
    throw new Error(`Gemini API 요청 실패 (HTTP ${response.status})`);
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("");

  if (!text) {
    throw new Error("Gemini에서 분석 해설을 받지 못했습니다.");
  }

  let explanation;

  try {
    explanation = JSON.parse(text);
  } catch {
    throw new Error("AI 해설을 JSON으로 읽을 수 없습니다.");
  }

  for (const key of [
    "summary",
    "frequency",
    "distribution",
    "combination",
    "caution"
  ]) {
    if (typeof explanation[key] !== "string") {
      throw new Error("AI 해설의 응답 형식이 올바르지 않습니다.");
    }
  }

  return explanation;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      message: "POST 요청만 허용됩니다."
    });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return res.status(500).json({
      success: false,
      message:
        "Vercel 환경 변수 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 확인해 주세요."
    });
  }

  try {
    const supabase = createClient(url, key);

    const { data: rows, error } = await supabase
      .from("lotto_history")
      .select("draw_number, numbers")
      .order("draw_number", { ascending: false })
      .limit(1000);

    if (error) {
      console.error("Supabase query error:", error);

      return res.status(500).json({
        success: false,
        message: "Supabase 데이터 조회 오류: " + error.message
      });
    }

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "당첨 데이터가 없습니다. Supabase lotto_history 테이블에 회차별 당첨 번호를 먼저 저장해 주세요."
      });
    }

    const validRows = rows.filter(row =>
      Number.isInteger(Number(row.draw_number)) &&
      Array.isArray(row.numbers) &&
      row.numbers.length === 6 &&
      row.numbers.every(n =>
        Number.isInteger(Number(n)) &&
        Number(n) >= 1 &&
        Number(n) <= 45
      )
    );

    if (validRows.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "저장된 데이터 형식이 올바르지 않습니다. numbers에는 당첨 번호 6개가 배열로 저장되어야 합니다."
      });
    }

    const stats = makeStats(validRows);
    const numbers = makeCombination();
    const explanation = await getExplanation(stats, numbers);

    return res.status(200).json({
      success: true,
      numbers,
      statistics: stats,
      explanation
    });
  } catch (error) {
    console.error("Analysis error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "AI 분석 중 오류가 발생했습니다."
    });
  }
};
