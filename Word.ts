export interface Word { 
    id: number | string; 
    term: string; 
    pronunciation?: string; 
    partOfSpeech: string; 
    meaning: string; 
    exampleSentence: string;
    exampleSentenceMeaning?: string; 
    gradeLevel: string; 
    isCustom?: boolean; 
    unit?: string | number; // Optional field for unit/lesson
}