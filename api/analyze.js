
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST 요청만 사용할 수 있어요."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY 환경변수가 설정되지 않았어요."
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

  const low = sortedNumbers.filter((n) => n <= 15).length;
  const middle = sortedNumbers.filter(
    (n) => n >= 16 && n <= 30
  ).length;
  const high = sortedNumbers.filter((n) => n >= 31).length;

  const prompt = `
다음 로또 번호의 특징을 한국어로 쉽게 분석해 줘.

번호: ${sortedNumbers.join(", ")}

분석할 내용:
1. 홀수와 짝수의 개수
2. 번호 구간별 분포
   - 1~15: ${low}개
   - 16~30: ${middle}개
   - 31~45: ${high}개
3. 번호 구성에서 눈에 띄는 특징
4. 모든 번호 조합의 당첨 확률은 동일하다는 안내

당첨 번호를 예측하거나 이 조합이 당첨에 유리하다고 말하지 마.
소제목을 사용해 읽기 쉽게 설명해 줘.
`;

  // 최신 모델부터 차례대로 시도합니다.
  const models = [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite"
  ];

  let lastStatus = 502;
  let lastMessage = "";

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 800
            }
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        lastStatus = response.status;
        lastMessage =
          data.error?.message || "알 수 없는 Gemini API 오류";

        console.error("Gemini API error:", {
          model,
          status: response.status,
          message: lastMessage
        });

        // 모델을 찾을 수 없거나 지원되지 않으면 다음 모델을 시도합니다.
        if (
          response.status === 404 ||
          response.status === 400
        ) {
          continue;
        }

        // 권한이나 사용량 오류는 모델 변경으로 해결되지 않을 수 있습니다.
        return res.status(502).json({
          error: `Gemini API 요청 실패 (${response.status}). ${lastMessage}`
        });
      }

      const result = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("\n")
        .trim();

      if (result) {
        return res.status(200).json({
          result,
          model
        });
      }

      lastStatus = 502;
      lastMessage = "AI가 분석 결과를 반환하지 않았어요.";
    } catch (error) {
      console.error("Gemini connection error:", error);
      lastStatus = 502;
      lastMessage = "Gemini 서버에 연결하지 못했어요.";
    }
  }

  return res.status(502).json({
    error: `사용 가능한 Gemini 모델로 분석하지 못했어요. 마지막 오류 (${lastStatus}): ${lastMessage}`
  });
}
