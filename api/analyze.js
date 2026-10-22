
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST 요청만 사용할 수 있어요."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "서버에 Gemini API 키가 설정되지 않았어요."
    });
  }

  const numbers = req.body?.numbers;

  if (
    !Array.isArray(numbers) ||
    numbers.length !== 6 ||
    !numbers.every(
      (n) => Number.isInteger(n) && n >= 1 && n <= 45
    ) ||
    new Set(numbers).size !== 6
  ) {
    return res.status(400).json({
      error: "올바른 로또 번호 6개를 보내 주세요."
    });
  }

  const sortedNumbers = [...numbers].sort((a, b) => a - b);
  const oddCount = sortedNumbers.filter((n) => n % 2 === 1).length;
  const evenCount = 6 - oddCount;
  const ranges = [
    sortedNumbers.filter((n) => n <= 15).length,
    sortedNumbers.filter((n) => n >= 16 && n <= 30).length,
    sortedNumbers.filter((n) => n >= 31).length
  ];

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "너는 한국어로 설명하는 로또 숫자 특징 분석 도우미야. 당첨을 예측하거나 당첨 확률이 높다고 주장하지 마. 제공된 통계만 사실로 설명하고, 과거 출현 빈도를 모르면 지어내지 마."
            }]
          },
          contents: [{
            parts: [{
              text: `
다음 로또 번호의 특징을 초보자도 이해하기 쉽게 분석해 줘.

번호: ${sortedNumbers.join(", ")}
홀수 개수: ${oddCount}
짝수 개수: ${evenCount}
1~15 구간 개수: ${ranges[0]}
16~30 구간 개수: ${ranges[1]}
31~45 구간 개수: ${ranges[2]}

다음 항목을 포함해 줘.
1. 번호의 홀짝 구성
2. 번호 구간별 분포
3. 번호 구성의 특징
4. 마지막에 모든 조합의 당첨 확률은 동일하다는 안내

읽기 편하게 소제목을 사용하고 한국어로 답해 줘.
`
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 700
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", data);
      return res.status(502).json({
        error: "AI 분석에 실패했어요. API 키, 사용량 또는 모델 설정을 확인해 주세요."
      });
    }

    const result = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n")
      .trim();

    if (!result) {
      return res.status(502).json({
        error: "AI가 분석 결과를 반환하지 않았어요. 다시 시도해 주세요."
      });
    }

    return res.status(200).json({ result });
  } catch (error) {
    console.error("Analysis error:", error);

    return res.status(500).json({
      error: "서버에서 오류가 발생했어요. 잠시 후 다시 시도해 주세요."
    });
  }
}
