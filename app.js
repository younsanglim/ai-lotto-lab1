// 로또 번호 생성 버튼과 결과 영역 가져오기
const generateButton = document.getElementById("generateButton");
const lottoNumbers = document.getElementById("lottoNumbers");
const message = document.getElementById("message");

// 숫자 구간에 따라 로또 공 색상 정하기
function getBallColor(number) {
  if (number <= 10) {
    return "#fbc531"; // 노란색
  } else if (number <= 20) {
    return "#4a90e2"; // 파란색
  } else if (number <= 30) {
    return "#e74c3c"; // 빨간색
  } else if (number <= 40) {
    return "#8e8e8e"; // 회색
  } else {
    return "#2ecc71"; // 초록색
  }
}

// 로또 번호 6개 생성하기
function generateLottoNumbers() {
  const numbers = [];

  // 1부터 45까지 중복 없이 6개 선택
  while (numbers.length < 6) {
    const number = Math.floor(Math.random() * 45) + 1;

    if (!numbers.includes(number)) {
      numbers.push(number);
    }
  }

  // 번호를 작은 순서대로 정렬
  numbers.sort((a, b) => a - b);

  return numbers;
}

// 생성한 번호 화면에 표시하기
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

// 버튼 클릭 시 번호 생성
generateButton.addEventListener("click", () => {
  const numbers = generateLottoNumbers();

  displayLottoNumbers(numbers);

  message.textContent =
    "새로운 번호가 생성됐어요! 모든 조합의 당첨 확률은 동일합니다.";

  generateButton.textContent = "다시 생성하기";
});
