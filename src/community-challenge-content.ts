export type ChallengeTrack = "dev" | "math";
export type Challenge = { title: string; problem: string; solution: string };

// Original descriptions of standard algorithm exercises; no external judge text.
export const algorithmChallenges: readonly Challenge[] = [
  {
    title: "두 수의 합",
    problem:
      "정수 배열과 target이 주어집니다. 서로 다른 두 인덱스의 값의 합이 target이면 인덱스 쌍 하나를 반환하고, 없으면 null을 반환하세요. 예: [4, 1, 7, 3], target=10 → [2, 3]. 음수와 중복값도 가능합니다. n≤100,000. 목표: O(n).",
    solution:
      "왼쪽부터 순회하며 target-x가 이전 값의 해시맵에 있는지 확인하고, 없으면 x의 인덱스를 저장합니다. 조회 후 저장해야 같은 원소를 두 번 쓰지 않습니다. 평균 시간 O(n), 공간 O(n). [5], target=10은 null; [5,5]는 [0,1].",
  },
  {
    title: "올바른 괄호",
    problem:
      "문자 (, ), [, ], {, }만 있는 문자열의 괄호가 올바르게 짝지어졌는지 반환하세요. 빈 문자열도 유효합니다. 예: {[()]} → true, ([)] → false. 길이≤100,000.",
    solution:
      "여는 괄호를 스택에 넣고 닫는 괄호마다 스택 맨 위와 종류를 비교합니다. 스택이 비었거나 종류가 다르면 false, 순회 후 비어 있으면 true입니다. 시간 O(n), 공간 O(n).",
  },
  {
    title: "중복 없는 가장 긴 구간",
    problem:
      "영문 소문자 문자열에서 중복 문자가 없는 연속 부분 문자열의 최대 길이를 구하세요. 예: abcaef → 5(bcaef). 빈 문자열은 0. 길이≤100,000.",
    solution:
      "문자별 마지막 인덱스를 저장합니다. 오른쪽 끝을 늘릴 때 왼쪽 끝을 max(현재 왼쪽, 해당 문자 마지막 위치+1)로 이동합니다. 왼쪽 끝이 뒤로 가지 않도록 합니다. 시간 O(n), 공간 O(알파벳 수).",
  },
  {
    title: "구간 합 질의",
    problem:
      "정수 배열과 0-based 양 끝 포함 구간 [l,r] 질의들이 주어집니다. 각 구간의 합을 반환하세요. 예: [3,-2,5,1], [1,3] → 4. n과 질의 수 각각≤100,000. 합은 64비트 범위입니다.",
    solution:
      "P[0]=0, P[i+1]=P[i]+a[i]인 누적 합을 만듭니다. 답은 P[r+1]-P[l]. 전처리 O(n), 질의 O(1), 전체 O(n+q), 공간 O(n). 음수도 동일하게 처리합니다.",
  },
  {
    title: "첫 번째 이상값",
    problem:
      "오름차순 정렬 배열에서 target 이상인 첫 원소의 인덱스를 찾으세요. 없으면 배열 길이를 반환합니다. 예: [1,3,3,8], target=3 → 1. 빈 배열 허용. 목표 O(log n).",
    solution:
      "반열린 구간 [lo,hi), 초기 [0,n)에서 이분 탐색합니다. a[mid]<target이면 lo=mid+1, 아니면 hi=mid. 종료 시 lo가 답입니다. 중복값과 빈 배열도 처리됩니다.",
  },
  {
    title: "가장 큰 연속 합",
    problem:
      "비어 있지 않은 정수 배열에서 비어 있지 않은 연속 구간의 최대 합을 구하세요. 예: [-3,4,-1,2,-6] → 5. 전부 음수인 경우에도 원소를 하나 이상 선택해야 합니다. n≤100,000.",
    solution:
      "현재 위치에서 끝나는 최대 합 ending=max(x,ending+x)를 갱신하고 전체 최댓값을 저장합니다. 첫 원소로 초기화해야 전부 음수일 때 0을 잘못 반환하지 않습니다. 시간 O(n), 추가 공간 O(1).",
  },
  {
    title: "겹치는 예약 합치기",
    problem:
      "닫힌 구간 예약들을 합쳐 서로 겹치지 않는 구간 목록으로 만드세요. 끝점이 같은 구간도 합칩니다. 예: [[1,4],[4,6],[9,10],[2,3]] → [[1,6],[9,10]]. 빈 목록 허용. 구간 수≤100,000.",
    solution:
      "시작점 순으로 정렬합니다. 다음 시작점이 현재 끝점 이하이면 끝점을 두 끝점의 최댓값으로 갱신하고, 아니면 새 구간을 시작합니다. 정렬 포함 O(n log n).",
  },
  {
    title: "더 따뜻한 날",
    problem:
      "각 날짜보다 기온이 엄격히 높은 다음 날짜까지 기다릴 일수를 구하세요. 없으면 0입니다. 예: [20,20,23,19] → [2,1,0,0]. 날짜 수≤100,000.",
    solution:
      "아직 답이 없는 날짜 인덱스를 단조 스택에 저장합니다. 오늘 기온이 스택 맨 위보다 높으면 pop해서 인덱스 차이를 기록합니다. 같은 기온에는 pop하지 않습니다. 각 원소가 한 번 들어가고 나와 O(n).",
  },
  {
    title: "격자 최단 거리",
    problem:
      "0은 통로, 1은 벽인 직사각형 격자에서 좌상단부터 우하단까지 상하좌우로 이동하는 최소 횟수를 구하세요. 도착 불가 또는 출발·도착이 벽이면 -1. [[0,0],[1,0]] → 2, [[0]] → 0.",
    solution:
      "출발점에서 BFS를 사용하고 큐에 넣을 때 방문 표시합니다. 모든 이동 비용이 1이므로 처음 도달한 거리가 최단입니다. R×C 크기에서 시간·공간 O(RC).",
  },
  {
    title: "섬의 개수",
    problem:
      "0과 1로 된 직사각형 격자에서 상하좌우로 연결된 1들의 덩어리 수를 구하세요. 대각선은 연결이 아닙니다. [[1,0,1],[1,0,0]] → 2. 입력 격자는 수정하지 마세요.",
    solution:
      "각 미방문 1을 만나면 개수를 늘리고 BFS 또는 DFS로 연결된 1들을 방문 처리합니다. 큰 격자에서는 재귀 깊이를 피하기 위해 명시적 스택·큐를 사용합니다. 시간·공간 O(RC).",
  },
  {
    title: "최소 동전 수",
    problem:
      "양의 정수 동전 종류를 무제한 사용해 amount를 만드는 최소 동전 수를 구하세요. 불가능하면 -1. coins=[1,3,4], amount=6 → 2. amount=0 → 0. amount≤10,000.",
    solution:
      "dp[0]=0, 나머지=무한대로 두고 dp[x]=min(dp[x-c]+1)을 유효한 동전 c마다 계산합니다. 탐욕법은 [1,3,4],6에서 실패합니다. 종류 수 k일 때 시간 O(k×amount), 공간 O(amount).",
  },
  {
    title: "회의를 가장 많이",
    problem:
      "시작<종료인 회의들 중 겹치지 않게 참석할 수 있는 최대 개수를 구하세요. 종료 시각과 다음 시작 시각이 같으면 참석 가능합니다. [[1,3],[2,4],[3,5],[5,6]] → 3.",
    solution:
      "종료 시각 오름차순으로 정렬하고, 마지막 선택한 종료 시각 이상에서 시작하는 회의를 선택합니다. 가장 빨리 끝나는 선택이 나머지 시간을 가장 많이 남깁니다. 시간 O(n log n). 음수 시각도 허용한다면 초기 종료는 -무한대입니다.",
  },
  {
    title: "의존 작업 순서",
    problem:
      "작업 0..n-1과 선행 관계 [a,b](a를 끝내야 b 가능)가 주어집니다. 가능한 수행 순서 하나 또는 사이클이면 null을 반환하세요. n=3, [[0,2],[1,2]] → [0,1,2] 등.",
    solution:
      "각 정점의 진입 차수를 구하고 0인 작업들을 큐에 넣습니다. 하나씩 꺼내며 후속 작업의 차수를 줄입니다. 결과 길이가 n보다 작으면 사이클입니다. 시간·공간 O(V+E). 여러 정답을 허용해야 합니다.",
  },
  {
    title: "정렬하지 않고 K번째",
    problem:
      "정수 배열에서 중복도 각각 세어 k번째로 큰 값을 구하세요. 예: [5,1,5,3], k=2 → 5. 1≤k≤n≤100,000. 전체 정렬 없이 풀어보세요.",
    solution:
      "크기 k의 최소 힙을 유지합니다. 새 값을 넣어 크기가 k를 넘으면 최소값을 제거합니다. 마지막 힙의 최솟값이 답입니다. 시간 O(n log k), 공간 O(k). 중복을 제거하면 안 됩니다.",
  },
];

