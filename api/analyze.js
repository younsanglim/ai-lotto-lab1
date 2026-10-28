
const { createClient } = require("@supabase/supabase-js");

const GEMINI_MODEL = "gemini-3.8-flash";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase 환경 변수 SUPABASE_URL과 서버용 키를 확인해 주세요."
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
  let oddCount = 0;
  let evenCount = 0;

  const ranges = [
    { label: "1~10번", min: 1, max: 10, count: 0 },
    { label: "11~20번", min: 11, max: 20, count: 0 },
    { label: "21~30번", min: 21, max: 30, count: 0 },
    { label: "31~40번", min: 31, max: 40, count: 0 },
    { label: "41~45번", min: 41, max: 45, count: 0 },
  ];

  const validRows = [];

  for (const row of rows) {
    const nums = normalizeNumbers(row.numbers);
    const drawNumber = Number(row.draw_number);

    if (
      !nums ||
      !Number.isInteger(drawNumber) ||
      drawNumber <= 0
    ) {
      continue;
    }

    validRows.push({
      draw_number: drawNumber,
      numbers: nums,
    });

    for (const n of nums) {
      frequency[n]++;

      if (n % 2 === 1) {
        oddCount++;
      } else {
        evenCount++;
      }

      const range = ranges.find(
        (item) => n >= item.min && n <= item.max
      );

      if (range) range.count++;
    }
  }

  const ranking = Array.from({ length: 45 }, (_, i) => ({
    number: i + 1,
    count: frequency[i + 1],
  }));

  const hotNumbers = [...ranking]
    .sort((a, b) => b.count - a.count || a.number - b.number)
    .slice(0, 10);

  const coldNumbers = [...ranking]
    .sort((a, b) => a.count - b.count || a.number - b.number)
    .slice(0, 10);

  const latestRound = validRows.length
    ? Math.max(...validRows.map((row) => row.draw_number))
    : null;

  return {
    totalDraws: validRows.length,
    latestRound,
    frequency: hotNumbers,
    hotNumbers,
    coldNumbers,
    oddEven: [
      { label: "홀수", count: oddCount },
      { label: "짝수", count: evenCount },
    ],
    ranges: ranges.map(({ label, count }) => ({
      label,
      count,
    })),
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
    .map((item) => `${item.number}번(${item.count}회)`)
    .join(", ");

  const mostCommonRange = [...stats.ranges]
    .sort((a, b) => b.count - a.count)[0];

  return {
    summary:
      `총 ${stats.totalDraws}개 회차의 유효한 당첨 번호를 분석했습니다. ` +
      `가장 최근 데이터의 회차는 ${stats.latestRound}회입니다.`,

    frequency:
      `출현 빈도가 높은 번호는 ${hot || "아직 없습니다"}. ` +
      `이 횟수는 과거 기록을 요약한 것이며 다음 당첨을 예측하지는 않습니다.`,

    distribution:
      `전체 당첨 번호 기록에서 홀수는 ${stats.oddEven[0].count}회, ` +
      `짝수는 ${stats.oddEven[1].count}회 출현했습니다. ` +
      `가장 많이 출현한 구간은 ${mostCommonRange?.label || "없음"}입니다.`,

    combination:
      `생성된 조합은 ${numbers.join(", ")}입니다. ` +
      `홀수 ${odd}개, 짝수 ${6 - odd}개이며, ` +
      `1~22번은 ${low}개, 23~45번은 ${6 - low}개입니다.`,

    caution:
      "이 조합은 무작위로 생성한 분석용 참고 번호입니다. " +
      "과거 출현 빈도나 홀짝 비율이 미래 당첨 확률을 높여 주지는 않습니다.",
  };
}

async function getExplanation(numbers, stats) {
  const apiKey = process.env.GEMINI_API_KEY;

  const fallback = makeFallbackExplanation(numbers, stats);

  if (!apiKey) {
    return {
      explanation: fallback,
      aiUsed: false,
      aiError: "Vercel의 GEMINI_API_KEY 환경 변수를 확인해 주세요.",
    };
  }

  const prompt = `
너는 학생도 이해할 수 있게 설명하는 로또 통계 분석 도우미야.

다음 데이터를 바탕으로 한국어 해설을 작성해.
반드시 JSON 객체만 반환해. 마크다운이나 코드 블록은 쓰지 마.

반환 형식:
{
  "summary": "전체 데이터 요약",
  "frequency": "출현 빈도 해설",
  "distribution": "홀짝과 번호 구간 분포 해설",
  "combination": "생성된 번호 조합 해설",
  "caution": "통계 해석 시 주의할 점"
}

분석 회차 수: ${stats.totalDraws}
가장 최근 회차: ${stats.latestRound}
출현 빈도 상위 번호: ${JSON.stringify(stats.hotNumbers.slice(0, 5))}
출현 빈도 하위 번호: ${JSON.stringify(stats.coldNumbers.slice(0, 5))}
홀짝 통계: ${JSON.stringify(stats.oddEven)}
번호 구간 통계: ${JSON.stringify(stats.ranges)}
생성된 조합: ${JSON.stringify(numbers)}

각 항목을 1~3개의 쉬운 문장으로 작성해.
실제 통계 수치에 근거해서 설명해.
과거 기록으로 미래 당첨 번호를 예측할 수 있다고 주장하지 마.
`;

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
            temperature: 0.3,
            maxOutputTokens: 1200,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const body = await response.text();

    if (!response.ok) {
      throw new Error(`Gemini HTTP ${response.status}: ${body}`);
    }

    const result = JSON.parse(body);
    const text = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!text) {
      throw new Error("Gemini 응답에 해설이 없습니다.");
    }

    const parsed = JSON.parse(text);

    const explanation = {
      summary: parsed.summary || fallback.summary,
      frequency: parsed.frequency || fallback.frequency,
      distribution: parsed.distribution || fallback.distribution,
      combination: parsed.combination || fallback.combination,
      caution: parsed.caution || fallback.caution,
    };

    return {
      explanation,
      aiUsed: true,
      aiError: null,
    };
  } catch (error) {
    console.error("Gemini API 오류:", error.message);

    return {
      explanation: fallback,
      aiUsed: false,
      aiError: error.message,
    };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      success: false,
      message: "POST 요청만 허용됩니다.",
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

    const stats = makeStats(rows);

    if (stats.totalDraws === 0) {
      throw new Error(
        "유효한 당첨 번호가 없습니다. numbers 열에 회차별 번호 6개가 저장되어 있는지 확인해 주세요."
      );
    }

    const numbers = makeCombination();
    const aiResult = await getExplanation(numbers, stats);

    const statistics = {
      roundCount: stats.totalDraws,
      latestRound: stats.latestRound,
      frequency: stats.frequency,
      hotNumbers: stats.hotNumbers,
      coldNumbers: stats.coldNumbers,
      oddEven: stats.oddEven,
      ranges: stats.ranges,
    };

    return res.status(200).json({
      success: true,
      numbers,
      recommendedNumbers: numbers,
      statistics,
      stats,
      totalDraws: stats.totalDraws,
      explanation: aiResult.explanation,
      aiExplanation: aiResult.explanation,
      analysis: aiResult.explanation,
      aiUsed: aiResult.aiUsed,
      aiError: aiResult.aiError,
      message: aiResult.aiUsed
        ? "AI 통계 분석이 완료되었습니다."
        : "통계 분석은 완료되었지만 AI 해설 대신 기본 해설을 표시했습니다.",
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
