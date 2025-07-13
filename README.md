# AI 영단어 학습 앱

AI 기반 영단어 학습 애플리케이션입니다. 1350개의 영단어와 함께 학습, 퀴즈, 게임 등 다양한 기능을 제공합니다.

## 기능

- 📚 1350개의 중학교 필수 영단어
- 🤖 AI 튜터 채팅 (Google Gemini 사용)
- 📝 다양한 퀴즈 및 게임 모드
- 🌙 다크모드/라이트모드 지원
- 📊 학습 통계 및 진도 관리
- 🎯 일일 학습 목표 설정

## 로컬 실행 방법

**필수 사항:** Node.js

1. 의존성 설치:
   ```bash
   npm install
   ```

2. Google Gemini API 키 설정:
   - [Google AI Studio](https://aistudio.google.com/)에서 API 키를 발급받으세요
   - `.env` 파일을 열어 `VITE_GOOGLE_API_KEY=your_api_key_here` 부분에 실제 API 키를 입력하세요
   ```
   VITE_GOOGLE_API_KEY=실제_API_키_여기에_입력
   ```

3. 앱 실행:
   ```bash
   npm run dev
   ```

4. 브라우저에서 `http://localhost:5173` (또는 표시된 포트)로 접속

## API 키 없이 사용

API 키 없이도 기본적인 학습 기능(단어 카드, 퀴즈)은 사용할 수 있습니다. 
AI 튜터 채팅 기능만 비활성화됩니다.
