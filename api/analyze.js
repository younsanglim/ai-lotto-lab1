
const { createClient } = require("@supabase/supabase-js");

// Google 오류 메시지에서 안내한 모델명
const GEMINI_MODEL = "gemini-3.8-flash";

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase 환경 변수 확인 필요: SUPABASE_URL과 서버용 키를 등록해 주세요."
    );
  }

  return createClient(url, key);
}

function normalizeNumbers(value) {
  let nums = value;

  if (typeof nums === "string") {
    try {
      nums = JSON.parse(nums);
    } catch {
      nums = nums
        .replace(/[\[\]{}]/g, "")
        .split(",")
        .map((n) => Number(n.trim()));
    }
  }

  if (!Array.isArray(nums)) return null;

  nums = nums.map(Number);

  if (
    nums.length !== 6 ||
    nums.some(
      (n) => !Number.isInteger(n) || n < 1 || n > 45
    ) ||
    new Set(nums).size !== 6
  ) {
    return null;
  }

  return nums.sort((a, b) => a - b);
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
  const nums = new Set();

  while (nums.size < 6) {
    nums.add(Math.floor(Math.random() * 45) + 1);
  }

  return [...nums].sort((a, b) => a - b);
}

function makeFallbackExplanation(numbers, stats) {
  const odd = numbers.filter((n) => n % 2 === 1).length;
  const low = numbers.filter((n) => n <= 22).length;

  const hot = stats.hotNumbers
    .slice(0, 5)
    .map((x) => `${x.number}번(${x.count}회)`)
    .join(", ");

  return [
    `생성된 번호는 ${numbers.join(", ")}입니다.`,
    `홀수 ${odd}개, 짝수 ${6 - odd}개로 구성되어 있습니다.`,
    `1~22 구간은 ${low}개, 23~45 구간은 ${6 - low}개입니다.`,
    `분석한 과거 회차는 ${stats.totalDraws}회입니다.`,
    `과거 출현 빈도가 높은 번호는 ${hot || "아직 없습니다"}.`,
    "현재 AI 해설을 불러오지 못해 기본 통계 해설을 표시했습니다. 과거 출현 기록이 미래 당첨 확률을 높여 주지는 않습니다.",
  ].join(" ");
}

async function getExplanation(numbers, stats) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      explanation: makeFallbackExplanation(numbers, stats),
      aiUsed: false,
      aiError: "Vercel에 GEMINI_API_KEY 환경 변수가 없습니다.",
    };
  }

  const prompt = `
너는 AI 로또 연구소의 통계 해설 담당자야.

다음 데이터를 학생도 이해할 수 있는 쉬운 한국어로 4~6문장 해설해 줘.

분석 번호: ${numbers.join(", ")}
분석한 유효 회차 수: ${stats.totalDraws}
출현 빈도가 높은 번호:
${stats.hotNumbers.map((x) => `${x.number}번 ${x.count}회`).join(", ")}
출현 빈도가 낮은 번호:
${stats.coldNumbers.map((x) => `${x.number}번 ${x.count}회`).join(", ")}

번호의 홀짝 구성, 구간 분포, 과거 출현 빈도를 설명해 줘.
과거 기록으로 미래 당첨을 예측할 수 있다고 단정하지 마.
`;

  let lastError = "";

  // 최대 3회 요청
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

      const body = await response.text();

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${body}`;

        // 일시적 오류가 아니면 즉시 기본 해설로 전환
        if (![408, 429, 500, 502, 503, 504].includes(response.status)) {
          break;
        }
      } else {
        const result = JSON.parse(body);
        const explanation = result.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || "")
          .join("")
          .trim();

        if (explanation) {
          return {
            explanation,
            aiUsed: true,
            aiError: null,
          };
        }

        lastError = "Gemini 응답에 해설 텍스트가 없습니다.";
      }
    } catch (error) {
      lastError = error.message || String(error);
    }

    if (attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
    }
  }

  console.error("Gemini API 오류:", lastError);

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
        "유효한 당첨 번호가 없습니다. numbers 배열과 실제 저장 데이터를 확인해 주세요."
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
      aiError: aiResult.aiError,
      stats,
      totalDraws: stats.totalDraws,
      message: aiResult.aiUsed
        ? "AI 분석이 완료되었습니다."
        : "기본 통계 분석을 표시했습니다. AI 해설은 현재 사용할 수 없습니다.",
    });
  } catch (error) {
    console.error("Analysis error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "알 수 없는 오류가 발생했습니다.",
      message: error.message || "분석에 실패했습니다.",
    });
  }
};