// Seven constrained puzzle families. Parameters and answers are deterministic;
// unlike unconstrained number sequences each problem has a provable answer.
export function mathChallenge(index: number): Challenge {
  const round = Math.floor(index / 7);
  const n = 3 + (round % 17);
  switch (index % 7) {
    case 0: {
      const x = n + 4;
      const y = n;
      return {
        title: "저울의 비밀",
        problem: `같은 종류의 상자는 항상 같은 무게입니다. A 상자 2개와 B 상자 3개의 무게 합은 ${2 * x + 3 * y}kg, A 상자 3개와 B 상자 2개의 합은 ${3 * x + 2 * y}kg입니다. A와 B 한 개의 무게는 각각 얼마일까요?`,
        solution: `A=${x}kg, B=${y}kg. 두 식을 더하면 A+B=${x + y}, 두 번째에서 첫 번째를 빼면 A-B=${x - y}입니다. 두 조건으로 각각의 무게가 유일하게 정해집니다.`,
      };
    }
    case 1: {
      const a = 2 + (round % 7);
      const b = a - 1;
      return {
        title: "뒤집힌 두 자리 수",
        problem: `두 자리 자연수의 각 자리 숫자의 합은 ${a + b}입니다. 십의 자리와 일의 자리를 바꾼 수는 원래 수보다 9 작습니다. 원래 수는 무엇일까요?`,
        solution: `${10 * a + b}. 십의 자리 a, 일의 자리 b라 하면 a+b=${a + b}, 9(a-b)=9이므로 a-b=1입니다. 따라서 a=${a}, b=${b}.`,
      };
    }
    case 2: {
      const total = n + 4;
      const four = n - 1;
      return {
        title: "바퀴를 세어보니",
        problem: `창고에 바퀴 2개짜리와 4개짜리 수레가 합계 ${total}대 있습니다. 바퀴는 모두 ${2 * total + 2 * four}개이며 빠진 바퀴는 없습니다. 4개짜리 수레는 몇 대일까요?`,
        solution: `${four}대. 모두 2개짜리라고 가정하면 ${2 * total}개입니다. 실제 바퀴와의 차이 ${2 * four}개를 대당 추가 바퀴 2개로 나눕니다.`,
      };
    }
    case 3: {
      const count = n + 2;
      return {
        title: "한 번씩만 악수",
        problem: `모임에서 모든 사람이 자신을 제외한 다른 사람과 정확히 한 번씩 악수했습니다. 악수는 총 ${(count * (count - 1)) / 2}번이었습니다. 사람은 몇 명일까요?`,
        solution: `${count}명. 사람 수 k에 대해 악수 수는 k(k-1)/2입니다. 양의 정수 k에서 이를 만족하는 값은 ${count}입니다.`,
      };
    }
    case 4: {
      const a = 2 + (round % 3);
      const b = 1 + (round % 5);
      let x = 1;
      while (x % 5 !== a || x % 7 !== b) x++;
      return {
        title: "나머지 단서",
        problem: `1 이상 34 이하의 정수 하나를 골랐습니다. 5로 나눈 나머지는 ${a}, 7로 나눈 나머지는 ${b}입니다. 어떤 수일까요?`,
        solution: `${x}. ${a}, ${a + 5}, ${a + 10}, … 중 범위 안에서 7로 나눈 나머지가 ${b}인 수를 찾습니다. 두 답의 차이는 5와 7의 공배수 35여야 하므로 이 범위에서는 답이 유일합니다.`,
      };
    }
    case 5: {
      const total = 30 + n;
      const onlyA = 5 + n,
        onlyB = 8,
        both = 7;
      return {
        title: "두 동아리",
        problem: `${total}명 중 체스 동아리 회원은 ${onlyA + both}명, 퍼즐 동아리 회원은 ${onlyB + both}명입니다. 두 동아리 모두 가입한 사람은 ${both}명입니다. 둘 다 가입하지 않은 사람은 몇 명일까요?`,
        solution: `${total - onlyA - onlyB - both}명. 적어도 하나 가입한 사람은 ${onlyA + both}+${onlyB + both}-${both}=${onlyA + onlyB + both}명입니다. 전체에서 이 수를 뺍니다.`,
      };
    }
    default: {
      const count = n + 3,
        step = n - 1;
      return {
        title: "숫자 카드 조건",
        problem: `서로 다른 정수 카드 ${count}장이 있습니다. 작은 순서로 놓으면 이웃한 카드의 차이가 항상 ${step}이고, 가장 작은 카드는 ${n}입니다. 모든 카드의 합은 얼마일까요?`,
        solution: `${(count * (2 * n + (count - 1) * step)) / 2}. 마지막 카드는 ${n + (count - 1) * step}. 첫 카드와 마지막 카드의 평균에 카드 수 ${count}를 곱하면 됩니다.`,
      };
    }
  }
}

export function challengeFor(track: ChallengeTrack, index: number): Challenge {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("Invalid challenge index");
  if (track === "math") return mathChallenge(index);
  const item = algorithmChallenges[index % algorithmChallenges.length];
  if (!item) throw new Error("Missing algorithm challenge");
  const cycle = Math.floor(index / algorithmChallenges.length);
  return { ...item, title: cycle ? `[복습 ${cycle}회차] ${item.title}` : item.title };
}
