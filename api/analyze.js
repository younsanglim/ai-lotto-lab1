
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
    const nums = row.numbers.map(Number);

    for (const n of nums) {
      if (!Number.isInteger(n) || n < 1 || n > 45) continue;

      frequency[n - 1].count++;
      oddEven[n % 2 === 1 ? 0 : 1].count++;

      const index = Math.min(Math.floor((n - 1) / 10), 4);
      ranges[index].count++;
    }
  }

  return {
    roundCount: rows.length,
    latestRound: Math.max(
      ...rows.map(row => Number(row.draw_number) || 0)
    ),
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
    throw new Error("Vercel 환경 변수 GEMINI_API_KEY가 없습니다.");
  }

  const prompt = `
한국어로 로또 과거 통계를 쉽게 설명해 줘.

통계: ${JSON.stringify(stats)}
무작위 생성 번호: ${JSON.stringify(numbers)}

과거 출현 빈도가 미래 당첨 확률을 높인다고 말하지 마.
번호 조합은 당첨 예측이 아니라고 설명해.
아래 JSON 형식으로만 답해. 마크다운은 사용하지 마.

{
  "summary": "분석 데이터 요약",
  "frequency": "출현 빈도 해설",
  "distribution": "홀짝과 번호 구간 해설",
  "combination": "생성된 번호 조합 해설",
  "caution": "주의사항"
}
`;

  const response = await fetch(
    ""https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-latest:generateContent",",
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
    const detail = await response.text();
    console.error("Gemini API error:", response.status, detail);
    throw new Error(`Gemini API 요청 실패 (HTTP ${response.status})`);
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("");

  if (!text) {
    throw new Error("Gemini가 분석 결과를 반환하지 않았습니다.");
  }

  let explanation;

  try {
    explanation = JSON.parse(text);
  } catch {
    throw new Error("Gemini 응답을 JSON으로 읽지 못했습니다.");
  }

  for (const key of [
    "summary",
    "frequency",
    "distribution",
    "combination",
    "caution"
  ]) {
    if (typeof explanation[key] !== "string") {
      throw new Error(`AI 해설 항목이 없습니다: ${key}`);
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

  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  const validFormat =
    /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co\/?$/.test(url);

  console.log("Supabase URL 설정 확인:", {
    exists: Boolean(url),
    validFormat,
    hasServerKey: Boolean(key)
  });

  if (!validFormat) {
    return res.status(500).json({
      success: false,
      message:
        "SUPABASE_URL 형식이 올바르지 않습니다. Supabase의 실제 Project URL을 확인해 주세요."
    });
  }

  if (!key) {
    return res.status(500).json({
      success: false,
      message:
        "SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다."
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
      console.error("Supabase query error:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });

      throw new Error("Supabase 조회 오류: " + error.message);
    }

    if (!rows || rows.length === 0) {
      throw new Error(
        "당첨 데이터가 없습니다. lotto_history 테이블에 당첨 번호를 저장해 주세요."
      );
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
      throw new Error(
        "당첨 번호 데이터 형식이 올바르지 않습니다. numbers 컬럼에 숫자 6개가 배열로 저장되어 있는지 확인해 주세요."
      );
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
