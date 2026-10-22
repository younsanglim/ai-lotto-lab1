
const generateButton = document.getElementById("generateButton");
const lottoNumbers = document.getElementById("lottoNumbers");
const message = document.getElementById("message");

const loadStatsButton = document.getElementById("loadStatsButton");
const statsMessage = document.getElementById("statsMessage");
const statsResults = document.getElementById("statsResults");

// 번호별 공 색상
function getBallColor(number) {
  if (number <= 10) return "#fbc531";
  if (number <= 20) return "#4a90e2";
  if (number <= 30) return "#e74c3c";
  if (number <= 40) return "#8e8e8e";
  return "#2ecc71";
}

// 로또 번호 6개 생성
function generateLottoNumbers() {
  const numbers = [];

  while (numbers.length < 6) {
    const number = Math.floor(Math.random() * 45) + 1;

    if (!numbers.includes(number)) {
      numbers.push(number);
    }
  }

  return numbers.sort((a, b) => a - b);
}

// 생성한 번호 화면에 표시
function displayLottoNumbers(numbers) {
  lottoNumbers.innerHTML = "";

  numbers.forEach((number, index) => {
    const ball = document.createElement("span");

    ball.className = "lotto-ball";
    ball.textContent = number;
    ball.style.backgroundColor = getBallColor(number);
    ball.style.color = "#ffffff";
    ball.style.animationDelay = `${index * 0.08}s`;

    lottoNumbers.appendChild(ball);
  });
}

// 번호 생성 버튼
generateButton.addEventListener("click", () => {
  const numbers = generateLottoNumbers();

  displayLottoNumbers(numbers);

  message.textContent =
    "새로운 번호가 생성됐어요! 모든 조합의 당첨 확률은 동일합니다.";

  generateButton.textContent = "다시 생성하기";
});

// 과거 당첨 번호 통계
loadStatsButton.addEventListener("click", async () => {
  loadStatsButton.disabled = true;
  statsMessage.textContent = "당첨 데이터를 불러오는 중이에요...";
  statsResults.innerHTML = "";

  try {
    const response = await fetch(
      "https://api.lotto-haru.kr/win/analysis.json"
    );

    if (!response.ok) {
      throw new Error("데이터 요청 실패");
    }

    const rawData = await response.json();

    // 응답 데이터 형태 확인
    let draws = Array.isArray(rawData)
      ? rawData
      : rawData.data ?? rawData.results ?? [];

    if (!Array.isArray(draws)) {
      draws = [];
    }

    // 회차와 번호 정리
    const validDraws = draws
      .map((draw) => {
        const round = Number(
          draw.chasu ?? draw.draw_no ?? draw.round
        );

        let numbers = draw.ball ?? draw.numbers;

        if (typeof numbers === "string") {
          numbers = numbers
            .split(/[,\s]+/)
            .filter(Boolean)
            .map(Number);
        }

        return { round, numbers };
      })
      .filter(
        (draw) =>
          Number.isFinite(draw.round) &&
          Array.isArray(draw.numbers) &&
          draw.numbers.length === 6 &&
          draw.numbers.every(
            (number) =>
              Number.isInteger(Number(number)) &&
              Number(number) >= 1 &&
              Number(number) <= 45
          )
      )
      .sort((a, b) => a.round - b.round);

    if (validDraws.length === 0) {
      throw new Error("분석할 당첨 데이터가 없어요.");
    }

    // 번호별 출현 횟수 계산
    const frequency = Array(46).fill(0);

    validDraws.forEach((draw) => {
      draw.numbers.forEach((number) => {
        frequency[Number(number)]++;
      });
    });

    const mostFrequent = Array.from(
      { length: 45 },
      (_, index) => index + 1
    )
      .sort(
        (a, b) =>
          frequency[b] - frequency[a] || a - b
      )
      .slice(0, 10);

    const recentDraws = validDraws
      .slice(-5)
      .reverse();

    // 통계 결과 화면에 표시
    statsResults.innerHTML = "";

    const cards = [
      {
        title: "분석한 회차",
        content: `${validDraws.length.toLocaleString()}회`
      },
      {
        title: "가장 자주 나온 번호 TOP 10",
        content: mostFrequent
          .map(
            (number) =>
              `${number}번 (${frequency[number]}회)`
          )
          .join("\n")
      },
      {
        title: "최근 당첨 번호",
        content: recentDraws
          .map(
            (draw) =>
              `${draw.round}회: ${draw.numbers.join(", ")}`
          )
          .join("\n")
      }
    ];

    cards.forEach((item) => {
      const card = document.createElement("div");
      card.className = "stat-card";

      const title = document.createElement("h3");
      title.textContent = item.title;

      const content = document.createElement("p");
      content.style.whiteSpace = "pre-line";
      content.textContent = item.content;

      card.appendChild(title);
      card.appendChild(content);
      statsResults.appendChild(card);
    });

    statsMessage.textContent =
      "통계를 불러왔어요! 과거 출현 횟수가 미래의 당첨 확률을 높여 주지는 않습니다.";
  } catch (error) {
    console.error("통계 불러오기 오류:", error);

    statsMessage.textContent =
      "통계 데이터를 불러오지 못했어요. 외부 API 연결이나 데이터 형식을 확인해 주세요.";
  } finally {
    loadStatsButton.disabled = false;
  }
});
