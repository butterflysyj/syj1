import type { Word } from './Word';

export const sampleWords: Word[] = [
    {
        id: 1,
        term: "hello",
        pronunciation: "/həˈloʊ/",
        partOfSpeech: "감탄사",
        meaning: "안녕하세요",
        exampleSentence: "Hello, how are you?",
        exampleSentenceMeaning: "안녕하세요, 어떻게 지내세요?",
        gradeLevel: "초등",
        isCustom: false
    },
    {
        id: 2,
        term: "goodbye",
        pronunciation: "/ɡʊdˈbaɪ/",
        partOfSpeech: "감탄사",
        meaning: "안녕히 가세요",
        exampleSentence: "Goodbye, see you tomorrow.",
        exampleSentenceMeaning: "안녕히 가세요, 내일 봐요.",
        gradeLevel: "초등",
        isCustom: false
    },
    {
        id: 3,
        term: "thank you",
        pronunciation: "/θæŋk juː/",
        partOfSpeech: "구",
        meaning: "감사합니다",
        exampleSentence: "Thank you for your help.",
        exampleSentenceMeaning: "도움을 주셔서 감사합니다.",
        gradeLevel: "초등",
        isCustom: false
    }
];