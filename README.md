# Tuffet 운영실

https://leeseonj.github.io/tuffet-ops-room/

공개 페이지지만 **데이터는 하나도 담지 않는다.** 열면 브라우저가 이 기기에 저장된 읽기 전용 GitHub 토큰으로
비공개 저장소(tuffet-ops·tuffet-app·tuffet-functions·tuffet-guard)를 직접 읽는다.

- 숫자(출시·심사·매출·오류·푸시): tuffet-ops `status` 브랜치 `status.json` — 매시 17분 watch가 쓴다
- 이슈·PR·빌드 기록: 여는 순간의 GitHub 값, 열어 둔 동안 2분마다 다시 읽음
- `index.html`의 CSP가 연결을 api.github.com으로만 제한한다. 외부 스크립트 0개 — 토큰이 있는 페이지라 의도적이다.
