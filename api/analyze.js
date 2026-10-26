
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
    const numbers = [
      row.num1, row.num2, row.num3,
      row.num4, row.num5, row.num6
    ].map(Number);

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
      ? Math.max(...rows.map((row) => Number(row.round) || 0))
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
너는 로또 과거 데이터 통계를 쉽게 설명하는 데이터 분석 도우미야.

아래 통계는 실제 과거 당첨 데이터에서 계산한 값이야.
분석 조합은 무작위로 생성되었으며, 미래 당첨 예측 결과가 아니야.

분석 데이터:
${JSON.stringify(stats)}

참고 조합:
${JSON.stringify(numbers)}

한국어로 설명해. 과장하지 말고, 출현 빈도가 높다고 미래 당첨 가능성이 높다고 말하지 마.
정확한 수치가 제공되지 않은 사실은 추측하지 마.
아래 JSON 형식으로만 답해. 마크다운 코드 블록은 쓰지 마.

{
  "summary": "분석한 데이터와 회차 수에 대한 쉬운 요약",
  "frequency": "출현 빈도 상위 번호 통계의 의미와 한계",
  "distribution": "홀짝 비율 및 번호 구간 분포의 특징",
  "combination": "생성된 번호 조합의 홀짝 및 구간 분포를 설명",
  "caution": "과거 통계와 무작위 추첨에 관한 주의사항"
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
    ?.map((part) => part.text || "")
    .join("");

  if (!text) {
    throw new Error("Gemini에서 분석 해설을 받지 못했습니다.");
  }

  const explanation = JSON.parse(text);

  for (const key of [
    "summary", "frequency", "distribution", "combination", "caution"
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
      message: "Supabase 서버 환경 변수를 확인해 주세요."
    });
  }

  try {
    const supabase = createClient(url, key);

    const { data: rows, error } = await supabase
      .from("lotto_history")
      .select("round, draw_date, num1, num2, num3, num4, num5, num6, bonus")
      .order("round", { ascending: false })
      .limit(1000);

    if (error) {
      console.error("Supabase query error:", error);
      throw new Error("당첨 데이터 조회에 실패했습니다. 테이블과 컬럼을 확인해 주세요.");
    }

    if (!rows || rows.length === 0) {
      throw new Error("lotto_history 테이블에 당첨 데이터가 없습니다.");
    }

    const stats = makeStats(rows);
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
