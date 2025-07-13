# 🚀 AI 영단어 학습 앱 배포 가이드

## 준비 완료 ✅
- 프로덕션 빌드 생성됨 (`dist/` 폴더)
- 모든 기능 테스트 완료
- 다크모드, API 기능 정상 작동

## 배포 옵션

### 1. GitHub Pages (추천)

#### 단계 1: GitHub 저장소 생성
1. [GitHub](https://github.com)에 로그인
2. "New repository" 클릭
3. 저장소 이름: `ai-vocabulary-app`
4. Public으로 설정
5. "Create repository" 클릭

#### 단계 2: 코드 업로드
```bash
# 프로젝트 폴더에서 실행
git init
git add .
git commit -m "Initial commit: AI 영단어 학습 앱"
git branch -M main
git remote add origin https://github.com/USERNAME/ai-vocabulary-app.git
git push -u origin main
```

#### 단계 3: GitHub Pages 설정
1. GitHub 저장소 → Settings 탭
2. 왼쪽 메뉴에서 "Pages" 클릭
3. Source: "Deploy from a branch" 선택
4. Branch: "main" 선택, 폴더: "/ (root)" 선택
5. Save 클릭

#### 단계 4: 배포 확인
- 약 5-10분 후 `https://USERNAME.github.io/ai-vocabulary-app` 에서 접속 가능

### 2. Vercel (빠른 배포)

#### 방법 1: GitHub 연동
1. [Vercel](https://vercel.com) 회원가입
2. "Import Project" → GitHub 저장소 선택
3. 자동 배포 완료

#### 방법 2: 직접 업로드
1. Vercel CLI 설치: `npm i -g vercel`
2. 프로젝트 폴더에서: `vercel --prod`
3. 안내에 따라 설정

### 3. Netlify (드래그앤드롭)

1. [Netlify](https://netlify.com) 회원가입
2. "Sites" → "Add new site" → "Deploy manually"
3. `dist` 폴더를 드래그앤드롭
4. 즉시 배포 완료

## 📁 배포할 파일들
현재 `dist/` 폴더에 다음 파일들이 준비되어 있습니다:
- `index.html` - 메인 HTML 파일
- `assets/` - CSS, JS 번들 파일들
- 모든 정적 자원들

## 🔧 배포 후 설정

### API 키 설정
- 배포 후 앱 설정에서 Google Gemini API 키를 입력하세요
- 환경변수로 설정하려면 각 플랫폼의 환경변수 설정 방법을 참고하세요

### 커스텀 도메인 (선택사항)
- GitHub Pages: 저장소 Settings → Pages → Custom domain
- Vercel/Netlify: 프로젝트 설정에서 도메인 추가

## ✅ 배포 체크리스트
- [ ] 빌드 파일 생성 완료
- [ ] GitHub 저장소 생성
- [ ] 코드 업로드
- [ ] 배포 플랫폼 설정
- [ ] 배포 URL 접속 확인
- [ ] 모든 기능 테스트
- [ ] API 키 설정

## 🌐 예상 배포 URL
- GitHub Pages: `https://USERNAME.github.io/ai-vocabulary-app`
- Vercel: `https://ai-vocabulary-app.vercel.app`
- Netlify: `https://app-name.netlify.app`

## 📞 지원
배포 중 문제가 발생하면 각 플랫폼의 문서를 참고하세요:
- [GitHub Pages 문서](https://docs.github.com/en/pages)
- [Vercel 문서](https://vercel.com/docs)
- [Netlify 문서](https://docs.netlify.com)