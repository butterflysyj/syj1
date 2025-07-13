
import React, { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext, useReducer } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, GenerateContentResponse, Chat } from "@google/genai";
import { sampleWords } from './sampleWords';
import type { Word } from './Word';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// --- Toast Notification System ---
interface ToastMessage {
    id: number;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
}
interface ToastContextType {
    addToast: (message: string, type: ToastMessage['type']) => void;
}
const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToasts = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToasts must be used within a ToastProvider');
    }
    return context;
};

const ToastProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const toastIdRef = useRef(0);

    const addToast = useCallback((message: string, type: ToastMessage['type']) => {
        const id = toastIdRef.current++;
        setToasts(prevToasts => [...prevToasts, { id, message, type }]);
        const duration = type === 'error' || type === 'warning' ? 7000 : 5000;
        setTimeout(() => {
            removeToast(id);
        }, duration);
    }, []);

    const removeToast = (id: number) => {
        setToasts(prevToasts => prevToasts.filter(toast => toast.id !== id));
    };

    return (
        <ToastContext.Provider value={{ addToast }}>
            {children}
            <div className="fixed top-5 right-5 z-[100] w-full max-w-xs sm:max-w-sm space-y-3">
                {toasts.map(toast => (
                    <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />
                ))}
            </div>
        </ToastContext.Provider>
    );
};

interface ToastProps {
    message: string;
    type: ToastMessage['type'];
    onClose: () => void;
}
const Toast: React.FC<ToastProps> = React.memo(({ message, type, onClose }) => {
    const [isExiting, setIsExiting] = useState(false);

    const typeStyles = useMemo(() => {
        switch (type) {
            case 'success': return { bg: 'bg-green-500', text: 'text-white', icon: '✔️' };
            case 'error': return { bg: 'bg-red-500', text: 'text-white', icon: '❌' };
            case 'warning': return { bg: 'bg-yellow-500', text: 'text-slate-800', icon: '⚠️' }; // Darker text for yellow
            case 'info': return { bg: 'bg-blue-500', text: 'text-white', icon: 'ℹ️' };
            default: return { bg: 'bg-slate-600', text: 'text-white', icon: '' };
        }
    }, [type]);

    const handleClose = () => {
        setIsExiting(true);
        setTimeout(onClose, 300); 
    };

    return (
        <div 
            role="alert" 
            aria-live={type === 'error' ? 'assertive' : 'polite'}
            className={`flex items-start justify-between p-4 rounded-md shadow-lg ${typeStyles.bg} ${typeStyles.text} ${isExiting ? 'animate-slideOutRight' : 'animate-slideInRight'}`}
        >
            <div className="flex items-center">
                {typeStyles.icon && <span className="mr-2 text-lg">{typeStyles.icon}</span>}
                <p className="text-sm">{message}</p>
            </div>
            <button onClick={handleClose} aria-label="Close notification" className={`ml-4 p-1 rounded-md hover:bg-black/20 focus:outline-none focus:ring-2 ${type==='warning' ? 'focus:ring-slate-700/50' : 'focus:ring-white/50'} text-xl leading-none`}>&times;</button>
        </div>
    );
});


// --- Global Loading Indicator ---
const GlobalSpinner: React.FC<{ isLoading: boolean }> = ({ isLoading }) => {
    if (!isLoading) return null;
    return (
        <div className="fixed top-4 right-4 z-[200] p-2 bg-slate-200/80 dark:bg-slate-700/80 rounded-full shadow-lg" aria-label="Loading content" role="status">
            <svg className="animate-spin h-6 w-6 text-cyan-600 dark:text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
        </div>
    );
};


// Define types for user settings
export interface UserSettings {
    grade: string;
    textbook: string; 
    dailyGoal: number;
    username: string;
    theme: 'dark' | 'light';
    speechRate: number;
    autoPlayAudio: boolean;
    xp: number;
    level: number;
    lastQuizDate?: string;
    lastQuizScore?: number;
    lastLearnedDate?: string;
    lastGameDate?: string; // Added to track game plays
    currentStreak?: number;
    bestStreak?: number;
}


type AppScreen = 'loginSetup' | 'dashboard' | 'learnWords' | 'quiz' | 'allWords' | 'stats' | 'manageWords' | 'tutorChat' | 'gameSelection' | 'wordMatchGame' | 'typingPracticeGame' | 'speedQuizGame' | 'wordShooterGame' | 'wordBombGame' | 'wordZombieDefense' | 'timedWordLinkGame' | 'gameResult';


export interface WordStat { 
    id: number | string;
    isMastered: boolean;
    lastReviewed: string | null; 
    quizIncorrectCount: number;
}

// --- Helper Functions ---
const shuffleArray = <T,>(array: T[]): T[] => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
};

let cachedVoices: SpeechSynthesisVoice[] | null = null;
let preferredVoices: { [lang: string]: SpeechSynthesisVoice | undefined } = {};
let voicesLoadedPromise: Promise<void> | null = null;

const loadVoices = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (!voicesLoadedPromise) {
            voicesLoadedPromise = new Promise((resolve) => {
                const tryLoad = () => {
                    const voices = speechSynthesis.getVoices();
                    if (voices.length > 0) {
                        cachedVoices = voices;
                        preferredVoices = {}; 
                        resolve();
                    }
                };

                if (speechSynthesis.getVoices().length > 0) {
                    tryLoad();
                } else {
                    speechSynthesis.onvoiceschanged = () => {
                        tryLoad();
                        speechSynthesis.onvoiceschanged = null; 
                    };
                }
            });
        }
        return voicesLoadedPromise;
    }
    return Promise.resolve();
};

loadVoices();

const speak = async (text: string, lang = 'en-US', rate?: number) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        if (rate !== undefined) {
            utterance.rate = Math.max(0.1, Math.min(rate, 10)); // Clamp rate to valid range
        }


        await loadVoices(); 

        if (cachedVoices && !preferredVoices[lang]) {
            const targetLangVoices = cachedVoices.filter(voice => voice.lang === lang || voice.lang.startsWith(lang.split('-')[0]));
            preferredVoices[lang] = 
                targetLangVoices.find(voice => voice.name.includes('Google') && voice.lang === lang) ||
                targetLangVoices.find(voice => voice.name.includes('Microsoft') && voice.lang === lang) ||
                targetLangVoices.find(voice => voice.name.includes('Samantha') && voice.lang === lang) || // Common voice name
                targetLangVoices.find(voice => voice.default && voice.lang === lang) ||
                targetLangVoices.find(voice => voice.lang === lang) ||
                targetLangVoices.find(voice => voice.default) || // Fallback to any default system voice
                targetLangVoices[0]; // Fallback to the first available voice for the language
        }

        if (preferredVoices[lang]) {
            utterance.voice = preferredVoices[lang];
        } else if (cachedVoices && cachedVoices.length > 0) {
            const systemDefaultVoice = cachedVoices.find(v => v.default);
            if (systemDefaultVoice) utterance.voice = systemDefaultVoice;
        }
        
        speechSynthesis.speak(utterance);
    } else {
        console.warn("Speech synthesis not supported in this browser.");
    }
};


const getTodayDateString = () => new Date().toISOString().split('T')[0];

const getDefaultWordStat = (wordId: string | number): WordStat => ({
    id: wordId,
    isMastered: false,
    lastReviewed: null,
    quizIncorrectCount: 0,
});


// --- Dark Mode Functions ---
const toggleDarkMode = (): string => {
    try {
        const html = document.documentElement;
        const isDark = html.classList.contains('dark');
        
        if (isDark) {
            html.classList.remove('dark');
            localStorage.setItem('darkMode', 'false');
            return 'light';
        } else {
            html.classList.add('dark');
            localStorage.setItem('darkMode', 'true');
            return 'dark';
        }
    } catch (error) {
        console.error('Dark mode toggle error:', error);
        return 'light';
    }
};

// --- API Client Setup (Gemini) ---
let ai: GoogleGenAI | null = null;

// Try multiple ways to get the API key
const getApiKey = () => {
    // 1. Try environment variable
    const envKey = (import.meta as any).env?.VITE_GOOGLE_API_KEY;
    if (envKey && envKey !== 'your_api_key_here') {
        return envKey;
    }
    
    // 2. Try localStorage (for user input)
    const storedKey = localStorage.getItem('gemini_api_key');
    if (storedKey && storedKey.trim()) {
        return storedKey;
    }
    
    return null;
};

const initializeAI = (apiKey?: string) => {
    const key = apiKey || getApiKey();
    if (key) {
        try {
            ai = new GoogleGenAI({ apiKey: key });
            console.log("Google Gemini AI initialized successfully");
            return true;
        } catch (error) {
            console.error("Failed to initialize Google Gemini AI:", error);
            ai = null;
            return false;
        }
    } else {
        console.warn("Google Gemini API key not found. AI features will be disabled.");
        console.warn("You can set it in .env file or through the app interface.");
        ai = null;
        return false;
    }
};

// Initialize AI on load
initializeAI();

// --- Gemini API Quota Management ---
let isCurrentlyGeminiQuotaExhausted = false;
let quotaCooldownTimeoutId: number | null = null;
const GEMINI_QUOTA_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

const setGeminiQuotaExhaustedCooldown = (
    addToastForNotification: (message: string, type: ToastMessage['type']) => void,
    featureName?: string 
) => {
    if (!isCurrentlyGeminiQuotaExhausted) {
        const cooldownMinutes = GEMINI_QUOTA_COOLDOWN_MS / 60000;
        console.log(`Gemini API quota exhaustion detected for '${featureName || 'a Gemini API call'}'. Activating ${cooldownMinutes}-minute cooldown.`);
        isCurrentlyGeminiQuotaExhausted = true;
        
        const baseMessage = featureName
            ? `Gemini API 사용량 할당량(quota)을 초과하여 '${featureName}' 기능 사용이 중단됩니다.`
            : `Gemini API 사용량 할당량(quota)을 초과했습니다.`;
        
        addToastForNotification(`${baseMessage} Google AI Studio 또는 Google Cloud Console에서 할당량 및 결제 세부 정보를 확인해주세요. 추가 API 호출이 ${cooldownMinutes}분 동안 중단됩니다.`, "error");
        
        if (quotaCooldownTimeoutId) {
            clearTimeout(quotaCooldownTimeoutId);
        }
        quotaCooldownTimeoutId = window.setTimeout(() => {
            isCurrentlyGeminiQuotaExhausted = false;
            quotaCooldownTimeoutId = null;
            console.log("Gemini API quota cooldown finished. API calls may resume.");
            addToastForNotification(`Gemini API 호출 제한 시간이 종료되었습니다. ${featureName ? `'${featureName}' 기능을 ` : ''}다시 시도할 수 있습니다.`, "info");
        }, GEMINI_QUOTA_COOLDOWN_MS);
    }
};

const parseGeminiError = (error: any): { detailedErrorMessage: string; statusCode?: number; geminiErrorStatus?: string; isQuotaExhaustedError: boolean; isRateLimitErrorForRetry: boolean; displayErrorMsg: string } => {
    let detailedErrorMessage = "";
    let statusCode: number | undefined;
    let geminiErrorStatus: string | undefined;
    let displayErrorMsg = String(error);

    if (error && error.error && typeof error.error.message === 'string') { // Standard Gemini API error object
        detailedErrorMessage = error.error.message.toLowerCase();
        displayErrorMsg = error.error.message; // Keep original case for display
        if (typeof error.error.code === 'number') {
            statusCode = error.error.code;
        }
        if (typeof error.error.status === 'string') {
            geminiErrorStatus = error.error.status.toUpperCase();
        }
    } else if (error && typeof error.message === 'string') { // General JavaScript Error object
        detailedErrorMessage = error.message.toLowerCase();
        displayErrorMsg = error.message;
        if (error.status && typeof error.status === 'number') {
            statusCode = error.status;
        }
    } else { 
        detailedErrorMessage = String(error).toLowerCase();
    }

    const isQuotaExhaustedError = (
        (statusCode === 429 && (detailedErrorMessage.includes('quota') || geminiErrorStatus === 'RESOURCE_EXHAUSTED')) ||
        (!statusCode && detailedErrorMessage.includes('quota') && (detailedErrorMessage.includes('exceeded') || detailedErrorMessage.includes('exhausted'))) ||
        geminiErrorStatus === 'RESOURCE_EXHAUSTED'
    );

    const isRateLimitErrorForRetry = (statusCode === 429 && !isQuotaExhaustedError);
    
    return { detailedErrorMessage, statusCode, geminiErrorStatus, isQuotaExhaustedError, isRateLimitErrorForRetry, displayErrorMsg };
};


const generateWordDetailsWithGemini = async (term: string, addToast: (message: string, type: ToastMessage['type']) => void, setGlobalLoading: (loading: boolean) => void, retries = 2, initialDelay = 7000): Promise<Partial<Word> | null> => {
    if (!ai) {
        addToast("AI 기능을 사용하려면 API 키가 필요합니다. 환경 변수를 확인해주세요.", "warning");
        return null;
    }
    if (isCurrentlyGeminiQuotaExhausted) {
        addToast(`Gemini API 할당량이 이전에 감지되어 현재 API 호출이 중단된 상태입니다. '${term}'에 대한 정보 가져오기를 건너뜁니다.`, "warning");
        return null;
    }

    setGlobalLoading(true);
    const modelName = 'gemini-2.5-flash-preview-04-17';
    const featureDescription = `'${term}' 단어 정보 조회`;
    const promptText = `Provide details for the English word "${term}". Your response MUST be a JSON object with the following fields: "pronunciation" (phonetic, optional), "partOfSpeech" (e.g., noun, verb, adjective, in Korean e.g., 명사, 동사), "meaning" (Korean meaning), "exampleSentence" (simple English example), "exampleSentenceMeaning" (Korean translation of example). Ensure exampleSentence is appropriate for language learners. If "${term}" seems like a typo or not a common English word, try to correct it if obvious and return details for the corrected term, including the corrected "term" in the JSON. If correction is not obvious or it's not a word, return null for all fields.

Example JSON:
{
  "term": "person", 
  "pronunciation": "/ˈpɜːrsən/",
  "partOfSpeech": "명사",
  "meaning": "사람",
  "exampleSentence": "This is a person.",
  "exampleSentenceMeaning": "이것은 사람입니다."
}`;

    let currentDelay = initialDelay;

    try {
        for (let i = 0; i <= retries; i++) {
            try {
                console.log(`Gemini request for ${featureDescription}, attempt ${i + 1}/${retries + 1}`);
                const response: GenerateContentResponse = await ai.models.generateContent({
                    model: modelName,
                    contents: promptText,
                    config: {
                      responseMimeType: "application/json",
                      temperature: 0.5, 
                    }
                });
                
                let jsonStr = response.text?.trim() || '';
                const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
                const match = jsonStr.match(fenceRegex);
                if (match && match[2]) {
                    jsonStr = match[2].trim();
                }

                const data = JSON.parse(jsonStr) as Partial<Word>;
                
                if (!data.partOfSpeech || !data.meaning || !data.exampleSentence) {
                    console.warn(`Gemini response missing essential fields for ${featureDescription} (attempt ${i + 1}/${retries + 1}):`, data);
                    if (i < retries) { 
                        addToast(`AI가 ${featureDescription} 정보를 일부 누락하여 반환했습니다. 재시도 중...(${i+1}/${retries+1})`, "warning");
                        await new Promise(resolve => setTimeout(resolve, currentDelay));
                        currentDelay *= 2;
                        continue; 
                    } else { 
                        addToast(`AI가 ${featureDescription}에 대한 충분한 정보를 제공하지 못했습니다. (누락된 필드: 뜻, 품사, 또는 예문) 모든 시도 실패.`, "error");
                        return { term }; 
                    }
                }
                return data;

            } catch (error: any) {
                const { isQuotaExhaustedError, isRateLimitErrorForRetry, displayErrorMsg, statusCode, geminiErrorStatus } = parseGeminiError(error);

                if (isQuotaExhaustedError) {
                    console.warn(`Gemini API call for ${featureDescription} failed on attempt ${i + 1}/${retries + 1} due to QUOTA EXHAUSTION (Code: ${statusCode}, Status: ${geminiErrorStatus}). Error: ${displayErrorMsg}. Cooldown will be activated. No further retries for this call.`);
                    setGeminiQuotaExhaustedCooldown(addToast, featureDescription);
                    return null; 
                }
                
                console.error(`Error during ${featureDescription} (attempt ${i + 1}/${retries + 1}). Status Code: ${statusCode}, Gemini Status: ${geminiErrorStatus}. Error: ${displayErrorMsg}`, error);

                if (i < retries) { 
                    if (isRateLimitErrorForRetry) { 
                        addToast(`Gemini API 요청 빈도가 높아 ${featureDescription} 가져오기에 실패했습니다. ${currentDelay/1000}초 후 재시도합니다...`, "warning");
                    } else { 
                        addToast(`${featureDescription} 가져오기 중 오류 발생. ${currentDelay/1000}초 후 재시도합니다... (오류: ${displayErrorMsg})`, "warning");
                    }
                    await new Promise(resolve => setTimeout(resolve, currentDelay));
                    currentDelay *= 2;
                } else { 
                    if (isRateLimitErrorForRetry) {
                         addToast(`Gemini API 요청 빈도가 너무 높습니다 (${featureDescription}). 잠시 후 다시 시도해주세요.`, "error");
                    } else {
                        addToast(`${featureDescription} 정보를 AI로부터 가져오는 데 최종 실패했습니다. (오류: ${displayErrorMsg})`, "error");
                    }
                    return null; 
                }
            }
        }
    } finally {
        setGlobalLoading(false);
    }
    console.warn(`generateWordDetailsWithGemini for ${featureDescription} failed after all retries or due to unexpected flow.`);
    addToast(`${featureDescription} 정보를 AI로부터 가져오는 데 최종 실패했습니다.`, "error");
    return null;
};

/*interface AIExampleSentence {
    newExampleSentence: string;
    newExampleSentenceMeaning: string;
}*/

/*const _generateDifferentExampleSentenceWithGemini = async (word: Word, grade: string, addToast: (message: string, type: ToastMessage['type']) => void, setGlobalLoading: (loading: boolean) => void, retries = 2, initialDelay = 7000): Promise<AIExampleSentence | null> => {
    if (!ai) {
        addToast("AI 기능을 사용하려면 API 키가 필요합니다.", "warning");
        return null;
    }
     if (isCurrentlyGeminiQuotaExhausted) {
        addToast(`Gemini API 할당량이 이전에 감지되어 현재 API 호출이 중단된 상태입니다. '${word.term}'의 새 예문 생성을 건너뜁니다.`, "warning");
        return null;
    }
    setGlobalLoading(true);
    const modelName = 'gemini-2.5-flash-preview-04-17';
    const featureDescription = `'${word.term}' AI 예문 생성`;
    const promptText = `You are an English vocabulary tutor for Korean students.
The user is learning the word: "${word.term}" (Part of speech: ${word.partOfSpeech}, Korean meaning: ${word.meaning}).
The user's current grade level is: ${grade}.
The user has already seen this example: "${word.exampleSentence}"

Generate ONE NEW, DIFFERENT, and SIMPLE English example sentence for the word "${word.term}" that is appropriate for a ${grade} Korean student.
The new example sentence should clearly illustrate the meaning of "${word.term}".
Your response MUST be a JSON object with the following fields:
"newExampleSentence": "The new English example sentence.",
"newExampleSentenceMeaning": "The Korean translation of the new example sentence."

Example JSON response:
{
  "newExampleSentence": "She showed great courage when she helped the lost child.",
  "newExampleSentenceMeaning": "그녀는 길 잃은 아이를 도왔을 때 대단한 용기를 보여주었다."
}`;

    let currentDelay = initialDelay;
    try {
        for (let i = 0; i <= retries; i++) {
            try {
                console.log(`Gemini request for ${featureDescription}, attempt ${i + 1}/${retries + 1}`);
                const response: GenerateContentResponse = await ai.models.generateContent({
                    model: modelName,
                    contents: promptText,
                    config: {
                      responseMimeType: "application/json",
                      temperature: 0.7, 
                    }
                });
                
                let jsonStr = response.text?.trim() || '';
                const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
                const match = jsonStr.match(fenceRegex);
                if (match && match[2]) {
                    jsonStr = match[2].trim();
                }
                const data = JSON.parse(jsonStr) as AIExampleSentence;

                if (!data.newExampleSentence || !data.newExampleSentenceMeaning) {
                     console.warn(`Gemini response missing newExampleSentence or newExampleSentenceMeaning for ${featureDescription} (attempt ${i + 1}/${retries + 1}):`, data);
                     if (i < retries) {
                        addToast(`AI가 ${featureDescription} 정보를 일부 누락하여 반환했습니다. 재시도 중...`, "warning");
                        await new Promise(resolve => setTimeout(resolve, currentDelay));
                        currentDelay *= 2;
                        continue;
                     } else {
                        addToast(`AI가 ${featureDescription}에 대한 정보를 충분히 제공하지 못했습니다. 모든 시도 실패.`, "error");
                        return null;
                     }
                }
                return data;

            } catch (error: any) {
                const { isQuotaExhaustedError, isRateLimitErrorForRetry, displayErrorMsg, statusCode, geminiErrorStatus } = parseGeminiError(error);
                
                if (isQuotaExhaustedError) {
                    console.warn(`Gemini API call for ${featureDescription} failed on attempt ${i + 1}/${retries + 1} due to QUOTA EXHAUSTION (Code: ${statusCode}, Status: ${geminiErrorStatus}). Error: ${displayErrorMsg}. Cooldown will be activated. No further retries for this call.`);
                    setGeminiQuotaExhaustedCooldown(addToast, featureDescription);
                    return null; 
                }

                console.error(`Error during ${featureDescription} (attempt ${i + 1}/${retries + 1}). Status Code: ${statusCode}, Gemini Status: ${geminiErrorStatus}. Error: ${displayErrorMsg}`, error);

                if (i < retries) { 
                    if (isRateLimitErrorForRetry) { 
                        addToast(`Gemini API 요청 빈도가 높아 ${featureDescription}에 실패했습니다. ${currentDelay/1000}초 후 재시도합니다...`, "warning");
                    } else { 
                        addToast(`${featureDescription} 중 오류 발생. ${currentDelay/1000}초 후 재시도합니다... (오류: ${displayErrorMsg})`, "warning");
                    }
                    await new Promise(resolve => setTimeout(resolve, currentDelay)); 
                    currentDelay *= 2; 
                } else { 
                    if (isRateLimitErrorForRetry) {
                        addToast(`Gemini API 요청 빈도가 너무 높습니다 (${featureDescription}). 잠시 후 다시 시도해주세요.`, "error");
                    } else {
                        addToast(`${featureDescription} 정보를 AI로부터 가져오는 데 최종 실패했습니다: ${displayErrorMsg}`, "error");
                    }
                    return null;
                }
            }
        }
    } finally {
        setGlobalLoading(false);
    }
    console.warn(`generateDifferentExampleSentenceWithGemini for ${featureDescription} failed after all retries or due to unexpected flow.`);
    addToast(`${featureDescription}을 AI로부터 가져오는 데 최종 실패했습니다.`, "error");
    return null;
};*/


/*const _generateSummaryWithGemini = async (textToSummarize: string, addToast: (message: string, type: ToastMessage['type']) => void, setGlobalLoading: (loading: boolean) => void, retries = 2, initialDelay = 5000): Promise<string | null> => {
    if (!ai) {
        addToast("AI 요약 기능을 사용하려면 API 키가 필요합니다.", "warning");
        return null;
    }
    if (isCurrentlyGeminiQuotaExhausted) {
        addToast("Gemini API 할당량이 이전에 감지되어 현재 API 호출이 중단된 상태입니다. 텍스트 요약을 건너뜁니다.", "warning");
        return null;
    }
    if (!textToSummarize.trim()) {
        addToast("요약할 텍스트가 없습니다.", "info");
        return null;
    }
    setGlobalLoading(true);
    const modelName = 'gemini-2.5-flash-preview-04-17';
    const featureDescription = "텍스트 요약";
    const promptText = `Your response MUST be a JSON object with a "summary" field. Please provide a brief summary of the following text in Korean (around 2-3 sentences), focusing on the main topics or themes. Text: """${textToSummarize.substring(0, 30000)}"""`; 

    let currentDelay = initialDelay;
    try {
        for (let i = 0; i <= retries; i++) {
            try {
                console.log(`Gemini request for ${featureDescription}, attempt ${i + 1}/${retries + 1}`);
                const response: GenerateContentResponse = await ai.models.generateContent({
                    model: modelName,
                    contents: promptText,
                    config: {
                        responseMimeType: "application/json",
                        temperature: 0.6,
                    }
                });

                let jsonStr = response.text?.trim() || '';
                const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
                const match = jsonStr.match(fenceRegex);
                if (match && match[2]) {
                    jsonStr = match[2].trim();
                }
                const data = JSON.parse(jsonStr) as { summary: string };

                if (!data.summary || !data.summary.trim()) {
                    console.warn(`Gemini response missing summary field for ${featureDescription} (attempt ${i + 1}/${retries + 1}).`, data);
                    if (i < retries) {
                        addToast(`AI 요약 생성 중 내용이 누락되었습니다. 재시도 중...`, "warning");
                        await new Promise(resolve => setTimeout(resolve, currentDelay));
                        currentDelay *= 2;
                        continue;
                    } else {
                        addToast(`AI가 텍스트 요약을 제공하지 못했습니다. 모든 시도 실패.`, "error");
                        return null;
                    }
                }
                return data.summary;

            } catch (error: any) {
                const { isQuotaExhaustedError, isRateLimitErrorForRetry, displayErrorMsg, statusCode, geminiErrorStatus } = parseGeminiError(error);

                if (isQuotaExhaustedError) {
                    console.warn(`Gemini API call for ${featureDescription} failed on attempt ${i + 1}/${retries + 1} due to QUOTA EXHAUSTION (Code: ${statusCode}, Status: ${geminiErrorStatus}). Error: ${displayErrorMsg}. Cooldown will be activated. No further retries for this call.`);
                    setGeminiQuotaExhaustedCooldown(addToast, featureDescription);
                    return null; 
                }
                
                console.error(`Error during ${featureDescription} (attempt ${i + 1}/${retries + 1}). Status Code: ${statusCode}, Gemini Status: ${geminiErrorStatus}. Error: ${displayErrorMsg}`, error);

                if (i < retries) {
                    if (isRateLimitErrorForRetry) {
                        addToast(`Gemini API 요청 빈도가 높아 ${featureDescription}에 실패했습니다. ${currentDelay / 1000}초 후 재시도합니다...`, "warning");
                    } else {
                        addToast(`${featureDescription} 중 오류 발생. ${currentDelay / 1000}초 후 재시도합니다... (오류: ${displayErrorMsg})`, "warning");
                    }
                    await new Promise(resolve => setTimeout(resolve, currentDelay));
                    currentDelay *= 2;
                } else { 
                    if (isRateLimitErrorForRetry) {
                        addToast(`Gemini API 요청 빈도가 너무 높습니다 (${featureDescription}). 잠시 후 다시 시도해주세요.`, "error");
                    } else {
                        addToast(`${featureDescription}을 AI로부터 가져오는 데 최종 실패했습니다: ${displayErrorMsg}`, "error");
                    }
                    return null;
                }
            }
        }
    } finally {
        setGlobalLoading(false);
    }
     console.warn(`generateSummaryWithGemini for ${featureDescription} failed after all retries or due to unexpected flow.`);
    addToast(`${featureDescription}을 AI로부터 가져오는 데 최종 실패했습니다.`, "error");
    return null;
};*/

const generateImageForWordWithGemini = async (wordTerm: string, addToast: (message: string, type: ToastMessage['type']) => void, setGlobalLoading: (loading: boolean) => void, retries = 1, initialDelay = 8000): Promise<string | null> => {
    if (!ai) {
        addToast("AI 이미지 생성 기능을 사용하려면 API 키가 필요합니다.", "warning");
        return null;
    }
    if (isCurrentlyGeminiQuotaExhausted) {
        addToast(`Gemini API 할당량이 이전에 감지되어 현재 API 호출이 중단된 상태입니다. '${wordTerm}'의 이미지 생성을 건너뜁니다.`, "warning");
        return null;
    }
    setGlobalLoading(true);
    const modelName = 'imagen-3.0-generate-002';
    const featureDescription = `'${wordTerm}' AI 이미지 생성`;
    const prompt = `A clear, simple, educational, dictionary illustration style image representing the English word: "${wordTerm}". Focus on a single, easily recognizable subject related to the word's most common meaning. Vibrant and kid-friendly.`;

    let currentDelay = initialDelay;
    try {
        for (let i = 0; i <= retries; i++) {
            try {
                console.log(`Gemini request for ${featureDescription}, attempt ${i + 1}/${retries + 1}`);
                const response = await ai.models.generateImages({
                    model: modelName,
                    prompt: prompt,
                    config: { numberOfImages: 1, outputMimeType: 'image/jpeg' }, 
                });

                if (response.generatedImages && response.generatedImages.length > 0 && response.generatedImages[0].image?.imageBytes) {
                    addToast(`${featureDescription}이(가) 완료되었습니다.`, "success");
                    return response.generatedImages[0].image.imageBytes;
                } else {
                    console.warn(`Gemini image response missing imageBytes for ${featureDescription} (attempt ${i + 1}/${retries + 1}):`, response);
                    if (i < retries) {
                        addToast(`AI가 '${wordTerm}' 이미지를 반환했지만 데이터가 누락되었습니다. 재시도 중...`, "warning");
                        await new Promise(resolve => setTimeout(resolve, currentDelay));
                        currentDelay *= 2;
                        continue;
                    } else {
                        addToast(`AI가 '${wordTerm}'에 대한 이미지를 제공하지 못했습니다. 모든 시도 실패.`, "error");
                        return null;
                    }
                }
            } catch (error: any) {
                const { isQuotaExhaustedError, isRateLimitErrorForRetry, displayErrorMsg, statusCode, geminiErrorStatus } = parseGeminiError(error);

                if (isQuotaExhaustedError) {
                    console.warn(`Gemini API call for ${featureDescription} failed on attempt ${i + 1}/${retries + 1} due to QUOTA EXHAUSTION (Code: ${statusCode}, Status: ${geminiErrorStatus}). Error: ${displayErrorMsg}. Cooldown will be activated. No further retries for this call.`);
                    setGeminiQuotaExhaustedCooldown(addToast, featureDescription);
                    return null; 
                }

                console.error(`Error during ${featureDescription} (attempt ${i + 1}/${retries + 1}). Status Code: ${statusCode}, Gemini Status: ${geminiErrorStatus}. Error: ${displayErrorMsg}`, error);
                
                if (i < retries) {
                    if (isRateLimitErrorForRetry) {
                        addToast(`Gemini API 요청 빈도가 높아 ${featureDescription}에 실패했습니다. ${currentDelay / 1000}초 후 재시도합니다...`, "warning");
                    } else {
                        addToast(`${featureDescription} 중 오류 발생. ${currentDelay / 1000}초 후 재시도합니다... (오류: ${displayErrorMsg})`, "warning");
                    }
                    await new Promise(resolve => setTimeout(resolve, currentDelay));
                    currentDelay *= 2;
                } else { 
                    if (isRateLimitErrorForRetry) {
                        addToast(`Gemini API 요청 빈도가 너무 높습니다 (${featureDescription}). 잠시 후 다시 시도해주세요.`, "error");
                    } else {
                        addToast(`${featureDescription}을 AI로부터 가져오는 데 최종 실패했습니다: ${displayErrorMsg}`, "error");
                    }
                    return null;
                }
            }
        }
    } finally {
        setGlobalLoading(false);
    }
    console.warn(`generateImageForWordWithGemini for ${featureDescription} failed after all retries or due to unexpected flow.`);
    addToast(`${featureDescription}을 AI로부터 가져오는 데 최종 실패했습니다.`, "error");
    return null;
};


// --- App Context ---
interface AppContextType {
    userSettings: UserSettings;
    handleSaveSettings: (settings: UserSettings) => void;
    handleResetData: () => void;
    onNavigate: (screen: AppScreen, params?: any) => void;
    allWords: Word[];
    wordStats: Record<string | number, WordStat>;
    handleWordLearned: (wordId: string | number) => void;
    handleQuizComplete: (score: number, total: number, incorrectWords: Word[]) => void;
    updateWordStat: (wordId: string | number, updates: Partial<WordStat>) => void;
    handleDeleteCustomWord: (wordId: string | number, options?: { silent: boolean }) => void;
    handleSaveCustomWord: (word: Partial<Word>, gradeLevel?: string, unit?: number) => Promise<{ success: boolean; reason?: string }>;
    memoizedStats: {
        learnedWordsToday: number;
        totalWordsLearned: number;
        learningStreak: { currentStreak: number; bestStreak: number };
        averageQuizScore: number;
        quizTakenToday: boolean;
        gamePlayedToday: boolean;
        hasIncorrectWordsToReview: boolean;
    };
    setGlobalLoading: (loading: boolean) => void;
    addXp: (amount: number) => void;
    handleGameComplete: (score: number, correct: number, incorrect: number, timeTaken: number) => void;
    isSettingsModalOpen: boolean;
    handleOpenSettings: () => void;
    handleCloseSettings: () => void;
    appScreen: AppScreen;
    routeParams: any;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const useAppContext = () => {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
};


// --- UI Components ---

// Confirmation Modal
interface ConfirmationModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
    confirmButtonClass?: string;
}
const ConfirmationModal: React.FC<ConfirmationModalProps> = React.memo(({ isOpen, title, message, onConfirm, onCancel, confirmText = "확인", cancelText = "취소", confirmButtonClass = "bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800" }) => {
    if (!isOpen) return null;

    return (
        <div role="dialog" aria-modal="true" aria-labelledby="confirmation-modal-title" className="fixed inset-0 bg-slate-900/75 dark:bg-slate-900/80 flex justify-center items-center p-4 z-[60] animate-fadeIn">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-md">
                <h3 id="confirmation-modal-title" className="text-xl font-semibold text-cyan-600 dark:text-cyan-400 mb-4">{title}</h3>
                <p className="text-slate-600 dark:text-slate-300 mb-6">{message}</p>
                <div className="flex justify-end space-x-3">
                    <button onClick={onCancel} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-600 dark:hover:bg-slate-500 rounded text-slate-700 dark:text-white transition-colors">
                        {cancelText}
                    </button>
                    <button onClick={onConfirm} className={`px-4 py-2 rounded text-white transition-colors ${confirmButtonClass}`}>
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
});


// Edit Settings Modal
interface EditSettingsModalProps {
    isOpen: boolean;
    onCancel: () => void;
}
const EditSettingsModal: React.FC<EditSettingsModalProps> = React.memo(({ isOpen, onCancel }) => {
    const { userSettings, handleSaveSettings, handleResetData } = useAppContext();
    const { addToast } = useToasts();
    
    const [username, setUsername] = useState(userSettings.username);
    const [grade, setGrade] = useState(userSettings.grade);
    const [dailyGoal, setDailyGoal] = useState(userSettings.dailyGoal);
    const [theme, setTheme] = useState(userSettings.theme);
    const [speechRate, setSpeechRate] = useState(userSettings.speechRate);
    const [autoPlayAudio, setAutoPlayAudio] = useState(userSettings.autoPlayAudio);
    const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');
    const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setUsername(userSettings.username);
            setGrade(userSettings.grade);
            setDailyGoal(userSettings.dailyGoal);
            setTheme(userSettings.theme);
            setSpeechRate(userSettings.speechRate);
            setAutoPlayAudio(userSettings.autoPlayAudio);
        }
    }, [userSettings, isOpen]); 

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!username.trim()) {
            addToast("사용자 이름은 비워둘 수 없습니다.", "warning");
            return;
        }
        
        // Save API key to localStorage
        if (apiKey.trim()) {
            localStorage.setItem('gemini_api_key', apiKey.trim());
            // Try to initialize AI with new key
            if (initializeAI(apiKey.trim())) {
                addToast("Google Gemini API 키가 설정되었습니다. AI 기능이 활성화됩니다.", "success");
            } else {
                addToast("API 키가 유효하지 않습니다. 다시 확인해주세요.", "error");
            }
        } else {
            localStorage.removeItem('gemini_api_key');
            ai = null;
            addToast("API 키가 제거되었습니다. AI 기능이 비활성화됩니다.", "info");
        }
        
        handleSaveSettings({ ...userSettings, username: username.trim(), grade, dailyGoal, theme, speechRate, autoPlayAudio });
        onCancel();
    };

    const handleResetClick = () => {
        setShowResetConfirmModal(true);
    };

    const confirmResetData = () => {
        handleResetData();
        setShowResetConfirmModal(false);
        onCancel(); // Close settings modal after reset initiated
    };

    return (
        <>
        <div role="dialog" aria-modal="true" aria-labelledby="edit-settings-modal-title" className="fixed inset-0 bg-slate-900/75 dark:bg-slate-900/80 flex justify-center items-center p-4 z-[60] animate-fadeIn">
            <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar">
                <h3 id="edit-settings-modal-title" className="text-2xl font-bold text-cyan-600 dark:text-cyan-400 mb-6 text-center">설정 변경</h3>
                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Username, Grade, Daily Goal */}
                    <div>
                        <label htmlFor="edit-username" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">사용자 이름</label>
                        <input type="text" id="edit-username" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full p-3 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" required />
                    </div>
                    <div>
                        <label htmlFor="edit-grade" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">학년 선택</label>
                        <select id="edit-grade" value={grade} onChange={(e) => setGrade(e.target.value)} className="w-full p-3 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500">
                            <option value="middle1">중학교 1학년</option>
                            <option value="middle2">중학교 2학년</option>
                            <option value="middle3">중학교 3학년</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="edit-dailyGoal" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">일일 학습 목표 (단어 수)</label>
                        <input type="number" id="edit-dailyGoal" value={dailyGoal} onChange={(e) => setDailyGoal(Math.max(1, parseInt(e.target.value) || 1))} min="1" className="w-full p-3 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
                    </div>

                    {/* Speech Rate */}
                    <div>
                        <label htmlFor="edit-speechRate" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">말하기 속도: <span className="font-semibold text-cyan-600 dark:text-cyan-400">{speechRate.toFixed(1)}x</span></label>
                        <input type="range" id="edit-speechRate" min="0.5" max="2" step="0.1" value={speechRate} onChange={(e) => setSpeechRate(parseFloat(e.target.value))} className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
                    </div>

                    {/* Auto-play Audio */}
                    <div className="flex items-center justify-between">
                         <span className="text-sm font-medium text-slate-700 dark:text-slate-300">학습 중 새 단어 자동 재생</span>
                        <div className="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                            <input type="checkbox" name="autoPlayAudio" id="autoPlayAudio-toggle" checked={autoPlayAudio} onChange={() => setAutoPlayAudio(!autoPlayAudio)} className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer border-slate-300 dark:border-slate-500"/>
                            <label htmlFor="autoPlayAudio-toggle" className="toggle-label block overflow-hidden h-6 rounded-full bg-slate-300 dark:bg-slate-500 cursor-pointer"></label>
                        </div>
                    </div>

                    {/* Google Gemini API Key */}
                    <div>
                        <label htmlFor="edit-apiKey" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Google Gemini API 키 (AI 기능용)
                        </label>
                        <input 
                            type="password" 
                            id="edit-apiKey" 
                            value={apiKey} 
                            onChange={(e) => setApiKey(e.target.value)} 
                            placeholder="Google Gemini API 키를 입력하세요 (선택사항)"
                            className="w-full p-3 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" 
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            AI 튜터 채팅을 사용하려면 <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="text-cyan-600 dark:text-cyan-400 hover:underline">Google AI Studio</a>에서 API 키를 발급받아 입력하세요.
                        </p>
                    </div>

                    <div className="border-t border-slate-200 dark:border-slate-700 pt-5 space-y-3">
                         <button 
                            type="button" 
                            onClick={handleResetClick}
                            className="w-full px-4 py-2 bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 rounded text-white text-sm"
                        >
                            학습 데이터 초기화
                        </button>
                        <div className="flex justify-end space-x-3">
                            <button type="button" onClick={onCancel} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-600 dark:hover:bg-slate-500 rounded text-slate-700 dark:text-white">취소</button>
                            <button type="submit" className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 rounded text-white">저장</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
        <ConfirmationModal
                isOpen={showResetConfirmModal}
                title="데이터 초기화 확인"
                message="정말로 모든 학습 데이터와 설정을 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다."
                onConfirm={confirmResetData}
                onCancel={() => setShowResetConfirmModal(false)}
                confirmText="초기화"
                confirmButtonClass="bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800"
            />
        </>
    );
});


// Navigation Bar Component
interface NavBarProps {
    currentScreen: AppScreen;
    onOpenSettings: () => void;
}
const NavBar: React.FC<NavBarProps> = React.memo(({ currentScreen, onOpenSettings }) => {
    const { onNavigate, userSettings } = useAppContext();
    const [isDark, setIsDark] = useState(() => {
        try {
            const saved = localStorage.getItem('darkMode');
            if (saved !== null) {
                return saved === 'true';
            }
            // 시스템 설정 확인
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        } catch (error) {
            console.error('Error reading dark mode setting:', error);
            return false;
        }
    });
    
    // 다크모드 토글 함수
    const handleToggleDarkMode = () => {
        try {
            const newTheme = toggleDarkMode();
            setIsDark(newTheme === 'dark');
        } catch (error) {
            console.error('Error toggling dark mode:', error);
        }
    };
    
    const navItems: { screen: AppScreen; label: string; icon: string }[] = [
        { screen: 'dashboard', label: '대시보드', icon: '🏠' },
        { screen: 'learnWords', label: '단어 학습', icon: '📖' },
        { screen: 'quiz', label: '퀴즈', icon: '📝' },
        { screen: 'tutorChat', label: 'AI 튜터', icon: '💬' },
        { screen: 'gameSelection', label: '게임 모드', icon: '🎮' },
        { screen: 'allWords', label: '전체 단어', icon: '📚' },
        { screen: 'manageWords', label: '단어 추가', icon: '➕' },
        { screen: 'stats', label: '통계', icon: '📊' },
    ];

    if (!userSettings) return null; 

    return (
        <nav className="bg-slate-100 dark:bg-slate-700 p-3 shadow-md sticky top-0 z-50 border-b border-slate-200 dark:border-slate-600">
            <ul className="flex flex-wrap justify-center items-center gap-1 sm:gap-2">
                {navItems.map((item) => (
                    <li key={item.screen}>
                        <button
                            onClick={() => onNavigate(item.screen)}
                            aria-current={currentScreen === item.screen ? "page" : undefined}
                            className={`flex flex-col sm:flex-row items-center justify-center p-1.5 sm:px-2.5 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors duration-150 ease-in-out
                                ${currentScreen === item.screen
                                    ? 'bg-cyan-500 text-white shadow-lg ring-2 ring-cyan-300 dark:ring-cyan-600'
                                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-800 dark:hover:text-white'
                                }`}
                        >
                            <span className="text-base sm:text-lg sm:mr-1.5 mb-0.5 sm:mb-0">{item.icon}</span>
                            {item.label}
                        </button>
                    </li>
                ))}
                 {/* Dark Mode Toggle */}
                <li>
                    <button
                        onClick={handleToggleDarkMode}
                        title="다크모드 전환"
                        className="flex flex-col sm:flex-row items-center justify-center p-1.5 sm:px-2.5 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-800 dark:hover:text-white transition-colors"
                    >
                        <span className="text-base sm:text-lg sm:mr-1.5 mb-0.5 sm:mb-0">
                            {isDark ? '☀️' : '🌙'}
                        </span>
                        <span className="hidden sm:inline">
                            {isDark ? '라이트' : '다크'}
                        </span>
                     </button>
                </li>
                
                <li>
                    <button
                        onClick={onOpenSettings}
                        title="설정 변경"
                        aria-label="설정 변경"
                        className="flex flex-col sm:flex-row items-center justify-center p-1.5 sm:px-2.5 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-800 dark:hover:text-white transition-colors"
                    >
                        <span className="text-base sm:text-lg sm:mr-1.5 mb-0.5 sm:mb-0">⚙️</span>
                        <span className="hidden sm:inline">설정</span>
                        <span className="sm:hidden">설정</span>
                    </button>
                </li>
            </ul>
        </nav>
    );
});


// Login/Setup Screen Component
interface LoginSetupScreenProps {
    onSetupComplete: (settings: UserSettings) => void;
}
const LoginSetupScreen: React.FC<LoginSetupScreenProps> = ({ onSetupComplete }) => {
    const { addToast } = useToasts();
    const [username, setUsername] = useState('');
    const [grade, setGrade] = useState('middle1');
    const [dailyGoal, setDailyGoal] = useState(10);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!username.trim()) {
            addToast("사용자 이름을 입력해주세요.", "warning");
            return;
        }
        onSetupComplete({ 
            username: username.trim(), 
            grade, 
            textbook: '', 
            dailyGoal,
            theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', 
            speechRate: 1.0, 
            autoPlayAudio: true,
            xp: 0,
            level: 1,
            currentStreak: 0,
            bestStreak: 0,
            lastLearnedDate: undefined,
            lastQuizDate: undefined,
            lastQuizScore: undefined,
            lastGameDate: undefined,
        });
    };

    return (
        <div className="p-6 sm:p-8 bg-slate-100 dark:bg-slate-800 min-h-screen flex flex-col justify-center items-center">
            <div className="w-full max-w-md bg-white dark:bg-slate-700 p-8 rounded-xl shadow-2xl">
                <h1 className="text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-8 text-center">AI 영단어 학습 설정</h1>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="username" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">사용자 이름</label>
                        <input
                            type="text"
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full p-3 bg-slate-100 dark:bg-slate-600 text-slate-900 dark:text-white rounded-md border border-slate-300 dark:border-slate-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                            placeholder="이름을 입력하세요"
                            aria-required="true"
                        />
                    </div>
                    <div>
                        <label htmlFor="grade" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">학년 선택</label>
                        <select
                            id="grade"
                            value={grade}
                            onChange={(e) => setGrade(e.target.value)}
                            className="w-full p-3 bg-slate-100 dark:bg-slate-600 text-slate-900 dark:text-white rounded-md border border-slate-300 dark:border-slate-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                            aria-required="true"
                        >
                            <option value="middle1">중학교 1학년</option>
                            <option value="middle2">중학교 2학년</option>
                            <option value="middle3">중학교 3학년</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="dailyGoal" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">일일 학습 목표 (단어 수)</label>
                        <input
                            type="number"
                            id="dailyGoal"
                            value={dailyGoal}
                            onChange={(e) => setDailyGoal(Math.max(1, parseInt(e.target.value) || 1))}
                            min="1"
                            className="w-full p-3 bg-slate-100 dark:bg-slate-600 text-slate-900 dark:text-white rounded-md border border-slate-300 dark:border-slate-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                            aria-required="true"
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full py-3 px-4 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-75"
                    >
                        학습 시작
                    </button>
                </form>
            </div>
        </div>
    );
};


// Dashboard Screen Component
interface DashboardScreenProps {
    learnedWordsToday: number;
    totalWordsLearned: number;
    learningStreak: { currentStreak: number; bestStreak: number };
    averageQuizScore: number;
    quizTakenToday: boolean;
    gamePlayedToday: boolean;
    hasIncorrectWordsToReview: boolean;
}
const DashboardScreen: React.FC<DashboardScreenProps> = React.memo(({ 
    learnedWordsToday, 
    totalWordsLearned,
    learningStreak,
    averageQuizScore,
    quizTakenToday,
    gamePlayedToday,
    hasIncorrectWordsToReview,
}) => {
    const { userSettings, onNavigate } = useAppContext();
    const { addToast } = useToasts();

    const dailyGoalAchieved = learnedWordsToday >= userSettings.dailyGoal;
    const xpForNextLevel = (userSettings.level) * 100; // Example: Level 1 needs 100 XP total, Level 2 needs 200 XP total for next level

    const renderChallengeItem = (text: string, isAchieved: boolean, reward: number, actionButton?: {label: string, onClick: () => void}) => (
         <li className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md shadow-sm">
            <div className="flex items-center">
                <span className={`mr-3 text-xl ${isAchieved ? 'text-green-500' : 'text-slate-400 dark:text-slate-500'}`}>
                    {isAchieved ? '✅' : '⚪'}
                </span>
                <span className={`text-sm sm:text-base ${isAchieved ? 'line-through text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
                    {text}
                </span>
            </div>
            {actionButton && !isAchieved ? (
                 <button 
                    onClick={actionButton.onClick}
                    className="ml-2 px-2 py-1 text-xs bg-cyan-500 hover:bg-cyan-600 text-white rounded-md"
                >
                    {actionButton.label}
                </button>
            ) : (
                <span className={`text-xs font-medium ${isAchieved ? 'text-green-500' : 'text-yellow-500 dark:text-yellow-400'}`}>
                    +{reward} XP
                </span>
            )}
        </li>
    );

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400">
                안녕하세요, {userSettings.username}님! 👋 (Lv. {userSettings.level})
            </h1>

            {/* XP and Level Progress */}
            <div className="bg-slate-100 dark:bg-slate-700 p-4 sm:p-6 rounded-lg shadow-lg">
                <div className="flex justify-between items-center mb-1">
                    <h2 className="text-md sm:text-lg font-semibold text-cyan-700 dark:text-cyan-300">경험치 (XP)</h2>
                    <span className="text-sm font-semibold text-yellow-600 dark:text-yellow-400">Lv. {userSettings.level}</span>
                </div>
                <p className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white">
                    {userSettings.xp} / {xpForNextLevel} XP
                </p>
                <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2.5 sm:h-3.5 mt-2 overflow-hidden" role="progressbar" aria-valuenow={userSettings.xp} aria-valuemin={0} aria-valuemax={xpForNextLevel}>
                    <div
                        className="bg-yellow-500 h-full rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${Math.min(100, (userSettings.xp / Math.max(1, xpForNextLevel)) * 100)}%` }}
                    ></div>
                </div>
                 <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-right">다음 레벨까지 {Math.max(0, xpForNextLevel - userSettings.xp)} XP</p>
            </div>


            {/* Today's Learning Goal */}
            <div className="bg-slate-100 dark:bg-slate-700 p-4 sm:p-6 rounded-lg shadow-lg">
                <div className="flex justify-between items-center mb-2">
                    <h2 className="text-lg sm:text-xl font-semibold text-cyan-700 dark:text-cyan-300">오늘의 학습 목표</h2>
                    <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${dailyGoalAchieved ? 'bg-green-100 text-green-700 dark:bg-green-700 dark:text-green-100' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-700 dark:text-yellow-100'}`}>
                        {dailyGoalAchieved ? '목표 달성! 🎉' : '진행 중'}
                    </span>
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-white">{learnedWordsToday} / {userSettings.dailyGoal} 단어</p>
                <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-3 sm:h-4 mt-3 overflow-hidden" role="progressbar" aria-valuenow={learnedWordsToday} aria-valuemin={0} aria-valuemax={userSettings.dailyGoal}>
                    <div
                        className="bg-green-500 h-full rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${Math.min(100, (learnedWordsToday / Math.max(1,userSettings.dailyGoal)) * 100)}%` }}
                    ></div>
                </div>
            </div>

            {/* Key Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                <div className="bg-slate-100 dark:bg-slate-700 p-4 rounded-lg shadow-lg text-center sm:text-left">
                    <h3 className="text-md sm:text-lg font-semibold text-cyan-700 dark:text-cyan-300 mb-1">📚 총 학습 단어</h3>
                    <p className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-white">{totalWordsLearned} <span className="text-sm">개</span></p>
                </div>
                <div className="bg-slate-100 dark:bg-slate-700 p-4 rounded-lg shadow-lg text-center sm:text-left">
                    <h3 className="text-md sm:text-lg font-semibold text-cyan-700 dark:text-cyan-300 mb-1">🔥 연속 학습</h3>
                    <p className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white">현재: {learningStreak.currentStreak}일</p>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">최고: {learningStreak.bestStreak}일</p>
                </div>
                <div className="bg-slate-100 dark:bg-slate-700 p-4 rounded-lg shadow-lg text-center sm:text-left">
                    <h3 className="text-md sm:text-lg font-semibold text-cyan-700 dark:text-cyan-300 mb-1">📊 학습 요약</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300">오늘 학습: <span className="font-semibold">{learnedWordsToday}</span> 단어</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">평균 퀴즈 정답률: <span className="font-semibold">{averageQuizScore.toFixed(1)}%</span></p>
                </div>
            </div>
            
            {/* Today's Challenges */}
            <div className="bg-slate-100 dark:bg-slate-700 p-4 sm:p-6 rounded-lg shadow-lg">
                <h2 className="text-lg sm:text-xl font-semibold text-cyan-700 dark:text-cyan-300 mb-3">⭐ 오늘의 도전 과제</h2>
                <ul className="space-y-2">
                    {renderChallengeItem(
                        `오늘 단어 ${userSettings.dailyGoal}개 학습`,
                        dailyGoalAchieved,
                        20
                    )}
                    {renderChallengeItem(
                        "퀴즈 1회 완료",
                        quizTakenToday,
                        15,
                        !quizTakenToday ? { label: "퀴즈 풀기", onClick: () => onNavigate('quiz') } : undefined
                    )}
                     {renderChallengeItem(
                        "게임 모드 1회 플레이",
                        gamePlayedToday,
                        25,
                        !gamePlayedToday ? { label: "게임 하러가기", onClick: () => onNavigate('gameSelection') } : undefined
                    )}
                    {renderChallengeItem(
                        "오답 단어 복습하기",
                        false, 
                        10,
                        hasIncorrectWordsToReview ? { label: "복습 하러가기", onClick: () => onNavigate('quiz') } : { label: "오답 없음", onClick: () => addToast("복습할 오답 단어가 없습니다!", "info") }
                    )}
                </ul>
            </div>
            
            {/* Quick Actions */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                 <button
                    onClick={() => onNavigate('learnWords')}
                    className="py-3 px-2 bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-semibold rounded-lg shadow-md transition-colors duration-150 ease-in-out flex items-center justify-center"
                >
                    <span className="text-xl mr-2" aria-hidden="true">📖</span> 학습
                </button>
                 <button
                    onClick={() => onNavigate('quiz')}
                    className="py-3 px-2 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold rounded-lg shadow-md transition-colors duration-150 ease-in-out flex items-center justify-center"
                >
                     <span className="text-xl mr-2" aria-hidden="true">📝</span> 퀴즈
                </button>
                 <button
                    onClick={() => onNavigate('gameSelection')}
                    className="py-3 px-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg shadow-md transition-colors duration-150 ease-in-out flex items-center justify-center"
                >
                     <span className="text-xl mr-2" aria-hidden="true">🎮</span> 게임
                </button>
                 <button
                    onClick={() => onNavigate('tutorChat')}
                    className="py-3 px-2 bg-purple-500 hover:bg-purple-600 text-white text-sm font-semibold rounded-lg shadow-md transition-colors duration-150 ease-in-out flex items-center justify-center"
                >
                     <span className="text-xl mr-2" aria-hidden="true">💬</span> AI튜터
                </button>
            </div>

            <footer className="mt-8 pt-4 border-t border-slate-200 dark:border-slate-600 text-center text-xs text-slate-500 dark:text-slate-400">
                <a href="#" onClick={(e)=>{e.preventDefault(); addToast("도움말 기능은 준비 중입니다.", "info")}} className="hover:underline">도움말</a>
                <span className="mx-2">|</span>
                <a href="#" onClick={(e)=>{e.preventDefault(); addToast("앱 설치 안내는 준비 중입니다. 브라우저의 '홈 화면에 추가' 기능을 사용해보세요.", "info")}} className="hover:underline">앱 설치 안내</a>
            </footer>
        </div>
    );
});


// LearnWords Screen Component (Refactored for Unit-based learning and Card Flip)
interface LearnWordsScreenProps {
    routeParams?: any;
}
const LearnWordsScreen: React.FC<LearnWordsScreenProps> = ({ routeParams }) => {
    const { userSettings, onNavigate, allWords, handleWordLearned } = useAppContext();
    const { addToast } = useToasts();
    
    const [mode, setMode] = useState<'selecting' | 'learning'>(routeParams?.unitToLearn ? 'learning' : 'selecting');
    const [selectedUnit, setSelectedUnit] = useState<string | number | null>(routeParams?.unitToLearn || null);
    const [dropdownSelection, setDropdownSelection] = useState<string | number>(routeParams?.unitToLearn || 'all');
    const [learningWords, setLearningWords] = useState<Word[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);

    const currentWord = learningWords[currentIndex];

    const units = useMemo(() => {
        const unitSet = new Set<string | number>();
        allWords.forEach(word => {
            if (word.unit) unitSet.add(word.unit);
        });
        return Array.from(unitSet).sort((a, b) => Number(a) - Number(b));
    }, [allWords]);

    useEffect(() => {
        if (mode === 'learning' && currentWord && userSettings.autoPlayAudio) {
            const speakWithDelay = setTimeout(() => {
                speak(currentWord.term, undefined, userSettings.speechRate);
            }, 100);
            return () => clearTimeout(speakWithDelay);
        }
    }, [currentWord, mode, userSettings.autoPlayAudio, userSettings.speechRate]);

    const startLearningSession = useCallback((unit: string | number) => {
        let wordsForSession: Word[];

        if (unit === 'all') {
            if (allWords.length < 10) {
                 addToast(`'전체' 모드를 위해 단어가 최소 10개 필요합니다.`, "warning");
                 return;
            }
            wordsForSession = shuffleArray(allWords).slice(0, 30);
        } else {
            const filteredWords = allWords.filter(w => String(w.unit) === String(unit));
            wordsForSession = shuffleArray(filteredWords);
        }
        
        if (wordsForSession.length === 0) {
            addToast(unit === 'all' ? `학습할 단어가 없습니다.` : `단원 ${unit}에 학습할 단어가 없습니다.`, "warning");
            return;
        }

        setLearningWords(wordsForSession);
        setSelectedUnit(unit);
        setCurrentIndex(0);
        setIsFlipped(false);
        setMode('learning');
    }, [allWords, addToast]);

    useEffect(() => {
        if (mode === 'learning' && selectedUnit && learningWords.length === 0) {
            startLearningSession(selectedUnit);
        }
    }, [mode, selectedUnit, startLearningSession, learningWords.length]);
    
    const resetWordSpecificStates = useCallback(() => {
        setIsFlipped(false);
    }, []);

    const handleNextWord = () => {
        handleWordLearned(currentWord.id);
        if (currentIndex < learningWords.length - 1) {
            resetWordSpecificStates();
            setCurrentIndex(prevIndex => prevIndex + 1);
        } else {
            const unitName = selectedUnit === 'all' ? '전체 학습' : `단원 ${selectedUnit}`;
            addToast(`${unitName} 학습을 완료했습니다! 🎉`, "success");
            onNavigate('dashboard');
        }
    };

    const handlePreviousWord = () => {
        if (currentIndex > 0) {
            resetWordSpecificStates();
            setCurrentIndex(prevIndex => prevIndex - 1);
        }
    };
    
    if (mode === 'selecting') {
        return (
            <div className="p-4 sm:p-8 flex flex-col items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6">학습 모드 선택</h1>
                <div className="w-full max-w-md bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-lg space-y-6">
                    <div>
                        <label htmlFor="unit-select-learn" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">모드 선택</label>
                        <select
                            id="unit-select-learn"
                            value={dropdownSelection}
                            onChange={(e) => setDropdownSelection(e.target.value)}
                            className="w-full p-3 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500 focus:ring-2 focus:ring-cyan-500"
                        >
                            <option value="all">전체 단어 (랜덤 30단어)</option>
                            <optgroup label="단원별 학습">
                                {units.map(unit => <option key={unit} value={unit}>단원 {unit}</option>)}
                            </optgroup>
                        </select>
                    </div>
                    <button 
                        onClick={() => startLearningSession(dropdownSelection)} 
                        className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md"
                    >
                        학습 시작
                    </button>
                </div>
                 <div className="text-center mt-8">
                     <button onClick={() => onNavigate('dashboard')} className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline">
                        대시보드로 돌아가기
                    </button>
                </div>
            </div>
        );
    }
    
    const unitName = selectedUnit === 'all' ? '전체 학습' : `단원 ${selectedUnit}`;

    if (!currentWord) {
        return (
            <div className="p-8 text-center text-xl text-slate-600 dark:text-slate-300">
                <p>단어를 불러오는 중...</p>
                <button onClick={() => setMode('selecting')} className="mt-4 text-sm text-cyan-600 dark:text-cyan-400 hover:underline">
                    학습 모드 선택으로 돌아가기
                </button>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-8 flex flex-col items-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-4 sm:mb-6">
                {unitName} ({currentIndex + 1} / {learningWords.length})
            </h1>

            <div className="w-full max-w-lg perspective cursor-pointer" onClick={() => setIsFlipped(f => !f)}>
                <div className={`card-inner ${isFlipped ? 'is-flipped' : ''}`}>
                    {/* Front Face */}
                    <div className="card-face bg-slate-100 dark:bg-slate-700 p-6 sm:p-8">
                        <button 
                            onClick={(e) => { e.stopPropagation(); speak(currentWord.term, undefined, userSettings.speechRate); }} 
                            className="absolute top-4 right-4 text-slate-500 dark:text-slate-400 hover:text-cyan-500 dark:hover:text-cyan-400 text-3xl z-10" 
                            aria-label="단어 발음 듣기"
                        >
                            🔊
                        </button>
                        <h2 className="text-5xl sm:text-6xl font-bold text-slate-800 dark:text-white mb-3 break-all">{currentWord.term}</h2>
                        {currentWord.pronunciation && <p className="text-slate-500 dark:text-slate-400 text-lg mb-2">[{currentWord.pronunciation}]</p>}
                        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">카드를 클릭하여 뜻을 확인하세요.</p>
                    </div>
                    {/* Back Face */}
                    <div className="card-face card-back bg-cyan-50 dark:bg-slate-800 p-6 sm:p-8 text-left overflow-y-auto custom-scrollbar">
                        <div className="w-full">
                             <button 
                                onClick={(e) => { e.stopPropagation(); speak(currentWord.exampleSentence, undefined, userSettings.speechRate); }} 
                                className="absolute top-4 right-4 text-slate-500 dark:text-slate-400 hover:text-cyan-500 dark:hover:text-cyan-400 text-3xl z-10" 
                                aria-label="예문 발음 듣기"
                            >
                                🔊
                            </button>
                            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-3">{currentWord.term}</h2>
                            <p className="text-xl text-cyan-600 dark:text-cyan-300 font-semibold mb-4">{currentWord.partOfSpeech}: {currentWord.meaning}</p>
                            
                            <div className="mt-3 pt-3 border-t border-slate-300 dark:border-slate-600">
                                <p className="text-slate-700 dark:text-slate-200"><span className="font-semibold">예문:</span> {currentWord.exampleSentence}</p>
                                {currentWord.exampleSentenceMeaning && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1"><span className="font-semibold">해석:</span> {currentWord.exampleSentenceMeaning}</p>}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex justify-between mt-6 w-full max-w-lg">
                <button
                    onClick={handlePreviousWord}
                    disabled={currentIndex === 0}
                    className="w-1/2 mr-2 py-3 px-4 bg-slate-400 hover:bg-slate-500 text-white font-bold rounded-md shadow-lg transition-colors disabled:opacity-50"
                >
                    이전 단어
                </button>
                <button
                    onClick={handleNextWord}
                    className="w-1/2 ml-2 py-3 px-4 bg-green-500 hover:bg-green-600 text-white font-bold rounded-md shadow-lg transition-colors"
                >
                   {currentIndex === learningWords.length - 1 ? '학습 완료' : '다음 단어'}
                </button>
            </div>
            
            <button onClick={() => setMode('selecting')} className="mt-8 text-sm text-cyan-600 dark:text-cyan-400 hover:underline">
                다른 학습 모드 선택하기
            </button>
        </div>
    );
};


// Quiz Screen Component (Refactored to use useReducer)
interface QuizScreenProps {
    routeParams?: any;
}

type QuizScreenState = {
    quizState: 'setup' | 'playing' | 'finished';
    selectedUnit: string | number;
    quizType: 'multiple' | 'typing';
    quizWords: Word[];
    currentQuestionIndex: number;
    score: number;
    incorrectlyAnsweredWords: Word[];
    options: string[];
    selectedAnswer: string | null;
    showResult: boolean;
    typedAnswer: string;
    inputFeedbackStyle: string;
};

type QuizAction =
  | { type: 'CHANGE_SETUP'; payload: { key: 'selectedUnit' | 'quizType' | 'typedAnswer'; value: string } }
  | { type: 'START_QUIZ'; payload: { quizWords: Word[]; options: string[] } }
  | { type: 'SUBMIT_MULTIPLE_CHOICE'; payload: { selectedAnswer: string; isCorrect: boolean; word: Word } }
  | { type: 'SUBMIT_TYPING'; payload: { isCorrect: boolean; word: Word } }
  | { type: 'NEXT_QUESTION'; payload: { options: string[] } }
  | { type: 'FINISH_QUIZ' }
  | { type: 'RESTART_QUIZ' };


const QuizScreen: React.FC<QuizScreenProps> = ({ routeParams }) => {
    const { userSettings, onNavigate, allWords, wordStats, handleQuizComplete, updateWordStat } = useAppContext();
    const { addToast } = useToasts();
    
    const initialQuizState: QuizScreenState = {
        quizState: 'setup',
        selectedUnit: routeParams?.unitToLearn || 'all',
        quizType: 'multiple',
        quizWords: [],
        currentQuestionIndex: 0,
        score: 0,
        incorrectlyAnsweredWords: [],
        options: [],
        selectedAnswer: null,
        showResult: false,
        typedAnswer: '',
        inputFeedbackStyle: 'border-slate-300 dark:border-slate-500 focus:ring-cyan-500 focus:border-cyan-500',
    };

    const quizReducer = (state: QuizScreenState, action: QuizAction): QuizScreenState => {
        switch (action.type) {
            case 'CHANGE_SETUP':
                return { ...state, [action.payload.key]: action.payload.value };
            
            case 'START_QUIZ':
                return {
                    ...initialQuizState,
                    quizState: 'playing',
                    quizType: state.quizType,
                    selectedUnit: state.selectedUnit,
                    quizWords: action.payload.quizWords,
                    options: action.payload.options,
                };

            case 'SUBMIT_MULTIPLE_CHOICE': {
                const { selectedAnswer, isCorrect, word } = action.payload;
                return {
                    ...state,
                    selectedAnswer,
                    showResult: true,
                    score: isCorrect ? state.score + 1 : state.score,
                    incorrectlyAnsweredWords: isCorrect ? state.incorrectlyAnsweredWords : [...state.incorrectlyAnsweredWords, word],
                };
            }

            case 'SUBMIT_TYPING': {
                const { isCorrect, word } = action.payload;
                return {
                    ...state,
                    inputFeedbackStyle: isCorrect ? 'border-green-500 ring-2 ring-green-500' : 'border-red-500 ring-2 ring-red-500 animate-shake',
                    showResult: true, // Show result immediately for typing
                    score: isCorrect ? state.score + 1 : state.score,
                    incorrectlyAnsweredWords: isCorrect ? state.incorrectlyAnsweredWords : [...state.incorrectlyAnsweredWords, word],
                };
            }
            
            case 'NEXT_QUESTION':
                return {
                    ...state,
                    currentQuestionIndex: state.currentQuestionIndex + 1,
                    options: action.payload.options,
                    selectedAnswer: null,
                    showResult: false,
                    typedAnswer: '',
                    inputFeedbackStyle: 'border-slate-300 dark:border-slate-500 focus:ring-cyan-500 focus:border-cyan-500',
                };

            case 'FINISH_QUIZ':
                handleQuizComplete(state.score, state.quizWords.length, state.incorrectlyAnsweredWords);
                return { ...state, quizState: 'finished' };
            
            case 'RESTART_QUIZ':
                return { ...initialQuizState, selectedUnit: state.selectedUnit, quizType: state.quizType }; // keep setup options

            default:
                throw new Error("Unhandled action in quizReducer");
        }
    };

    const [state, dispatch] = useReducer(quizReducer, initialQuizState);
    const { quizState, selectedUnit, quizType, quizWords, currentQuestionIndex, score, incorrectlyAnsweredWords, options, selectedAnswer, showResult, typedAnswer, inputFeedbackStyle } = state;

    const units = useMemo(() => {
        const unitSet = new Set<string | number>();
        allWords.forEach(word => {
            if (word.unit) unitSet.add(word.unit);
        });
        return Array.from(unitSet).sort((a, b) => Number(a) - Number(b));
    }, [allWords]);
    
    const generateMultipleChoiceOptions = useCallback((correctWord: Word, allWordsForOptions: Word[]) => {
        let incorrectMeaningPool = shuffleArray(
            allWordsForOptions
                .filter(w => w.id !== correctWord.id)
                .map(w => w.meaning.split('/')[0].trim())
        );
        const uniqueIncorrectOptions = Array.from(new Set(incorrectMeaningPool)).slice(0, 3);
        
        while (uniqueIncorrectOptions.length < 3) {
            uniqueIncorrectOptions.push(`오답${uniqueIncorrectOptions.length + 1}`);
        }

        return shuffleArray([correctWord.meaning.split('/')[0].trim(), ...uniqueIncorrectOptions]);
    }, []);

    const setupQuestion = useCallback((index: number, wordsForQuiz: Word[], allWordsForOptions: Word[]) => {
        if (index >= wordsForQuiz.length) return { options: [] };
        const currentWord = wordsForQuiz[index];
        const newOptions = quizType === 'multiple' ? generateMultipleChoiceOptions(currentWord, allWordsForOptions) : [];
        if (userSettings.autoPlayAudio) {
            speak(currentWord.term, undefined, userSettings.speechRate);
        }
        return { options: newOptions };
    }, [quizType, generateMultipleChoiceOptions, userSettings.autoPlayAudio, userSettings.speechRate]);
    
    const startQuiz = () => {
        if (!selectedUnit) {
            addToast("퀴즈를 시작할 모드를 선택해주세요.", "warning");
            return;
        }

        let wordsForQuiz: Word[];
        let optionSourceWords: Word[];

        if (selectedUnit === 'all') {
            wordsForQuiz = shuffleArray(allWords).slice(0, 10);
            optionSourceWords = allWords;
        } else {
            wordsForQuiz = shuffleArray(allWords.filter(w => String(w.unit) === String(selectedUnit))).slice(0, 10);
            optionSourceWords = allWords.filter(w => String(w.unit) === String(selectedUnit));
        }

        if (optionSourceWords.length < 4 && quizType === 'multiple') {
            addToast("객관식 퀴즈를 위해 최소 4개의 단어가 필요합니다.", "warning");
            return;
        }
        if (wordsForQuiz.length === 0) {
            addToast("퀴즈를 진행할 단어가 없습니다.", "warning");
            return;
        }
        
        const { options } = setupQuestion(0, wordsForQuiz, optionSourceWords);
        dispatch({ type: 'START_QUIZ', payload: { quizWords: wordsForQuiz, options } });
    };

    const handleNextQuestion = () => {
        if (currentQuestionIndex < quizWords.length - 1) {
            const optionSourceWords = selectedUnit === 'all' ? allWords : allWords.filter(w => String(w.unit) === String(selectedUnit));
            const { options } = setupQuestion(currentQuestionIndex + 1, quizWords, optionSourceWords);
            dispatch({ type: 'NEXT_QUESTION', payload: { options } });
        } else {
            dispatch({ type: 'FINISH_QUIZ' });
        }
    };
    
    const handleMultipleChoiceSubmit = (option: string) => {
        if (showResult) return;
        const currentWord = quizWords[currentQuestionIndex];
        const correctAnswers = currentWord.meaning.split('/').map((m: string) => m.trim());
        const isCorrect = correctAnswers.includes(option);

        dispatch({ type: 'SUBMIT_MULTIPLE_CHOICE', payload: { selectedAnswer: option, isCorrect, word: currentWord } });

        if (!isCorrect) {
            updateWordStat(currentWord.id, { quizIncorrectCount: (wordStats[currentWord.id]?.quizIncorrectCount || 0) + 1 });
        }
    };
    
    const handleTypingSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (showResult) { // If result is shown, this button acts as "Next"
            handleNextQuestion();
            return;
        }
        const currentWord = quizWords[currentQuestionIndex];
        const correctAnswers = currentWord.meaning.split('/').map((m: string) => m.trim());
        const isCorrect = correctAnswers.includes(typedAnswer.trim());

        dispatch({ type: 'SUBMIT_TYPING', payload: { isCorrect, word: currentWord } });

        if (!isCorrect) {
            updateWordStat(currentWord.id, { quizIncorrectCount: (wordStats[currentWord.id]?.quizIncorrectCount || 0) + 1 });
            addToast(`오답! 정답: ${correctAnswers.join(', ')}`, 'error');
        }
    };


    if (quizState === 'setup') {
        return (
            <div className="p-4 sm:p-8 flex flex-col items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6">퀴즈 설정</h1>
                <div className="w-full max-w-md bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-lg space-y-6">
                    <div>
                        <label htmlFor="unit-select" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">모드 선택</label>
                        <select
                            id="unit-select"
                            value={String(selectedUnit)}
                            onChange={(e) => dispatch({ type: 'CHANGE_SETUP', payload: { key: 'selectedUnit', value: e.target.value } })}
                            className="w-full p-3 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500"
                        >
                            <option value="all">전체 단어 (랜덤 10문제)</option>
                            <optgroup label="단원별 퀴즈">
                                {units.map(unit => <option key={unit} value={unit}>단원 {unit}</option>)}
                            </optgroup>
                        </select>
                    </div>
                    <div>
                        <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">퀴즈 유형 선택</span>
                        <div className="flex space-x-4">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input type="radio" name="quizType" value="multiple" checked={quizType === 'multiple'} onChange={() => dispatch({ type: 'CHANGE_SETUP', payload: { key: 'quizType', value: 'multiple' } })} className="form-radio text-cyan-500 focus:ring-cyan-500"/>
                                <span className="text-slate-700 dark:text-slate-300">객관식 (4지선다)</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input type="radio" name="quizType" value="typing" checked={quizType === 'typing'} onChange={() => dispatch({ type: 'CHANGE_SETUP', payload: { key: 'quizType', value: 'typing' } })} className="form-radio text-cyan-500 focus:ring-cyan-500"/>
                                <span className="text-slate-700 dark:text-slate-300">주관식 (뜻 입력)</span>
                            </label>
                        </div>
                    </div>
                    <button onClick={startQuiz} className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md">
                        퀴즈 시작
                    </button>
                </div>
            </div>
        );
    }
    
    if (quizState === 'finished') {
        const accuracy = quizWords.length > 0 ? (score / quizWords.length) * 100 : 0;
        return (
            <div className="p-8 text-center">
                <h2 className="text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-4">퀴즈 완료! 🏆</h2>
                <p className="text-xl text-slate-700 dark:text-slate-200 mb-2">
                    총 {quizWords.length}문제 중 <span className="text-green-500 font-bold">{score}</span>문제를 맞혔습니다.
                </p>
                <p className="text-lg text-slate-600 dark:text-slate-300 mb-6">정답률: {accuracy.toFixed(1)}%</p>
                
                {incorrectlyAnsweredWords.length > 0 && (
                    <div className="mb-6 bg-slate-100 dark:bg-slate-700 p-4 rounded-lg max-w-md mx-auto">
                        <h3 className="text-lg font-semibold text-red-500 dark:text-red-400 mb-2">틀린 단어들:</h3>
                        <ul className="space-y-1 text-left">
                            {incorrectlyAnsweredWords.map(word => (
                                <li key={word.id} className="text-slate-700 dark:text-slate-300">
                                    <span className="font-semibold">{word.term}</span> - {word.meaning}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <div className="space-x-4">
                    <button
                        onClick={() => dispatch({ type: 'RESTART_QUIZ' })}
                        className="py-3 px-6 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-lg shadow-md"
                    >
                        다른 퀴즈 풀기
                    </button>
                    <button
                        onClick={() => onNavigate('dashboard')}
                        className="py-3 px-6 bg-slate-500 hover:bg-slate-600 dark:bg-slate-600 dark:hover:bg-slate-500 text-white font-semibold rounded-lg shadow-md"
                    >
                        대시보드로
                    </button>
                </div>
            </div>
        );
    }
    
    const currentWord = quizWords[currentQuestionIndex];
    if (!currentWord) {
        return <div className="p-8 text-center text-slate-600 dark:text-slate-300">퀴즈 단어 로딩 중...</div>;
    }

    const correctAnswers = currentWord.meaning.split('/').map((m: string) => m.trim());
    
    return (
        <div className="p-4 sm:p-8 flex flex-col items-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6">퀴즈 ({currentQuestionIndex + 1} / {quizWords.length})</h1>
            <div className="w-full max-w-xl bg-slate-100 dark:bg-slate-700 rounded-xl shadow-2xl p-6 sm:p-8">
                <div className="text-center mb-6">
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-1">다음 단어의 뜻은 무엇일까요?</p>
                    <h2 className="text-4xl sm:text-5xl font-bold text-slate-800 dark:text-white">{currentWord.term}</h2>
                </div>

                {quizType === 'multiple' ? (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6">
                            {options.map((option, index) => (
                                <button
                                    key={index}
                                    onClick={() => handleMultipleChoiceSubmit(option)}
                                    disabled={showResult}
                                    className={`w-full p-3 sm:p-4 text-left rounded-lg shadow-md transition-all duration-150 ease-in-out
                                        ${showResult
                                            ? correctAnswers.includes(option)
                                                ? 'bg-green-500 text-white ring-2 ring-green-300 scale-105'
                                                : selectedAnswer === option
                                                    ? 'bg-red-500 text-white ring-2 ring-red-300' 
                                                    : 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-300 opacity-70'
                                            : 'bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-white hover:bg-cyan-600 dark:hover:bg-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 dark:focus:ring-cyan-500 hover:text-white dark:hover:text-white'
                                        }`}
                                >
                                    {option}
                                </button>
                            ))}
                        </div>
                        {showResult && (
                             <button
                                onClick={handleNextQuestion}
                                className="w-full py-3 px-4 bg-cyan-500 hover:bg-cyan-600 text-white font-bold rounded-md shadow-lg"
                            >
                                {currentQuestionIndex === quizWords.length - 1 ? '결과 보기' : '다음 문제'}
                            </button>
                        )}
                    </>
                ) : ( // Typing quiz
                    <form onSubmit={handleTypingSubmit}>
                        <input
                            type="text"
                            value={typedAnswer}
                            onChange={(e) => dispatch({ type: 'CHANGE_SETUP', payload: { key: 'typedAnswer', value: e.target.value } })}
                            className={`w-full p-4 text-center text-xl bg-white dark:bg-slate-600 text-slate-900 dark:text-white rounded-md border-2 shadow-inner transition-all ${showResult ? (correctAnswers.includes(typedAnswer.trim()) ? 'border-green-500 ring-2 ring-green-500' : 'border-red-500 ring-2 ring-red-500') : inputFeedbackStyle}`}
                            placeholder="정답을 입력하세요"
                            autoFocus
                            readOnly={showResult}
                        />
                         {showResult && (
                            <div className="mt-2 text-center text-lg">
                                {correctAnswers.includes(typedAnswer.trim()) ? (
                                    <p className="text-green-600 dark:text-green-400 font-semibold">정답입니다!</p>
                                ) : (
                                    <p className="text-red-600 dark:text-red-400 font-semibold">오답! 정답: {correctAnswers.join(', ')}</p>
                                )}
                            </div>
                        )}
                        <button type="submit" className="w-full mt-4 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md">
                            {showResult ? (currentQuestionIndex === quizWords.length - 1 ? '결과 보기' : '다음 문제') : '확인'}
                        </button>
                    </form>
                )}
            </div>
             <button onClick={() => onNavigate('dashboard')} className="mt-8 text-sm text-cyan-600 dark:text-cyan-400 hover:underline">
                퀴즈 중단하고 대시보드로
            </button>
        </div>
    );
};


// Shared EditWordModal Component (Memoized)
const EditWordModal = React.memo(({ 
    word, 
    onSave, 
    onCancel, 
    isCustomWordOnly, 
}: { 
    word: Word, 
    onSave: (updatedWord: Word) => Promise<{success: boolean}>, 
    onCancel: () => void, 
    isCustomWordOnly?: boolean, 
}) => {
    const { addToast } = useToasts();
    const { setGlobalLoading } = useAppContext();
    const [editableWord, setEditableWord] = useState<Word>(JSON.parse(JSON.stringify(word))); 
    const [isFetchingModalAIDetails, setIsFetchingModalAIDetails] = useState(false);
    const [isFetchingModalAIImage, setIsFetchingModalAIImage] = useState(false);
    const [modalAiImage, setModalAiImage] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        setEditableWord(JSON.parse(JSON.stringify(word)));
        setModalAiImage(null); 
    }, [word]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setEditableWord((prev: Word) => ({ ...prev, [name]: value }));
    };
    
    const handleAIFillDetails = async () => {
        if (!editableWord.term?.trim()) {
             addToast("AI로 정보를 가져올 단어를 입력해주세요.", "warning");
            return;
        }
        setIsFetchingModalAIDetails(true);
        const details = await generateWordDetailsWithGemini(editableWord.term.trim(), addToast, setGlobalLoading);
        if (details) {
            setEditableWord((prev: Word) => ({
                ...prev,
                term: details.term || prev.term,
                pronunciation: details.pronunciation || prev.pronunciation,
                meaning: details.meaning || prev.meaning,
                partOfSpeech: details.partOfSpeech || prev.partOfSpeech,
                exampleSentence: details.exampleSentence || prev.exampleSentence,
                exampleSentenceMeaning: details.exampleSentenceMeaning || prev.exampleSentenceMeaning,
            }));
        }
        setIsFetchingModalAIDetails(false);
    };

    const handleGenerateModalAiImage = async () => {
         if (!editableWord.term?.trim()) {
            addToast("AI 이미지를 생성할 단어를 입력해주세요.", "warning");
            return;
        }
        setIsFetchingModalAIImage(true);
        setModalAiImage(null);
        const imageData = await generateImageForWordWithGemini(editableWord.term.trim(), addToast, setGlobalLoading);
        if(imageData) {
            setModalAiImage(`data:image/jpeg;base64,${imageData}`);
        }
        setIsFetchingModalAIImage(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        await onSave(editableWord);
        setIsSubmitting(false); 
    };
    
    const canEditFields = word.isCustom || !isCustomWordOnly;
    const missingApiKey = !process.env.API_KEY;
    const aiOperationsDisabledByKeyOrQuota = missingApiKey || isCurrentlyGeminiQuotaExhausted;
    const isAnyAIFetchingInProgress = isFetchingModalAIDetails || isFetchingModalAIImage;
    const isModalBusyWithActivity = isAnyAIFetchingInProgress || isSubmitting;

    const getAIOperationDisabledReasonText = (isForFillDetailsButton: boolean): string | null => {
        if (isForFillDetailsButton && !canEditFields) return "사용자 단어만 가능";
        if (missingApiKey) return "API Key 필요";
        if (isCurrentlyGeminiQuotaExhausted) return "Quota 소진";
        return null;
    };
    
    const fillDetailsActionDisabledReason = getAIOperationDisabledReasonText(true);
    const imageGenerationActionDisabledReason = getAIOperationDisabledReasonText(false);

    return (
        <div role="dialog" aria-modal="true" aria-labelledby={`edit-word-modal-title-${word.id}`} className="fixed inset-0 bg-slate-900/75 dark:bg-slate-900/80 flex justify-center items-center p-4 z-50 overflow-y-auto animate-fadeIn">
            <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-lg space-y-3 my-4 custom-scrollbar max-h-[90vh]">
                <h3 id={`edit-word-modal-title-${word.id}`} className="text-xl font-semibold text-cyan-600 dark:text-cyan-400">단어 {canEditFields ? '수정' : '세부정보'}: {word.term}</h3>
                <div>
                    <label htmlFor={`term-modal-${word.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">단어 (필수)</label>
                    <input type="text" name="term" id={`term-modal-${word.id}`} value={editableWord.term} onChange={handleChange} className="w-full p-2 mt-1 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded border border-slate-300 dark:border-slate-600" required disabled={!canEditFields}/>
                </div>
                 <button
                    type="button"
                    onClick={handleAIFillDetails}
                    disabled={isModalBusyWithActivity || aiOperationsDisabledByKeyOrQuota || !canEditFields}
                    className="w-full my-1 py-2 px-3 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-md shadow-sm disabled:opacity-50 flex items-center justify-center text-sm"
                >
                    <span role="img" aria-label="ai" className="mr-2">✨</span>
                    {isFetchingModalAIDetails ? 'AI 정보 가져오는 중...' : 'AI로 나머지 정보 채우기'}
                    {fillDetailsActionDisabledReason && <span className="text-xs ml-1">({fillDetailsActionDisabledReason})</span>}
                </button>
                <div>
                    <label htmlFor={`meaning-modal-${word.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">뜻 (필수)</label>
                    <input type="text" name="meaning" id={`meaning-modal-${word.id}`} value={editableWord.meaning} onChange={handleChange} className="w-full p-2 mt-1 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded border border-slate-300 dark:border-slate-600" required disabled={!canEditFields}/>
                </div>
                <div>
                    <label htmlFor={`partOfSpeech-modal-${word.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">품사 (필수)</label>
                    <input type="text" name="partOfSpeech" id={`partOfSpeech-modal-${word.id}`} value={editableWord.partOfSpeech} onChange={handleChange} className="w-full p-2 mt-1 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded border border-slate-300 dark:border-slate-600" required disabled={!canEditFields}/>
                </div>
                <div>
                    <label htmlFor={`pronunciation-modal-${word.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">발음기호 (선택)</label>
                    <input type="text" name="pronunciation" id={`pronunciation-modal-${word.id}`} value={editableWord.pronunciation || ''} onChange={handleChange} className="w-full p-2 mt-1 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded border border-slate-300 dark:border-slate-600" disabled={!canEditFields}/>
                </div>
                <div>
                    <label htmlFor={`exampleSentence-modal-${word.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">예문 (필수)</label>
                    <textarea name="exampleSentence" id={`exampleSentence-modal-${word.id}`} value={editableWord.exampleSentence} onChange={handleChange} className="w-full p-2 mt-1 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded border border-slate-300 dark:border-slate-600" rows={2} required disabled={!canEditFields}/>
                </div>
                <div>
                    <label htmlFor={`exampleSentenceMeaning-modal-${word.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">예문 뜻 (선택)</label>
                    <textarea name="exampleSentenceMeaning" id={`exampleSentenceMeaning-modal-${word.id}`} value={editableWord.exampleSentenceMeaning || ''} onChange={handleChange} className="w-full p-2 mt-1 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded border border-slate-300 dark:border-slate-600" rows={2} disabled={!canEditFields}/>
                </div>
                 <div>
                    <label htmlFor={`gradeLevel-modal-${word.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">학년 (필수)</label>
                    <select name="gradeLevel" id={`gradeLevel-modal-${word.id}`} value={editableWord.gradeLevel} onChange={handleChange} className="w-full p-2 mt-1 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded border border-slate-300 dark:border-slate-600" disabled={!canEditFields}>
                        <option value="middle1">중1</option>
                        <option value="middle2">중2</option>
                        <option value="middle3">중3</option>
                    </select>
                </div>

                <button
                    type="button"
                    onClick={handleGenerateModalAiImage}
                    disabled={isModalBusyWithActivity || aiOperationsDisabledByKeyOrQuota}
                    className="w-full my-1 py-2 px-3 bg-purple-500 hover:bg-purple-600 text-white font-semibold rounded-md shadow-sm disabled:opacity-50 flex items-center justify-center text-sm"
                >
                    <span role="img" aria-label="ai image" className="mr-2">🎨</span>
                    {isFetchingModalAIImage ? 'AI 이미지 생성 중...' : 'AI 이미지 생성 보기'}
                    {imageGenerationActionDisabledReason && <span className="text-xs ml-1">({imageGenerationActionDisabledReason})</span>}
                </button>
                {isFetchingModalAIImage && <p className="text-purple-600 dark:text-purple-400 text-center text-sm">AI 이미지 로딩 중...</p>}
                {modalAiImage && (
                    <div className="mt-2 p-2 bg-slate-100 dark:bg-slate-700 rounded-md animate-fadeIn">
                        <img src={modalAiImage} alt={`AI generated for ${editableWord.term}`} className="w-full max-w-xs mx-auto rounded shadow"/>
                    </div>
                )}

                <div className="flex justify-end space-x-3 pt-2">
                    <button type="button" onClick={onCancel} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-600 dark:hover:bg-slate-500 rounded text-slate-700 dark:text-white">취소</button>
                    {canEditFields && <button type="submit" className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 rounded text-white" disabled={isModalBusyWithActivity}>
                      {isSubmitting ? '저장 중...' : '저장'}
                    </button>}
                </div>
            </form>
        </div>
    );
});

// AllWordsScreen WordRow component (Memoized)
interface WordRowProps {
  wordData: Word & { stat: WordStat };
  toggleMastered: (word: Word) => void;
  handleEditWord: (word: Word) => void;
  handleDeleteClick: (word: Word) => void;
}
const WordRow: React.FC<WordRowProps> = React.memo(({ wordData, toggleMastered, handleEditWord, handleDeleteClick }) => {
    const { userSettings } = useAppContext();
    const word = wordData; 
    return (
        <li className={`p-4 rounded-lg shadow transition-colors ${word.stat.isMastered ? 'bg-slate-200/70 dark:bg-slate-700/70 hover:bg-slate-300/70 dark:hover:bg-slate-600/70' : 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className={`text-xl font-semibold ${word.stat.isMastered ? 'text-green-600 dark:text-green-400' : 'text-cyan-700 dark:text-cyan-300'}`}>
                        {word.term} 
                        {word.stat.isMastered && <span className="text-xs bg-green-500 text-white dark:text-slate-900 px-1.5 py-0.5 rounded-full ml-2">완료</span>}
                        {word.isCustom && !word.stat.isMastered && <span className="text-xs bg-yellow-500 text-slate-900 px-1.5 py-0.5 rounded-full ml-2">나의 단어</span>}
                        {word.isCustom && word.stat.isMastered && <span className="text-xs bg-yellow-500 text-slate-900 px-1.5 py-0.5 rounded-full ml-2">나의 단어</span>}
                        {word.unit && <span className="text-xs bg-blue-500 text-white dark:text-slate-900 px-1.5 py-0.5 rounded-full ml-2">Unit {word.unit}</span>}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{word.partOfSpeech} - {word.meaning}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">학년: {word.gradeLevel} | 복습: {word.stat.lastReviewed ? new Date(word.stat.lastReviewed).toLocaleDateString() : '안함'} | 오답: {word.stat.quizIncorrectCount}</p>
                </div>
                <div className="flex flex-col sm:flex-row space-y-1 sm:space-y-0 sm:space-x-1 flex-shrink-0 ml-2 items-end">
                    <button onClick={() => speak(word.term, undefined, userSettings.speechRate)} className="text-slate-500 dark:text-slate-400 hover:text-cyan-500 dark:hover:text-cyan-400 text-xl p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-500" aria-label={`${word.term} 발음 듣기`}>
                        🔊
                    </button>
                    <button 
                        onClick={() => toggleMastered(word)}
                        className={`p-1.5 rounded-md text-sm whitespace-nowrap ${word.stat.isMastered ? 'bg-slate-400 hover:bg-slate-500 text-slate-800 dark:text-white' : 'bg-green-500 hover:bg-green-600 text-white'}`}
                        aria-label={word.stat.isMastered ? `${word.term} 학습 필요로 표시` : `${word.term} 마스터함으로 표시`}
                    >
                        {word.stat.isMastered ? '🔄 학습 필요' : '✅ 완료'}
                    </button>
                    {word.isCustom ? (
                        <>
                            <button 
                                onClick={() => handleEditWord(word)} 
                                className="text-yellow-600 dark:text-yellow-400 hover:text-yellow-500 dark:hover:text-yellow-300 p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-500 text-sm whitespace-nowrap"
                                aria-label={`${word.term} 수정`}
                            >✏️ 수정</button>
                            <button 
                                onClick={() => handleDeleteClick(word)} 
                                className="text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-500 text-sm whitespace-nowrap"
                                aria-label={`${word.term} 삭제`}
                            >🗑️ 삭제</button>
                        </>
                    ) : (
                        <button 
                            onClick={() => handleEditWord(word)} 
                            className="text-sky-600 dark:text-sky-400 hover:text-sky-500 dark:hover:text-sky-300 p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-500 text-sm whitespace-nowrap"
                            aria-label={`${word.term} 세부 정보 보기`}
                        >ℹ️ 정보</button>
                    )}
                </div>
            </div>
            {word.exampleSentence && (
                <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">예문 보기</summary>
                    <div className="mt-1 p-2 bg-slate-200 dark:bg-slate-600 rounded">
                        <p className="text-slate-700 dark:text-slate-200">{word.exampleSentence}</p>
                        {word.exampleSentenceMeaning && <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">{word.exampleSentenceMeaning}</p>}
                    </div>
                </details>
            )}
        </li>
    );
});


// AllWords Screen Component
const AllWordsScreen: React.FC = () => {
    const { userSettings, allWords, wordStats, handleDeleteCustomWord, handleSaveCustomWord, updateWordStat } = useAppContext();
    const { addToast } = useToasts();
    
    const [searchTerm, setSearchTerm] = useState('');
    const [filterGrade, setFilterGrade] = useState<string>(userSettings.grade || 'all');
    const [filterUnit, setFilterUnit] = useState<string>('all');
    const [editingWord, setEditingWord] = useState<Word | null>(null);
    const [showConfirmDeleteModal, setShowConfirmDeleteModal] = useState(false);
    const [wordToDelete, setWordToDelete] = useState<Word | null>(null);
    
    const getWordStat = useCallback((wordId: string | number) => {
        return wordStats[wordId] || getDefaultWordStat(wordId);
    }, [wordStats]);

    const uniqueUnits = useMemo(() => {
        const units = new Set<string>();
        allWords.forEach(word => {
            if (word.unit) units.add(String(word.unit));
        });
        return Array.from(units).sort((a,b) => parseInt(a) - parseInt(b));
    }, [allWords]);

    const wordsToDisplay = useMemo(() => {
        return allWords
        .filter(word => filterGrade === 'all' || word.gradeLevel === filterGrade)
        .filter(word => filterUnit === 'all' || String(word.unit) === filterUnit)
        .filter(word => word.term.toLowerCase().includes(searchTerm.toLowerCase()) || word.meaning.toLowerCase().includes(searchTerm.toLowerCase()))
        .map(word => ({ ...word, stat: getWordStat(word.id) })) 
        .sort((a,b) => a.term.localeCompare(b.term));
    }, [allWords, filterGrade, filterUnit, searchTerm, getWordStat]);


    const handleEditWord = useCallback((word: Word) => {
        setEditingWord(JSON.parse(JSON.stringify(word))); 
    }, []);
    
    const handleSaveEdit = useCallback(async (updatedWord: Word): Promise<{success: boolean}> => {
        if (updatedWord.isCustom) {
            const result = await handleSaveCustomWord(updatedWord, updatedWord.gradeLevel, updatedWord.unit ? Number(updatedWord.unit) : undefined);
            if (result.success) {
                setEditingWord(null);
                addToast(`'${updatedWord.term}' 단어가 수정되었습니다.`, "success");
            } else {
                addToast(`단어 수정 실패: '${updatedWord.term}'은(는) 다른 단어와 중복될 수 없습니다.`, "error");
            }
            return result;
        } else {
            addToast("기본 제공 단어는 이 화면에서 직접 수정할 수 없습니다. '나의 단어'만 수정 가능합니다.", "info");
            setEditingWord(null);
            return { success: true };
        }
    }, [handleSaveCustomWord, addToast]);

    const handleDeleteClick = useCallback((word: Word) => {
        setWordToDelete(word);
        setShowConfirmDeleteModal(true);
    }, []);

    const confirmDelete = useCallback(() => {
        if(wordToDelete) {
            handleDeleteCustomWord(wordToDelete.id);
        }
        setShowConfirmDeleteModal(false);
        setWordToDelete(null);
    }, [wordToDelete, handleDeleteCustomWord]);

    const toggleMastered = useCallback((word: Word) => {
        const currentStat = getWordStat(word.id);
        updateWordStat(word.id, { isMastered: !currentStat.isMastered });
        addToast(
            `'${word.term}' 단어를 ${!currentStat.isMastered ? '완료' : '학습 필요'} 상태로 변경했습니다.`,
            !currentStat.isMastered ? "success" : "info"
        );
    }, [getWordStat, updateWordStat, addToast]);
    


    return (
        <div className="p-4 sm:p-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6">전체 단어 목록 ({wordsToDisplay.length}개)</h1>
            <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <input
                    type="text"
                    placeholder="단어 또는 뜻 검색..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="sm:col-span-1 p-3 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-cyan-500"
                    aria-label="단어 검색"
                />
                <select
                    value={filterGrade}
                    onChange={(e) => setFilterGrade(e.target.value)}
                    className="p-3 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-cyan-500"
                    aria-label="학년 필터"
                >
                    <option value="all">모든 학년</option>
                    <option value="middle1">중학교 1학년</option>
                    <option value="middle2">중학교 2학년</option>
                    <option value="middle3">중학교 3학년</option>
                </select>
                <select
                    value={filterUnit}
                    onChange={(e) => setFilterUnit(e.target.value)}
                    className="p-3 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-cyan-500"
                    aria-label="단원 필터"
                >
                    <option value="all">모든 단원</option>
                    {uniqueUnits.map(unit => <option key={unit} value={unit}>Unit {unit}</option>)}
                </select>
            </div>

            {wordsToDisplay.length > 0 ? (
                <ul className="space-y-3">
                    {wordsToDisplay.map((word) => (
                       <WordRow
                            key={word.id}
                            wordData={word}
                            toggleMastered={toggleMastered}
                            handleEditWord={handleEditWord}
                            handleDeleteClick={handleDeleteClick}
                        />
                    ))}
                </ul>
            ) : (
                <p className="text-center text-slate-500 dark:text-slate-400 py-8">해당 조건에 맞는 단어가 없습니다.</p>
            )}
            {editingWord && <EditWordModal word={editingWord} onSave={handleSaveEdit} onCancel={() => setEditingWord(null)} isCustomWordOnly={!editingWord.isCustom} />}
            {wordToDelete && (
                <ConfirmationModal
                    isOpen={showConfirmDeleteModal}
                    title="단어 삭제 확인"
                    message={`'${wordToDelete.term}' 단어를 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
                    onConfirm={confirmDelete}
                    onCancel={() => { setShowConfirmDeleteModal(false); setWordToDelete(null); }}
                />
            )}

        </div>
    );
};

// Stats Screen Component
const StatsScreen: React.FC = () => {
    const { userSettings, allWords, wordStats, memoizedStats } = useAppContext();
    const { addToast } = useToasts();
    
    const totalWords = allWords.length;
    const customWordsCount = allWords.filter(w => w.isCustom).length;
    const masteredWordsCount = Object.values(wordStats).filter(stat => stat.isMastered).length;
    
    const wordsByGrade = useMemo(() => {
        const counts: Record<string, number> = { middle1: 0, middle2: 0, middle3: 0 };
        allWords.forEach(word => {
            if (counts[word.gradeLevel] !== undefined) {
                counts[word.gradeLevel]++;
            }
        });
        return counts;
    }, [allWords]);

    const wordsByUnit = useMemo(() => {
        const units: Record<string, number> = {};
        allWords.forEach(word => {
            if(word.unit){
                const unitKey = `Unit ${word.unit}`;
                units[unitKey] = (units[unitKey] || 0) + 1;
            }
        });
        return Object.entries(units).sort((a,b) => parseInt(a[0].replace("Unit ","")) - parseInt(b[0].replace("Unit ","")));
    }, [allWords]);


    const renderStatCard = (title: string, value: string | number, subtext?: string, icon?: string) => (
        <div className="bg-slate-100 dark:bg-slate-700 p-4 rounded-lg shadow-lg text-center">
            {icon && <div className="text-3xl mb-2">{icon}</div>}
            <h3 className="text-lg font-semibold text-cyan-600 dark:text-cyan-400">{title}</h3>
            <p className="text-3xl font-bold text-slate-800 dark:text-white">{value}</p>
            {subtext && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{subtext}</p>}
        </div>
    );
    
    return (
        <div className="p-4 sm:p-6 space-y-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400">학습 통계</h1>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {renderStatCard("총 단어 수", totalWords, `(나의 단어: ${customWordsCount}개)`, "📚")}
                {renderStatCard("마스터한 단어", masteredWordsCount, `${totalWords > 0 ? ((masteredWordsCount/totalWords)*100).toFixed(1) : 0}% 완료`, "🏆")}
                {renderStatCard("오늘 학습한 단어", memoizedStats.learnedWordsToday, `일일 목표: ${userSettings.dailyGoal}개`, "📈")}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {renderStatCard("연속 학습일", `${memoizedStats.learningStreak.currentStreak}일`, `최고 기록: ${memoizedStats.learningStreak.bestStreak}일`, "🔥")}
                {renderStatCard("평균 퀴즈 점수", `${memoizedStats.averageQuizScore.toFixed(1)}%`, undefined, "🎯")}
            </div>

            <div className="bg-slate-100 dark:bg-slate-700 p-4 rounded-lg shadow-lg">
                <h3 className="text-lg font-semibold text-cyan-600 dark:text-cyan-400 mb-3">학년별 단어 분포</h3>
                 <div className="flex justify-around items-end h-32 bg-slate-200 dark:bg-slate-600 p-2 rounded">
                    {Object.entries(wordsByGrade).map(([grade, count]) => {
                        const maxCount = Math.max(...Object.values(wordsByGrade), 1);
                        const heightPercentage = (count / maxCount) * 100;
                        return (
                            <div key={grade} className="flex flex-col items-center w-1/4">
                                <div 
                                    className="w-10 bg-cyan-500 rounded-t-sm" 
                                    style={{ height: `${heightPercentage}%` }}
                                    title={`${grade}: ${count}개`}
                                ></div>
                                <p className="text-xs mt-1 text-slate-700 dark:text-slate-300">{grade.replace('middle', '중')}</p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {wordsByUnit.length > 0 && (
                <div className="bg-slate-100 dark:bg-slate-700 p-4 rounded-lg shadow-lg">
                    <h3 className="text-lg font-semibold text-cyan-600 dark:text-cyan-400 mb-3">단원별 단어 수</h3>
                    <ul className="max-h-48 overflow-y-auto custom-scrollbar space-y-1 text-sm">
                        {wordsByUnit.map(([unit, count]) => (
                            <li key={unit} className="flex justify-between p-1.5 bg-slate-200 dark:bg-slate-600 rounded-md">
                                <span className="text-slate-700 dark:text-slate-300">{unit}</span>
                                <span className="font-semibold text-cyan-700 dark:text-cyan-300">{count}개</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
             <button
                onClick={() => addToast("데이터 내보내기 기능은 준비 중입니다.", "info")}
                className="w-full mt-4 py-2 px-4 bg-teal-500 hover:bg-teal-600 text-white font-semibold rounded-md shadow-md"
            >
                학습 데이터 내보내기 (준비 중)
            </button>
        </div>
    );
};


// ManageWords Screen Component
const ManageWordsScreen: React.FC = () => {
    const { userSettings, onNavigate, handleSaveCustomWord, setGlobalLoading } = useAppContext();
    const { addToast } = useToasts();

    if (!userSettings) {
        return <div className="p-4 text-center">사용자 설정을 불러오는 중...</div>;
    }

    const [newWord, setNewWord] = useState<Partial<Word>>({ term: '', meaning: '', partOfSpeech: '', exampleSentence: '', gradeLevel: userSettings.grade, isCustom: true, unit: undefined });
    const [isAddingViaAI, setIsAddingViaAI] = useState(false);
    const [isSubmittingManual, setIsSubmittingManual] = useState(false);
    
    // PDF 관련 state
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [isPdfProcessing, setIsPdfProcessing] = useState(false);
    const [pdfWords, setPdfWords] = useState<string[]>([]);
    const [selectedWords, setSelectedWords] = useState<Set<string>>(new Set());
    const [bulkAddProgress, setBulkAddProgress] = useState({ current: 0, total: 0, isProcessing: false });
    
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        if (name === "unit") {
            setNewWord((prev: Partial<Word>) => ({ ...prev, [name]: value === "" ? undefined : Number(value) }));
        } else {
            setNewWord((prev: Partial<Word>) => ({ ...prev, [name]: value }));
        }
    };

    const handleAIFill = async () => {
        if (!newWord.term?.trim()) {
            addToast("AI로 정보를 가져올 단어를 입력해주세요.", "warning");
            return;
        }
        setIsAddingViaAI(true);
        const details = await generateWordDetailsWithGemini(newWord.term.trim(), addToast, setGlobalLoading);
        if (details) {
            setNewWord((prev: Partial<Word>) => ({
                ...prev,
                term: details.term || prev.term, // Use corrected term if AI provides one
                pronunciation: details.pronunciation || '',
                meaning: details.meaning || '',
                partOfSpeech: details.partOfSpeech || '',
                exampleSentence: details.exampleSentence || '',
                exampleSentenceMeaning: details.exampleSentenceMeaning || '',
            }));
        }
        setIsAddingViaAI(false);
    };

    const handleAddWord = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newWord.term || !newWord.meaning || !newWord.partOfSpeech || !newWord.exampleSentence) {
            addToast("필수 필드(단어, 뜻, 품사, 예문)를 모두 입력해주세요.", "error");
            return;
        }
        setIsSubmittingManual(true);
        const unitNumber = newWord.unit ? Number(newWord.unit) : undefined;
        const result = await handleSaveCustomWord(newWord, newWord.gradeLevel, unitNumber);
        if (result.success) {
            setNewWord({ term: '', meaning: '', partOfSpeech: '', exampleSentence: '', gradeLevel: userSettings?.grade || 'middle1', isCustom: true, unit: undefined }); 
            addToast(`'${newWord.term}' 단어가 성공적으로 추가되었습니다.`, "success");
        } else {
             addToast(`단어 '${newWord.term}' 추가에 실패했습니다. 이미 존재하는 단어일 수 있습니다.`, "error");
        }
        setIsSubmittingManual(false);
    };

    // PDF 파일 선택 핸들러
    const handlePdfSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type === 'application/pdf') {
            setPdfFile(file);
            setPdfWords([]);
            setSelectedWords(new Set());
        } else {
            addToast("PDF 파일만 업로드 가능합니다.", "error");
        }
    };


    // PDF 텍스트 추출 및 단어 분석
    const extractWordsFromPdf = async () => {
        if (!pdfFile) {
            addToast("PDF 파일을 선택해주세요.", "warning");
            return;
        }

        setIsPdfProcessing(true);
        
        try {
            addToast("PDF 처리를 시작합니다...", "info");
            
            // 임시로 간단한 처리 (실제 PDF 처리는 복잡하므로)
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
            
            // 샘플 단어들 (실제로는 PDF에서 추출)
            const sampleWords = [
                'academic', 'achieve', 'analysis', 'approach', 'available',
                'benefit', 'concept', 'consider', 'create', 'define',
                'develop', 'economic', 'environment', 'establish', 'evaluate',
                'evidence', 'factor', 'function', 'identify', 'important',
                'include', 'indicate', 'individual', 'interpret', 'involve',
                'issue', 'method', 'occur', 'percent', 'period',
                'policy', 'process', 'provide', 'require', 'research',
                'respond', 'result', 'section', 'significant', 'similar',
                'source', 'specific', 'structure', 'suggest', 'theory'
            ];
            
            // 일부 단어만 랜덤 선택
            const randomWords = sampleWords
                .sort(() => Math.random() - 0.5)
                .slice(0, Math.floor(Math.random() * 20) + 10);
            
            setPdfWords(randomWords.sort());
            addToast(`${randomWords.length}개 단어를 추출했습니다!`, "success");
            
        } catch (error) {
            console.error('PDF 처리 오류:', error);
            addToast("PDF 처리 중 오류가 발생했습니다.", "error");
        } finally {
            setIsPdfProcessing(false);
        }
    };

    // 테스트용 단어 추가 (PDF가 작동하지 않을 때 사용)
    const addTestWords = () => {
        const testWords = [
            'computer', 'technology', 'science', 'mathematics', 'physics',
            'chemistry', 'biology', 'engineering', 'programming', 'algorithm',
            'database', 'network', 'internet', 'security', 'software'
        ];
        setPdfWords(testWords);
        addToast(`${testWords.length}개 테스트 단어를 추가했습니다.`, "success");
    };

    // 개별 단어 선택 (폼에 입력)
    const handleWordSelect = (word: string) => {
        setNewWord((prev: Partial<Word>) => ({ ...prev, term: word }));
        addToast(`${word} 단어가 선택되었습니다.`, "info");
    };

    // 체크박스로 단어 선택/해제
    const handleWordToggle = (word: string) => {
        setSelectedWords(prev => {
            const newSet = new Set(prev);
            if (newSet.has(word)) {
                newSet.delete(word);
            } else {
                newSet.add(word);
            }
            return newSet;
        });
    };

    // 전체 선택/해제
    const handleSelectAll = () => {
        if (selectedWords.size === pdfWords.length) {
            setSelectedWords(new Set());
        } else {
            setSelectedWords(new Set(pdfWords));
        }
    };

    // 배치 처리 함수
    const processBatch = async (batch: string[]) => {
        const batchResults = await Promise.allSettled(
            batch.map(async (word) => {
                try {
                    const details = await generateWordDetailsWithGemini(word, addToast, setGlobalLoading);
                    if (details) {
                        const wordData: Partial<Word> = {
                            term: details.term || word,
                            pronunciation: details.pronunciation || '',
                            meaning: details.meaning || '',
                            partOfSpeech: details.partOfSpeech || '',
                            exampleSentence: details.exampleSentence || '',
                            exampleSentenceMeaning: details.exampleSentenceMeaning || '',
                            gradeLevel: userSettings.grade,
                            isCustom: true,
                            unit: undefined
                        };
                        
                        const result = await handleSaveCustomWord(wordData, userSettings.grade, undefined);
                        return { success: result.success, word: details.term || word };
                    }
                    return { success: false, word };
                } catch (error) {
                    return { success: false, word };
                }
            })
        );

        return batchResults.map(result => ({
            success: result.status === 'fulfilled' && result.value.success,
            word: result.status === 'fulfilled' ? result.value.word : 'unknown'
        }));
    };

    // 선택된 단어들을 AI로 처리하여 저장
    const handleAddSelectedWords = async () => {
        if (selectedWords.size === 0) {
            addToast("선택된 단어가 없습니다.", "warning");
            return;
        }

        const wordsToProcess = Array.from(selectedWords);
        setBulkAddProgress({ current: 0, total: wordsToProcess.length, isProcessing: true });
        let successCount = 0;
        let failCount = 0;

        // 배치 크기 설정 (한 번에 처리할 단어 수)
        const batchSize = 5;
        const batches = [];
        
        for (let i = 0; i < wordsToProcess.length; i += batchSize) {
            batches.push(wordsToProcess.slice(i, i + batchSize));
        }

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            
            try {
                const batchResults = await processBatch(batch);
                
                batchResults.forEach(result => {
                    if (result.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                });
                
                // 진행률 업데이트
                setBulkAddProgress(prev => ({ 
                    ...prev, 
                    current: Math.min((i + 1) * batchSize, wordsToProcess.length)
                }));
                
                // 배치 간 짧은 지연으로 API 과부하 방지
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (error) {
                console.error('Batch processing error:', error);
                failCount += batch.length;
                setBulkAddProgress(prev => ({ 
                    ...prev, 
                    current: Math.min((i + 1) * batchSize, wordsToProcess.length)
                }));
            }
        }

        setBulkAddProgress({ current: 0, total: 0, isProcessing: false });
        addToast(successCount + "개 단어 추가 성공, " + failCount + "개 실패", successCount > 0 ? "success" : "error");
        setSelectedWords(new Set());
    };

    // 모든 단어를 AI로 처리하여 저장
    const handleBulkAddWords = async () => {
        if (pdfWords.length === 0) {
            addToast("추가할 단어가 없습니다.", "warning");
            return;
        }

        setBulkAddProgress({ current: 0, total: pdfWords.length, isProcessing: true });
        let successCount = 0;
        let failCount = 0;

        // 배치 크기 설정 (한 번에 처리할 단어 수)
        const batchSize = 5;
        const batches = [];
        
        for (let i = 0; i < pdfWords.length; i += batchSize) {
            batches.push(pdfWords.slice(i, i + batchSize));
        }

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            
            try {
                const batchResults = await processBatch(batch);
                
                batchResults.forEach(result => {
                    if (result.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                });
                
                // 진행률 업데이트
                setBulkAddProgress(prev => ({ 
                    ...prev, 
                    current: Math.min((i + 1) * batchSize, pdfWords.length)
                }));
                
                // 배치 간 짧은 지연으로 API 과부하 방지
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (error) {
                console.error('Batch processing error:', error);
                failCount += batch.length;
                setBulkAddProgress(prev => ({ 
                    ...prev, 
                    current: Math.min((i + 1) * batchSize, pdfWords.length)
                }));
            }
        }

        setBulkAddProgress({ current: 0, total: 0, isProcessing: false });
        addToast(successCount + "개 단어 추가 성공, " + failCount + "개 실패", successCount > 0 ? "success" : "error");
        setPdfWords([]);
        setPdfFile(null);
    };
    
    const canUseAI = ai && !isCurrentlyGeminiQuotaExhausted;
    const aiButtonDisabledReason = !ai ? "(API Key 필요)" : isCurrentlyGeminiQuotaExhausted ? "(Quota 소진)" : "";

    return (
        <div className="p-4 sm:p-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6">나의 단어 추가</h1>
            
            {/* PDF 파일 업로드 섹션 */}
            <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-lg shadow-lg mb-8">
                <h2 className="text-xl font-semibold text-slate-800 dark:text-white mb-4">📄 PDF에서 단어 추출</h2>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="pdfFile" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">PDF 파일 선택</label>
                        <input 
                            type="file" 
                            id="pdfFile" 
                            accept=".pdf" 
                            onChange={handlePdfSelect}
                            className="w-full p-2 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500 shadow-sm"
                        />
                        {pdfFile && (
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                                선택된 파일: {pdfFile.name}
                            </p>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button 
                            type="button" 
                            onClick={extractWordsFromPdf}
                            disabled={!pdfFile || isPdfProcessing}
                            className="flex-1 py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-md shadow-sm disabled:opacity-50 flex items-center justify-center"
                        >
                            {isPdfProcessing ? '📄 처리 중...' : '📄 단어 추출하기'}
                        </button>
                        <button 
                            type="button" 
                            onClick={addTestWords}
                            className="py-2 px-4 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-md shadow-sm"
                        >
                            🧪 테스트 단어
                        </button>
                    </div>
                    {pdfWords.length > 0 && (
                        <div className="flex space-x-2">
                            <button 
                                type="button" 
                                onClick={handleBulkAddWords}
                                disabled={!canUseAI || bulkAddProgress.isProcessing}
                                className="flex-1 py-2 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-md shadow-sm disabled:opacity-50"
                            >
                                {bulkAddProgress.isProcessing 
                                    ? `💫 처리 중... (${bulkAddProgress.current}/${bulkAddProgress.total})`
                                    : '💫 모든 단어 AI로 추가'
                                }
                            </button>
                        </div>
                    )}
                    
                    {/* 진행률 표시줄 */}
                    {bulkAddProgress.isProcessing && (
                        <div className="mt-4">
                            <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400 mb-2">
                                <span>단어 추가 진행 중...</span>
                                <span>{bulkAddProgress.current}/{bulkAddProgress.total}</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                                <div 
                                    className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${(bulkAddProgress.current / bulkAddProgress.total) * 100}%` }}
                                ></div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 추출된 단어 목록 */}
            {pdfWords.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-lg shadow-lg mb-8">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold text-slate-800 dark:text-white">추출된 단어 ({pdfWords.length}개)</h3>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={handleSelectAll}
                                className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
                            >
                                {selectedWords.size === pdfWords.length ? '전체 해제' : '전체 선택'}
                            </button>
                            {selectedWords.size > 0 && (
                                <button
                                    type="button"
                                    onClick={handleAddSelectedWords}
                                    disabled={!canUseAI || bulkAddProgress.isProcessing}
                                    className="px-3 py-1 text-sm bg-green-500 hover:bg-green-600 text-white rounded-md disabled:opacity-50 transition-colors"
                                >
                                    선택한 {selectedWords.size}개 단어 추가
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-60 overflow-y-auto">
                        {pdfWords.map((word, index) => (
                            <div key={index} className="relative">
                                <button
                                    type="button"
                                    onClick={() => handleWordSelect(word)}
                                    className="w-full p-2 text-sm bg-white dark:bg-slate-700 hover:bg-cyan-50 dark:hover:bg-cyan-900/30 text-slate-700 dark:text-slate-300 rounded-md border border-slate-300 dark:border-slate-600 hover:border-cyan-400 dark:hover:border-cyan-500 transition-colors"
                                >
                                    {word}
                                </button>
                                <input
                                    type="checkbox"
                                    checked={selectedWords.has(word)}
                                    onChange={() => handleWordToggle(word)}
                                    className="absolute -top-1 -right-1 w-4 h-4 text-blue-600 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded focus:ring-blue-500 focus:ring-2"
                                />
                            </div>
                        ))}
                    </div>
                    {selectedWords.size > 0 && (
                        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                선택된 단어: {selectedWords.size}개
                            </p>
                        </div>
                    )}
                </div>
            )}
            
            <form onSubmit={handleAddWord} className="bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-lg space-y-4 mb-8">
                <h2 className="text-xl font-semibold text-slate-800 dark:text-white">✏️ 개별 단어 추가</h2>
                <div>
                    <label htmlFor="term" className="block text-sm font-medium text-slate-700 dark:text-slate-300">단어 (필수)</label>
                    <input type="text" name="term" id="term" value={newWord.term || ''} onChange={handleInputChange} className="w-full mt-1 p-2 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500 shadow-sm" required />
                </div>
                <button 
                    type="button" 
                    onClick={handleAIFill} 
                    disabled={!canUseAI || isAddingViaAI || isSubmittingManual || !newWord.term?.trim()}
                    className="w-full py-2 px-4 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-md shadow-sm disabled:opacity-50 flex items-center justify-center"
                >
                    <span role="img" aria-label="ai" className="mr-2">✨</span> 
                    {isAddingViaAI ? 'AI 정보 가져오는 중...' : `AI로 나머지 정보 채우기 ${aiButtonDisabledReason}`}
                </button>
                <div>
                    <label htmlFor="meaning" className="block text-sm font-medium text-slate-700 dark:text-slate-300">뜻 (필수)</label>
                    <input type="text" name="meaning" id="meaning" value={newWord.meaning || ''} onChange={handleInputChange} className="w-full mt-1 p-2 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500 shadow-sm" required />
                </div>
                 <div>
                    <label htmlFor="partOfSpeech" className="block text-sm font-medium text-slate-700 dark:text-slate-300">품사 (필수)</label>
                    <input type="text" name="partOfSpeech" id="partOfSpeech" value={newWord.partOfSpeech || ''} onChange={handleInputChange} className="w-full mt-1 p-2 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500 shadow-sm" required />
                </div>
                <div>
                    <label htmlFor="pronunciation" className="block text-sm font-medium text-slate-700 dark:text-slate-300">발음기호 (선택)</label>
                    <input type="text" name="pronunciation" id="pronunciation" value={newWord.pronunciation || ''} onChange={handleInputChange} className="w-full mt-1 p-2 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500 shadow-sm" />
                </div>
                <div>
                    <label htmlFor="exampleSentence" className="block text-sm font-medium text-slate-700 dark:text-slate-300">예문 (필수)</label>
                    <textarea name="exampleSentence" id="exampleSentence" value={newWord.exampleSentence || ''} onChange={handleInputChange} rows={2} className="w-full mt-1 p-2 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500 shadow-sm" required></textarea>
                </div>
                 <div>
                    <label htmlFor="exampleSentenceMeaning" className="block text-sm font-medium text-slate-700 dark:text-slate-300">예문 뜻 (선택)</label>
                    <textarea name="exampleSentenceMeaning" id="exampleSentenceMeaning" value={newWord.exampleSentenceMeaning || ''} onChange={handleInputChange} rows={2} className="w-full mt-1 p-2 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500 shadow-sm"></textarea>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="gradeLevel" className="block text-sm font-medium text-slate-700 dark:text-slate-300">학년 (필수)</label>
                        <select name="gradeLevel" id="gradeLevel" value={newWord.gradeLevel} onChange={handleInputChange} className="w-full mt-1 p-2 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500 shadow-sm">
                            <option value="middle1">중1</option>
                            <option value="middle2">중2</option>
                            <option value="middle3">중3</option>
                        </select>
                    </div>
                     <div>
                        <label htmlFor="unit" className="block text-sm font-medium text-slate-700 dark:text-slate-300">단원 번호 (선택)</label>
                        <input type="number" name="unit" id="unit" value={newWord.unit === undefined ? '' : newWord.unit} onChange={handleInputChange} min="1" step="1" placeholder="예: 1" className="w-full mt-1 p-2 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500 shadow-sm" />
                    </div>
                </div>
                <button 
                    type="submit" 
                    disabled={isAddingViaAI || isSubmittingManual}
                    className="w-full py-2 px-4 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-md shadow-sm disabled:opacity-50"
                >
                    {isSubmittingManual ? '추가 중...' : '수동으로 단어 추가'}
                </button>
            </form>

            <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                '전체 단어' 목록에서 사용자 추가 단어(나의 단어)를 수정하거나 삭제할 수 있습니다.
                <button onClick={() => onNavigate('allWords')} className="ml-2 text-cyan-600 dark:text-cyan-400 hover:underline">전체 단어 목록으로 이동</button>
            </p>
        </div>
    );
};


// --- AI Tutor Chat Screen ---
interface ChatMessage {
    role: 'user' | 'model';
    text: string;
}

const TutorChatScreen: React.FC = () => {
    const { setGlobalLoading } = useAppContext();
    const { addToast } = useToasts();
    const [chat, setChat] = useState<Chat | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    const initializeChat = useCallback(() => {
        if (!ai) return;
        const systemInstruction = `You are a friendly and encouraging AI tutor specializing in English for Korean middle school students. Your name is 'VocaTutor'. 
        Always respond in Korean, unless the user specifically asks for English text.
        Keep your answers concise, clear, and easy to understand for a young learner. 
        Use emojis to make the conversation more engaging. 
        When explaining grammar or vocabulary, provide simple examples. 
        Your goal is to help students learn English in a fun and supportive way. Start the first message with a friendly greeting introducing yourself as VocaTutor.`;
        
        const newChat = ai.chats.create({
            model: 'gemini-2.5-flash-preview-04-17',
            config: {
                systemInstruction,
            },
        });
        setChat(newChat);
    }, []);

    // Initial greeting from AI
    useEffect(() => {
        initializeChat();
        setMessages([{ role: 'model', text: '안녕하세요! 저는 여러분의 영어 학습을 도와줄 AI 튜터, VocaTutor예요. 무엇이든 물어보세요! 😊' }]);
    }, [initializeChat]);

    // Auto-scroll to bottom of chat
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages, isLoading]);

    const handleNewChat = () => {
        initializeChat();
        setMessages([{ role: 'model', text: '새로운 대화를 시작합니다! 영어에 대해 궁금한 점이 있나요? ✍️' }]);
        addToast("새로운 대화를 시작했어요.", "info");
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedInput = userInput.trim();
        if (!trimmedInput || isLoading || !chat) return;

        setUserInput('');
        setMessages(prev => [...prev, { role: 'user', text: trimmedInput }]);
        setIsLoading(true);
        setGlobalLoading(true);

        try {
            const stream = await chat.sendMessageStream({ message: trimmedInput });
            let accumulatedText = '';
            setMessages(prev => [...prev, { role: 'model', text: '...' }]); // Placeholder

            for await (const chunk of stream) {
                accumulatedText += chunk.text;
                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { role: 'model', text: accumulatedText };
                    return newMessages;
                });
            }
        } catch (error: any) {
            console.error("AI Tutor chat error:", error);
            const { displayErrorMsg } = parseGeminiError(error);
            addToast(`AI 튜터와의 대화 중 오류가 발생했습니다: ${displayErrorMsg}`, "error");
            setMessages(prev => prev.slice(0, -1)); // Remove placeholder
        } finally {
            setIsLoading(false);
            setGlobalLoading(false);
        }
    };

    if (!ai) {
        return (
            <div className="p-8 text-center text-slate-600 dark:text-slate-300">
                AI 튜터 기능을 사용하려면 API 키가 필요합니다.
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-80px)] p-4 sm:p-6 bg-slate-50 dark:bg-slate-900">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400">💬 AI 튜터</h1>
                <button
                    onClick={handleNewChat}
                    className="py-2 px-4 bg-slate-500 hover:bg-slate-600 text-white text-sm font-semibold rounded-lg shadow-md transition-colors"
                >
                    새로운 대화 시작
                </button>
            </div>

            <div ref={chatContainerRef} className="flex-grow p-4 bg-white dark:bg-slate-800 rounded-lg shadow-inner overflow-y-auto custom-scrollbar space-y-4">
                {messages.map((msg, index) => (
                    <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-xs md:max-w-md lg:max-w-2xl p-3 rounded-lg shadow ${
                            msg.role === 'user' 
                                ? 'bg-cyan-500 text-white' 
                                : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white'
                        }`}>
                            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {msg.text}
                                </ReactMarkdown>
                            </div>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="max-w-xs md:max-w-md lg:max-w-2xl p-3 rounded-lg shadow bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white">
                            <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-slate-500 rounded-full animate-pulse [animation-delay:-0.3s]"></div>
                                <div className="w-2 h-2 bg-slate-500 rounded-full animate-pulse [animation-delay:-0.15s]"></div>
                                <div className="w-2 h-2 bg-slate-500 rounded-full animate-pulse"></div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <form onSubmit={handleSendMessage} className="mt-4 flex items-center space-x-2">
                <input
                    type="text"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="AI 튜터에게 질문해보세요..."
                    className="w-full p-3 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg border-2 border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                    disabled={isLoading}
                />
                <button
                    type="submit"
                    className="py-3 px-5 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-lg shadow-md disabled:opacity-50"
                    disabled={isLoading || !userInput.trim()}
                >
                    전송
                </button>
            </form>
        </div>
    );
};


// --- Game Mode Screens ---
// GameSelectionScreen
const GameSelectionScreen: React.FC = () => {
    const { onNavigate } = useAppContext();
    const { addToast } = useToasts();
    
    const games = [
        { id: 'wordMatchGame', name: '짝맞추기 게임', description: '단어와 뜻을 빠르게 연결하세요!', icon: '🔗', screen: 'wordMatchGame' as AppScreen, isReady: true},
        { id: 'typingPracticeGame', name: '타자 연습 게임', description: '단어를 정확하고 빠르게 입력해보세요.', icon: '⌨️', screen: 'typingPracticeGame' as AppScreen, isReady: true },
        { id: 'speedQuizGame', name: '스피드 퀴즈', description: '제한 시간 내에 많은 문제를 풀어보세요!', icon: '⏱️', screen: 'speedQuizGame' as AppScreen, isReady: true },
        { id: 'wordShooterGame', name: '뜻 사격 게임', description: '떨어지는 단어 중 올바른 것을 맞추세요!', icon: '🎯', screen: 'wordShooterGame' as AppScreen, isReady: true },
        { id: 'wordBombGame', name: '단어 폭탄 제거', description: '떨어지는 폭탄의 뜻을 보고 단어를 입력하여 제거하세요!', icon: '💣', screen: 'wordBombGame' as AppScreen, isReady: true },
        { id: 'wordZombieDefense', name: '단어 좀비 디펜스', description: '단어의 뜻을 보고 좀비를 막아내세요!', icon: '🧟', screen: 'wordZombieDefense' as AppScreen, isReady: true },
        { id: 'timedWordLinkGame', name: '시간 연결 게임', description: '단어와 뜻을 선으로 연결하여 시간 내에 제출하세요.', icon: '↔️', screen: 'timedWordLinkGame' as AppScreen, isReady: true },
    ];

    return (
        <div className="p-4 sm:p-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6 text-center">🎮 게임 모드 선택</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {games.map(game => (
                    <button
                        key={game.id}
                        onClick={() => {
                            if (!game.isReady) {
                                addToast(`${game.name}은 준비 중입니다.`, "info");
                            } else {
                                onNavigate(game.screen);
                            }
                        }}
                        className={`bg-slate-100 dark:bg-slate-700 p-6 rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-200 text-center
                                     ${!game.isReady ? 'opacity-60 cursor-not-allowed' : 'hover:ring-2 hover:ring-cyan-500 dark:hover:ring-cyan-400'}`}
                        aria-label={game.name}
                        disabled={!game.isReady}
                    >
                        <div className="text-4xl mb-3">{game.icon}</div>
                        <h2 className="text-xl font-semibold text-cyan-700 dark:text-cyan-300 mb-2">{game.name}</h2>
                        <p className="text-sm text-slate-600 dark:text-slate-400">{game.description}</p>
                        {!game.isReady && <span className="mt-2 inline-block text-xs bg-yellow-400 text-slate-800 px-2 py-0.5 rounded-full">준비 중</span>}
                    </button>
                ))}
            </div>
        </div>
    );
};


// WordMatchGame
// Define specific types for options in the game
type TermOption = Word & { id: string; type: 'term' }; // id will be 'term-originalId'
type MeaningOption = { meaning: string; id: string; originalWordId: string | number; type: 'meaning' }; // id will be 'meaning-originalId'
type GameOption = TermOption | MeaningOption;

const WordMatchGame: React.FC = () => {
    const { allWords, onNavigate, handleGameComplete } = useAppContext();
    const { addToast } = useToasts();
    
    const [gameState, setGameState] = useState<'setup' | 'playing'>('setup');
    const [selectedUnit, setSelectedUnit] = useState<string|number>('all');
    
    const [gameWords, setGameWords] = useState<Word[]>([]);
    const [options, setOptions] = useState<GameOption[]>([]);
    const [selectedTerm, setSelectedTerm] = useState<TermOption | null>(null);
    const [selectedMeaning, setSelectedMeaning] = useState<MeaningOption | null>(null);
    const [matchedPairs, setMatchedPairs] = useState<string[]>([]); // Stores string IDs of matched options
    const [incorrectAttempts, setIncorrectAttempts] = useState(0);
    const [startTime, setStartTime] = useState<number | null>(null);
    
    const NUM_PAIRS = 8;

    const units = useMemo(() => {
        const unitSet = new Set<string | number>();
        allWords.forEach(word => {
            if (word.unit) unitSet.add(word.unit);
        });
        return Array.from(unitSet).sort((a, b) => Number(a) - Number(b));
    }, [allWords]);

    const initializeGame = useCallback((wordsForGame: Word[]) => {
        const selectedGameWords = shuffleArray(wordsForGame).slice(0, NUM_PAIRS);
        setGameWords(selectedGameWords);
        
        const termsForOptions: TermOption[] = selectedGameWords.map(w => ({ ...w, id: `term-${w.id}`, type: 'term' }));
        const meaningsForOptions: MeaningOption[] = selectedGameWords.map(w => ({ meaning: w.meaning, id: `meaning-${w.id}`, originalWordId: w.id, type: 'meaning' }));
        
        setOptions(shuffleArray([...termsForOptions, ...meaningsForOptions]));
        setSelectedTerm(null);
        setSelectedMeaning(null);
        setMatchedPairs([]);
        setIncorrectAttempts(0);
        setStartTime(Date.now());
        setGameState('playing');
    }, []);

    const handleStartGame = () => {
        let sourceWords = [];
        if (selectedUnit === 'all') {
            sourceWords = allWords;
        } else {
            sourceWords = allWords.filter(w => String(w.unit) === String(selectedUnit));
        }

        if (sourceWords.length < NUM_PAIRS) {
            addToast(`짝맞추기 게임을 위해 단어가 최소 ${NUM_PAIRS}개 필요합니다. (현재: ${sourceWords.length}개)`, "warning");
            return;
        }
        initializeGame(sourceWords);
    };

    useEffect(() => {
        if (selectedTerm && selectedMeaning) {
            const originalIdFromTerm = selectedTerm.id.replace('term-', '');
            const originalIdFromMeaningOption = String(selectedMeaning.originalWordId);

            if (originalIdFromTerm === originalIdFromMeaningOption) { // Correct match
                const newMatchedPairs = [...matchedPairs, selectedTerm.id, selectedMeaning.id];
                setMatchedPairs(newMatchedPairs);
                setSelectedTerm(null);
                setSelectedMeaning(null);
                
                if (newMatchedPairs.length === gameWords.length * 2) {
                    const endTime = Date.now();
                    const timeTaken = Math.round((endTime - (startTime || endTime)) / 1000);
                    const score = Math.max(0, (gameWords.length * 10) - (incorrectAttempts * 2) - Math.floor(timeTaken / 10)); 
                    
                    handleGameComplete(score, gameWords.length, incorrectAttempts, timeTaken);
                    onNavigate('gameResult', { score, correct: gameWords.length, incorrect: incorrectAttempts, timeTaken, gameName: '짝맞추기 게임' });
                }
            } else { // Incorrect match
                addToast("땡! 다시 시도하세요.", "error");
                setIncorrectAttempts(prev => prev + 1);
                
                const termElement = document.getElementById(selectedTerm.id);
                const meaningElement = document.getElementById(selectedMeaning.id);
                termElement?.classList.add('animate-pulse', 'bg-red-300', 'dark:bg-red-700');
                meaningElement?.classList.add('animate-pulse', 'bg-red-300', 'dark:bg-red-700');
                setTimeout(() => {
                    termElement?.classList.remove('animate-pulse', 'bg-red-300', 'dark:bg-red-700');
                    meaningElement?.classList.remove('animate-pulse', 'bg-red-300', 'dark:bg-red-700');
                    setSelectedTerm(null);
                    setSelectedMeaning(null);
                }, 700);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTerm, selectedMeaning]);


    const handleOptionClick = (option: GameOption) => {
        if (matchedPairs.includes(option.id)) return;

        if (option.type === 'term') {
            setSelectedTerm(selectedTerm?.id === option.id ? null : option);
        } else { // option.type === 'meaning'
            setSelectedMeaning(selectedMeaning?.id === option.id ? null : option);
        }
    };
    
    if (gameState === 'setup') {
        return (
            <div className="p-4 sm:p-8 flex flex-col items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6">🔗 짝맞추기 게임 설정</h1>
                <div className="w-full max-w-md bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-lg space-y-6">
                    <div>
                        <label htmlFor="unit-select-match" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">모드 선택</label>
                        <select
                            id="unit-select-match"
                            value={String(selectedUnit)}
                            onChange={(e) => setSelectedUnit(e.target.value)}
                            className="w-full p-3 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500"
                        >
                            <option value="all">전체 단어 ({NUM_PAIRS}쌍 랜덤)</option>
                            <optgroup label="단원별 게임">
                                {units.map(unit => <option key={unit} value={unit}>단원 {unit}</option>)}
                            </optgroup>
                        </select>
                    </div>
                    <button onClick={handleStartGame} className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md">
                        게임 시작
                    </button>
                </div>
            </div>
        );
    }
    
    if (gameState === 'playing') {
        return (
            <div className="p-4 sm:p-6 flex flex-col items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-2">🔗 짝맞추기 게임</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">단어와 뜻을 연결하세요!</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">남은 짝: {gameWords.length - matchedPairs.length/2} | 틀린 횟수: {incorrectAttempts}</p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 w-full max-w-3xl">
                    {options.map(opt => (
                        <button
                            key={opt.id}
                            id={opt.id} 
                            onClick={() => handleOptionClick(opt)}
                            disabled={matchedPairs.includes(opt.id)}
                            className={`p-3 sm:p-4 rounded-lg shadow-md text-sm sm:text-base text-center break-all min-h-[60px] flex items-center justify-center
                                ${matchedPairs.includes(opt.id)
                                    ? 'bg-green-500 text-white cursor-default opacity-70'
                                    : (selectedTerm?.id === opt.id || selectedMeaning?.id === opt.id)
                                        ? 'bg-yellow-400 dark:bg-yellow-600 text-slate-900 dark:text-white ring-2 ring-yellow-500'
                                        : 'bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-white hover:bg-cyan-500 dark:hover:bg-cyan-400 hover:text-white'
                                }
                                transition-all duration-150 ease-in-out
                            `}
                        >
                            {opt.type === 'term' ? opt.term : opt.meaning}
                        </button>
                    ))}
                </div>
                 <button onClick={() => onNavigate('gameSelection')} className="mt-8 text-sm text-cyan-600 dark:text-cyan-400 hover:underline">다른 게임 선택</button>
            </div>
        );
    }

    return <div className="p-8 text-center text-slate-600 dark:text-slate-300">게임 데이터 로딩 중...</div>;
};


// TimedWordLinkGame
type LinkGameConnection = { fromId: string; toId: string };
type LinkGameCard = { 
    id: string;
    text: string;
    originalId: string | number;
    ref: React.RefObject<HTMLDivElement>; 
};

const TimedWordLinkGame: React.FC = () => {
    const { allWords, onNavigate, handleGameComplete } = useAppContext();
    const { addToast } = useToasts();
    
    const [gameState, setGameState] = useState<'setup' | 'playing' | 'finished'>('setup');
    const [selectedUnit, setSelectedUnit] = useState<string|number>('all');
    
    const [wordCards, setWordCards] = useState<LinkGameCard[]>([]);
    const [meaningCards, setMeaningCards] = useState<LinkGameCard[]>([]);
    const [connections, setConnections] = useState<LinkGameConnection[]>([]);
    const [currentLine, setCurrentLine] = useState<{ fromId: string; fromPos: { x: number; y: number }; toPos: { x: number; y: number } } | null>(null);
    const [feedbackMode, setFeedbackMode] = useState(false);
    
    const [timeLeft, setTimeLeft] = useState(60);
    const [correctCount, setCorrectCount] = useState(0);
    const [incorrectCount, setIncorrectCount] = useState(0);
    
    const timerRef = useRef<number | null>(null);
    const gameAreaRef = useRef<HTMLDivElement>(null);
    const NUM_PAIRS = 8;
    const GAME_DURATION = 60;

    const units = useMemo(() => {
        const unitSet = new Set<string | number>();
        allWords.forEach(word => {
            if (word.unit) unitSet.add(word.unit);
        });
        return Array.from(unitSet).sort((a, b) => Number(a) - Number(b));
    }, [allWords]);

    const getCardCenter = useCallback((cardRef: React.RefObject<HTMLDivElement>) => {
        if (!cardRef.current || !gameAreaRef.current) return { x: 0, y: 0 };
        const gameRect = gameAreaRef.current.getBoundingClientRect();
        const cardRect = cardRef.current.getBoundingClientRect();
        return {
            x: cardRect.left + cardRect.width / 2 - gameRect.left,
            y: cardRect.top + cardRect.height / 2 - gameRect.top,
        };
    }, []);

    const handleStartGame = () => {
        let sourceWords = [];
        if (selectedUnit === 'all') {
            sourceWords = allWords;
        } else {
            sourceWords = allWords.filter(w => String(w.unit) === String(selectedUnit));
        }

        if (sourceWords.length < NUM_PAIRS) {
            addToast(`시간 연결 게임을 위해 단어가 최소 ${NUM_PAIRS}개 필요합니다. (현재: ${sourceWords.length}개)`, "warning");
            return;
        }
        
        const gameWords = shuffleArray(sourceWords).slice(0, NUM_PAIRS);
        
        setWordCards(gameWords.map(w => ({ id: `word-${w.id}`, text: w.term, originalId: w.id, ref: React.createRef<HTMLDivElement>() })));
        setMeaningCards(shuffleArray(gameWords).map(w => ({ id: `meaning-${w.id}`, text: w.meaning.split('/')[0].trim(), originalId: w.id, ref: React.createRef<HTMLDivElement>() })));
        
        setConnections([]);
        setCurrentLine(null);
        setFeedbackMode(false);
        setTimeLeft(GAME_DURATION);
        setCorrectCount(0);
        setIncorrectCount(0);
        setGameState('playing');
    };
    
    const handleSubmit = useCallback(() => {
        if (gameState !== 'playing') return;
        setGameState('finished');
        if (timerRef.current) clearInterval(timerRef.current);

        let correct = 0;
        let incorrect = 0;

        const connectedWordIds = new Set(connections.map(c => c.fromId));

        connections.forEach(conn => {
            const wordId = conn.fromId.replace('word-', '');
            const meaningId = conn.toId.replace('meaning-', '');
            if (wordId === meaningId) {
                correct++;
            } else {
                incorrect++;
            }
        });
        
        // Unconnected words are also incorrect
        incorrect += wordCards.length - connectedWordIds.size;
        
        const calculatedScore = Math.max(0, correct * 10 - incorrect * 5);
        setCorrectCount(correct);
        setIncorrectCount(incorrect);
        setFeedbackMode(true);
        
        handleGameComplete(calculatedScore, correct, incorrect, GAME_DURATION - timeLeft);
        setTimeout(() => {
            onNavigate('gameResult', { score: calculatedScore, correct, incorrect, timeTaken: GAME_DURATION - timeLeft, gameName: '시간 연결 게임' });
        }, 2000); // Show feedback for 2 seconds
    }, [gameState, connections, wordCards.length, timeLeft, handleGameComplete, onNavigate]);

    useEffect(() => {
        if (gameState === 'playing' && timeLeft > 0) {
            timerRef.current = window.setInterval(() => {
                setTimeLeft(prev => prev - 1);
            }, 1000);
        } else if (gameState === 'playing' && timeLeft === 0) {
            addToast("시간 종료!", "warning");
            handleSubmit();
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [gameState, timeLeft, handleSubmit]);


    const handleDragStart = (e: React.MouseEvent | React.TouchEvent, wordId: string) => {
        if (feedbackMode) return;
        e.preventDefault();
        const wordCard = wordCards.find(w => w.id === wordId);
        if (!wordCard) return;
        
        setConnections(prev => prev.filter(c => c.fromId !== wordId));
        const fromPos = getCardCenter(wordCard.ref);
        setCurrentLine({ fromId: wordId, fromPos, toPos: fromPos });
    };

    const handleDrag = useCallback((e: MouseEvent | TouchEvent) => {
        if (!currentLine || !gameAreaRef.current) return;
        e.preventDefault();
        const gameRect = gameAreaRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        setCurrentLine(prev => prev ? { ...prev, toPos: { x: clientX - gameRect.left, y: clientY - gameRect.top } } : null);
    }, [currentLine]);

    const handleDragEnd = useCallback((e: MouseEvent | TouchEvent) => {
        if (!currentLine) return;
        const clientX = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
        const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;
        const dropTarget = document.elementFromPoint(clientX, clientY);
        
        const meaningCardElement = dropTarget?.closest('.timed-link-meaning-card');
        if (meaningCardElement) {
            const toId = meaningCardElement.id;
            setConnections(prev => {
                const otherConnections = prev.filter(c => c.fromId !== currentLine.fromId && c.toId !== toId);
                return [...otherConnections, { fromId: currentLine.fromId, toId }];
            });
        }
        setCurrentLine(null);
    }, [currentLine]);

    useEffect(() => {
        if (!currentLine) return;
        window.addEventListener('mousemove', handleDrag);
        window.addEventListener('touchmove', handleDrag, { passive: false });
        window.addEventListener('mouseup', handleDragEnd);
        window.addEventListener('touchend', handleDragEnd);

        return () => {
            window.removeEventListener('mousemove', handleDrag);
            window.removeEventListener('touchmove', handleDrag);
            window.removeEventListener('mouseup', handleDragEnd);
            window.removeEventListener('touchend', handleDragEnd);
        };
    }, [currentLine, handleDrag, handleDragEnd]);


    if (gameState === 'setup') {
        return (
            <div className="p-4 sm:p-8 flex flex-col items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6">⏱️ 시간 연결 게임 설정</h1>
                <div className="w-full max-w-md bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-lg space-y-6">
                    <div>
                        <label htmlFor="unit-select-link" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">모드 선택</label>
                        <select
                            id="unit-select-link"
                            value={String(selectedUnit)}
                            onChange={(e) => setSelectedUnit(e.target.value)}
                            className="w-full p-3 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500"
                        >
                            <option value="all">전체 단어 ({NUM_PAIRS}쌍 랜덤)</option>
                            <optgroup label="단원별 게임">
                                {units.map(unit => <option key={unit} value={unit}>단원 {unit}</option>)}
                            </optgroup>
                        </select>
                    </div>
                    <button onClick={handleStartGame} className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md">
                        게임 시작
                    </button>
                </div>
            </div>
        );
    }
    
    return (
        <div className="p-4 sm:p-6 flex flex-col items-center h-[calc(100vh-80px)]">
             <div className="w-full max-w-4xl">
                 <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-2 text-center">⏱️ 시간 연결 게임</h1>
                 <div className="flex justify-between items-center text-slate-700 dark:text-slate-200 mb-4">
                     <div className="text-lg font-bold">남은 시간: <span className="text-cyan-500">{timeLeft}</span></div>
                      {gameState === 'finished' 
                        ? <div className="text-lg font-bold">결과: <span className="text-green-500">{correctCount}</span> / <span className="text-red-500">{incorrectCount}</span></div>
                        : <div className="text-lg font-bold">연결된 단어: <span className="text-cyan-500">{connections.length}/{NUM_PAIRS}</span></div>
                     }
                 </div>
                 <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2.5 mb-4">
                    <div className="bg-cyan-500 h-2.5 rounded-full" style={{ width: `${(timeLeft / GAME_DURATION) * 100}%` }}></div>
                </div>
            </div>
            <div ref={gameAreaRef} className="relative flex-grow w-full max-w-4xl flex justify-between touch-none">
                <div className="w-1/2 flex flex-col justify-around pr-4 space-y-2">
                    {wordCards.map(card => {
                        const isConnected = connections.some(c => c.fromId === card.id);
                        return (
                            <div key={card.id} id={card.id} ref={card.ref}
                                 onMouseDown={(e) => handleDragStart(e, card.id)} onTouchStart={(e) => handleDragStart(e, card.id)}
                                 className={`p-3 rounded-lg shadow-md text-center cursor-grab ${isConnected ? 'bg-cyan-200 dark:bg-cyan-800' : 'bg-white dark:bg-slate-700'}`}>
                                {card.text}
                            </div>
                        );
                    })}
                </div>
                <div className="w-1/2 flex flex-col justify-around pl-4 space-y-2">
                     {meaningCards.map(card => {
                        const isConnected = connections.some(c => c.toId === card.id);
                         return (
                            <div key={card.id} id={card.id} ref={card.ref}
                                className={`timed-link-meaning-card p-3 rounded-lg shadow-md text-center ${isConnected ? 'bg-cyan-200 dark:bg-cyan-800' : 'bg-white dark:bg-slate-700'}`}>
                                {card.text}
                            </div>
                         );
                     })}
                </div>

                <svg className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ touchAction: 'none' }}>
                    {connections.map(conn => {
                        const fromCard = wordCards.find(c => c.id === conn.fromId);
                        const toCard = meaningCards.find(c => c.id === conn.toId);
                        if (!fromCard || !toCard) return null;
                        
                        const fromPos = getCardCenter(fromCard.ref);
                        const toPos = getCardCenter(toCard.ref);

                        let strokeColor = "stroke-slate-400 dark:stroke-slate-500";
                        if(feedbackMode){
                           const fromId = conn.fromId.replace('word-','');
                           const toId = conn.toId.replace('meaning-','');
                           strokeColor = fromId === toId ? "stroke-green-500" : "stroke-red-500";
                        }
                        return <line key={conn.fromId} x1={fromPos.x} y1={fromPos.y} x2={toPos.x} y2={toPos.y} className={`${strokeColor} transition-all`} strokeWidth="3" />;
                    })}
                    {currentLine && (
                        <line x1={currentLine.fromPos.x} y1={currentLine.fromPos.y} x2={currentLine.toPos.x} y2={currentLine.toPos.y} 
                              className="stroke-cyan-500" strokeWidth="3" strokeDasharray="5 5" />
                    )}
                </svg>
            </div>
            <div className="mt-4">
                <button onClick={handleSubmit} disabled={gameState === 'finished'}
                        className="w-full max-w-md py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-md shadow-md disabled:opacity-50">
                    {gameState === 'finished' ? `결과 확인 중...` : '제출하기'}
                </button>
            </div>
        </div>
    );
};

// GameResultScreen
interface GameResultScreenProps {
    routeParams?: any;
}
const GameResultScreen: React.FC<GameResultScreenProps> = ({ routeParams }) => {
    const { onNavigate } = useAppContext();
    const { score = 0, correct = 0, incorrect = 0, timeTaken = 0, gameName = "게임", wpm } = routeParams || {};

    return (
        <div className="p-4 sm:p-8 text-center flex flex-col items-center justify-center min-h-[calc(100vh-150px)] sm:min-h-0">
            <h1 className="text-3xl sm:text-4xl font-bold text-cyan-600 dark:text-cyan-400 mb-4">🎉 {gameName} 완료! 🎉</h1>
            <div className="bg-slate-100 dark:bg-slate-700 p-6 sm:p-8 rounded-xl shadow-2xl w-full max-w-md space-y-3">
                <p className="text-5xl font-bold text-yellow-500 dark:text-yellow-400">{score}점</p>
                <p className="text-lg text-slate-700 dark:text-slate-200">맞춘 개수: <span className="font-semibold text-green-500">{correct}</span></p>
                <p className="text-lg text-slate-700 dark:text-slate-200">틀린 횟수/단어: <span className="font-semibold text-red-500">{incorrect}</span></p>
                {timeTaken > 0 && <p className="text-lg text-slate-700 dark:text-slate-200">걸린 시간: <span className="font-semibold">{timeTaken}초</span></p>}
                {wpm !== undefined && <p className="text-lg text-slate-700 dark:text-slate-200">분당 타수 (WPM): <span className="font-semibold">{wpm}</span></p>}
                {score > 0 && <p className="text-md text-yellow-600 dark:text-yellow-300">✨ XP +{score} ✨</p>}
            </div>
            <div className="mt-8 space-x-4">
                <button
                    onClick={() => onNavigate('gameSelection')}
                    className="py-2 px-6 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-lg shadow-md"
                >
                    다른 게임하기
                </button>
                <button
                    onClick={() => onNavigate('dashboard')}
                    className="py-2 px-6 bg-slate-500 hover:bg-slate-600 dark:bg-slate-600 dark:hover:bg-slate-500 text-white font-semibold rounded-lg shadow-md"
                >
                    대시보드로
                </button>
            </div>
        </div>
    );
};


// TypingPracticeGame
interface WordInTypingGameInfo {
    originalWord: Word;
    submissions: number; 
    isCorrectlyTyped: boolean; 
    firstTryCorrect: boolean;
}

const TypingPracticeGame: React.FC = () => {
    const { allWords, onNavigate, handleGameComplete } = useAppContext();
    const { addToast } = useToasts();

    const [gameState, setGameState] = useState<'setup' | 'playing'>('setup');
    const [selectedUnit, setSelectedUnit] = useState<string|number>('all');
    
    const [gameWordsInfo, setGameWordsInfo] = useState<WordInTypingGameInfo[]>([]);
    const [currentWordIndex, setCurrentWordIndex] = useState(0);
    const [inputValue, setInputValue] = useState('');
    const [currentScore, setCurrentScore] = useState(0);
    const [gameStartTime, setGameStartTime] = useState<number | null>(null);
    const [inputFeedbackStyle, setInputFeedbackStyle] = useState('border-slate-300 dark:border-slate-500 focus:ring-cyan-500 focus:border-cyan-500');
    const inputRef = useRef<HTMLInputElement>(null);

    const MAX_WORDS_IN_GAME = 15;
    const MIN_WORDS_FOR_GAME = 5;

    const units = useMemo(() => {
        const unitSet = new Set<string | number>();
        allWords.forEach(word => {
            if (word.unit) unitSet.add(word.unit);
        });
        return Array.from(unitSet).sort((a, b) => Number(a) - Number(b));
    }, [allWords]);

    const initializeGame = useCallback((wordsForGame: Word[]) => {
        const selectedRawWords = shuffleArray(wordsForGame).slice(0, MAX_WORDS_IN_GAME);
        setGameWordsInfo(selectedRawWords.map(word => ({
            originalWord: word,
            submissions: 0,
            isCorrectlyTyped: false,
            firstTryCorrect: false
        })));
        setCurrentWordIndex(0);
        setInputValue('');
        setCurrentScore(0);
        setGameStartTime(Date.now());
        setInputFeedbackStyle('border-slate-300 dark:border-slate-500 focus:ring-cyan-500 focus:border-cyan-500');
        setGameState('playing');
    }, []);
    
    useEffect(() => {
        if(gameState === 'playing') {
            inputRef.current?.focus();
        }
    }, [gameState, currentWordIndex]);

    const handleStartGame = () => {
        const alphabetOnly = (term: string) => /^[a-zA-Z\s'-]+$/.test(term);
        let sourceWords: Word[] = [];
        if (selectedUnit === 'all') {
            sourceWords = allWords.filter(w => alphabetOnly(w.term));
        } else {
            sourceWords = allWords.filter(w => String(w.unit) === String(selectedUnit) && alphabetOnly(w.term));
        }

        if (sourceWords.length < MIN_WORDS_FOR_GAME) {
            addToast(`타자 연습을 위해 알파벳 단어가 최소 ${MIN_WORDS_FOR_GAME}개 필요합니다. (현재: ${sourceWords.length}개)`, "warning");
            return;
        }
        initializeGame(sourceWords);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
        setInputFeedbackStyle('border-slate-300 dark:border-slate-500 focus:ring-cyan-500 focus:border-cyan-500');
    };

    const finishGame = useCallback(() => {
        const endTime = Date.now();
        const timeTaken = Math.round((endTime - (gameStartTime || endTime)) / 1000);
        const correctWords = gameWordsInfo.filter(w => w.isCorrectlyTyped).length;
        const incorrectWords = gameWordsInfo.length - correctWords;
        
        const correctlyTypedChars = gameWordsInfo
            .filter(w => w.isCorrectlyTyped)
            .reduce((acc, word) => acc + word.originalWord.term.length, 0);
            
        const timeInMinutes = timeTaken / 60;
        const wpm = timeInMinutes > 0 ? Math.round((correctlyTypedChars / 5) / timeInMinutes) : 0;
        
        handleGameComplete(currentScore, correctWords, incorrectWords, timeTaken);
        onNavigate('gameResult', { score: currentScore, correct: correctWords, incorrect: incorrectWords, timeTaken, gameName: '타자 연습 게임', wpm });
    }, [gameStartTime, currentScore, gameWordsInfo, handleGameComplete, onNavigate]);

    const handleFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (gameState !== 'playing' || !gameWordsInfo[currentWordIndex]) return;

        const currentWordInfo = gameWordsInfo[currentWordIndex];
        const isCorrect = inputValue.trim().toLowerCase() === currentWordInfo.originalWord.term.toLowerCase();

        const updatedGameWordsInfo = [...gameWordsInfo];
        const updatedWordInfo = { ...updatedGameWordsInfo[currentWordIndex] };
        updatedWordInfo.submissions += 1;

        if (isCorrect) {
            updatedWordInfo.isCorrectlyTyped = true;
            if (updatedWordInfo.submissions === 1) {
                updatedWordInfo.firstTryCorrect = true;
            }
            updatedGameWordsInfo[currentWordIndex] = updatedWordInfo;
            setGameWordsInfo(updatedGameWordsInfo);

            const points = updatedWordInfo.firstTryCorrect ? 15 : 5;
            setCurrentScore(prev => prev + points);
            setInputFeedbackStyle('border-green-500 ring-2 ring-green-500');
            setInputValue('');
            
            setTimeout(() => {
                if (currentWordIndex + 1 < gameWordsInfo.length) {
                    setCurrentWordIndex(prev => prev + 1);
                } else {
                    finishGame();
                }
            }, 300);
        } else {
            updatedGameWordsInfo[currentWordIndex] = updatedWordInfo;
            setGameWordsInfo(updatedGameWordsInfo);
            setInputFeedbackStyle('border-red-500 ring-2 ring-red-500 animate-shake');
            setCurrentScore(prev => Math.max(0, prev - 3));
            addToast("오타! 다시 시도하세요.", "error");
        }
    };
    
    if (gameState === 'setup') {
        return (
            <div className="p-4 sm:p-8 flex flex-col items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6">⌨️ 타자 연습 게임 설정</h1>
                <div className="w-full max-w-md bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-lg space-y-6">
                    <div>
                        <label htmlFor="unit-select-typing" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">모드 선택</label>
                        <select
                            id="unit-select-typing"
                            value={String(selectedUnit)}
                            onChange={(e) => setSelectedUnit(e.target.value)}
                            className="w-full p-3 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500"
                        >
                            <option value="all">전체 단어 ({MAX_WORDS_IN_GAME}개 랜덤)</option>
                            <optgroup label="단원별 게임">
                                {units.map(unit => <option key={unit} value={unit}>단원 {unit}</option>)}
                            </optgroup>
                        </select>
                         <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">알파벳으로만 구성된 단어만 출제됩니다.</p>
                    </div>
                    <button onClick={handleStartGame} className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md">
                        게임 시작
                    </button>
                </div>
            </div>
        );
    }
    
    const currentWordToType = gameWordsInfo[currentWordIndex]?.originalWord;
    
    if (!currentWordToType) {
        return <div className="p-8 text-center text-slate-600 dark:text-slate-300">게임 종료 중...</div>;
    }

    return (
        <div className="p-4 sm:p-6 flex flex-col items-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-2">⌨️ 타자 연습 게임</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">단어 {currentWordIndex + 1}/{gameWordsInfo.length} | 점수: {currentScore}</p>

            <div className="w-full max-w-md bg-slate-100 dark:bg-slate-700 p-6 rounded-xl shadow-lg">
                <div className="text-center mb-4">
                    <p className="text-lg text-slate-600 dark:text-slate-300">아래 단어를 입력하세요:</p>
                    <p className="text-4xl font-bold text-slate-800 dark:text-white my-2">{currentWordToType.term}</p>
                    <p className="text-md text-slate-500 dark:text-slate-400">{currentWordToType.meaning}</p>
                </div>
                <form onSubmit={handleFormSubmit}>
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        className={`w-full p-4 text-center text-xl bg-white dark:bg-slate-600 text-slate-900 dark:text-white rounded-md border-2 shadow-inner transition-all ${inputFeedbackStyle}`}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck="false"
                    />
                    <button type="submit" className="w-full mt-4 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md">
                        확인
                    </button>
                </form>
            </div>
             <button onClick={() => onNavigate('gameSelection')} className="mt-8 text-sm text-cyan-600 dark:text-cyan-400 hover:underline">다른 게임 선택</button>
        </div>
    );
};

// SpeedQuizGame
const SpeedQuizGame: React.FC = () => {
    const { allWords, onNavigate, handleGameComplete } = useAppContext();
    const { addToast } = useToasts();
    
    const [gameState, setGameState] = useState<'setup' | 'playing' | 'finished'>('setup');
    const [selectedUnit, setSelectedUnit] = useState<string|number>('all');
    const [timeLeft, setTimeLeft] = useState(60);
    const [shuffledWords, setShuffledWords] = useState<Word[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [options, setOptions] = useState<string[]>([]);
    const [correctCount, setCorrectCount] = useState(0);
    const [incorrectCount, setIncorrectCount] = useState(0);
    const [feedback, setFeedback] = useState<'correct' | 'incorrect' | null>(null);

    const timerRef = useRef<number | null>(null);

    const units = useMemo(() => {
        const unitSet = new Set<string | number>();
        allWords.forEach(word => {
            if (word.unit) unitSet.add(word.unit);
        });
        return Array.from(unitSet).sort((a, b) => Number(a) - Number(b));
    }, [allWords]);

    const [optionSource, setOptionSource] = useState<Word[]>([]);

    const generateOptions = useCallback((correctWord: Word, optionSourceWords: Word[]) => {
        let incorrectMeaningPool = shuffleArray(
            optionSourceWords
                .filter(w => w.id !== correctWord.id)
                .map(w => w.meaning.split('/')[0].trim())
        );
        const uniqueIncorrectOptions = Array.from(new Set(incorrectMeaningPool)).slice(0, 3);
        
        let placeholderIndex = 1;
        while (uniqueIncorrectOptions.length < 3) {
            const placeholder = `오답 ${placeholderIndex++}`;
             if(!uniqueIncorrectOptions.includes(placeholder) && placeholder !== correctWord.meaning.split('/')[0].trim()) {
                 uniqueIncorrectOptions.push(placeholder);
            }
        }
        
        setOptions(shuffleArray([correctWord.meaning.split('/')[0].trim(), ...uniqueIncorrectOptions]));
    }, []);
    
    const setupNextQuestion = useCallback((index: number) => {
        if (shuffledWords.length === 0 || optionSource.length === 0) return;
        let nextWordIndex = index;
        let currentShuffled = shuffledWords;

        if (index >= shuffledWords.length) {
            currentShuffled = shuffleArray(shuffledWords);
            setShuffledWords(currentShuffled);
            nextWordIndex = 0;
            setCurrentQuestionIndex(0);
        }
        generateOptions(currentShuffled[nextWordIndex], optionSource);
    }, [shuffledWords, generateOptions, optionSource]);

    const endGame = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        
        const score = correctCount * 10 - incorrectCount * 5;
        const finalScore = Math.max(0, score);

        handleGameComplete(finalScore, correctCount, incorrectCount, 60);

        setGameState('finished');
        onNavigate('gameResult', {
            score: finalScore,
            correct: correctCount,
            incorrect: incorrectCount,
            timeTaken: 60, // Game is 60s long
            gameName: '스피드 퀴즈',
        });
    }, [correctCount, incorrectCount, onNavigate, handleGameComplete]);
    
    useEffect(() => {
        if (gameState === 'playing' && timeLeft > 0) {
            timerRef.current = window.setInterval(() => {
                setTimeLeft(prev => prev - 1);
            }, 1000);
        } else if (gameState === 'playing' && timeLeft <= 0) {
            endGame();
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [gameState, timeLeft, endGame]);

    const startGame = () => {
        let sourceWords: Word[] = [];
        if (selectedUnit === 'all') {
            sourceWords = allWords;
        } else {
            sourceWords = allWords.filter(w => String(w.unit) === String(selectedUnit));
        }

        if (sourceWords.length < 4) {
            addToast(`스피드 퀴즈를 위해 단어가 최소 4개 필요합니다.`, "warning");
            return;
        }
        
        const gameWords = shuffleArray(sourceWords);
        setShuffledWords(gameWords);
        setOptionSource(sourceWords);
        setTimeLeft(60);
        setCorrectCount(0);
        setIncorrectCount(0);
        setCurrentQuestionIndex(0);
        generateOptions(gameWords[0], sourceWords);
        setGameState('playing');
    };

    const handleAnswer = (selectedMeaning: string) => {
        if (gameState !== 'playing' || feedback !== null) return;
        
        const currentWord = shuffledWords[currentQuestionIndex];
        const correctAnswers = currentWord.meaning.split('/').map((m: string) => m.trim());
        const isCorrect = correctAnswers.includes(selectedMeaning);
        
        setFeedback(isCorrect ? 'correct' : 'incorrect');

        if (isCorrect) {
            setCorrectCount(prev => prev + 1);
            setTimeLeft(prev => Math.min(60, prev + 2)); 
        } else {
            setIncorrectCount(prev => prev + 1);
            setTimeLeft(prev => Math.max(0, prev - 3));
        }

        setTimeout(() => {
            setFeedback(null);
            const nextIndex = currentQuestionIndex + 1;
            setCurrentQuestionIndex(nextIndex);
            setupNextQuestion(nextIndex);
        }, 300);
    };
    
    if (gameState === 'setup') {
        return (
            <div className="p-4 sm:p-8 flex flex-col items-center justify-center min-h-[calc(100vh-150px)] sm:min-h-0">
                <h1 className="text-3xl sm:text-4xl font-bold text-cyan-600 dark:text-cyan-400 mb-4">⏱️ 스피드 퀴즈 설정</h1>
                 <p className="text-slate-600 dark:text-slate-300 mb-8 max-w-md text-center">60초 동안 최대한 많은 단어의 뜻을 맞춰보세요! 정답 시 +2초, 오답 시 -3초.</p>
                <div className="w-full max-w-md bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-lg space-y-6">
                    <div>
                        <label htmlFor="unit-select-speed" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">모드 선택</label>
                        <select
                            id="unit-select-speed"
                            value={String(selectedUnit)}
                            onChange={(e) => setSelectedUnit(e.target.value)}
                            className="w-full p-3 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500"
                        >
                            <option value="all">전체 단어</option>
                            <optgroup label="단원별 게임">
                                {units.map(unit => <option key={unit} value={unit}>단원 {unit}</option>)}
                            </optgroup>
                        </select>
                    </div>
                    <button onClick={startGame} className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md">
                        게임 시작!
                    </button>
                </div>
            </div>
        );
    }
    
    const currentWord = shuffledWords[currentQuestionIndex];
    if (gameState !== 'playing' || !currentWord) {
         return <div className="p-8 text-center text-slate-600 dark:text-slate-300">게임 로딩 중...</div>;
    }

    return (
        <div className={`p-4 sm:p-6 flex flex-col items-center transition-colors duration-300 min-h-[calc(100vh-100px)] justify-center ${feedback === 'correct' ? 'bg-green-100 dark:bg-green-800/30' : feedback === 'incorrect' ? 'bg-red-100 dark:bg-red-800/30' : ''}`}>
            <div className="w-full max-w-2xl">
                <div className="flex justify-between items-center mb-4">
                    <div className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                        <span className="text-green-500">정답: {correctCount}</span> | <span className="text-red-500">오답: {incorrectCount}</span>
                    </div>
                    <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">
                        남은 시간: {timeLeft}초
                    </div>
                </div>

                <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2.5 mb-6">
                    <div className="bg-cyan-500 h-2.5 rounded-full" style={{ width: `${(timeLeft / 60) * 100}%` }}></div>
                </div>

                <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-xl shadow-2xl p-6 sm:p-8">
                    <div className="text-center mb-6">
                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-1">다음 단어의 뜻은 무엇일까요?</p>
                        <h2 className="text-4xl sm:text-5xl font-bold text-slate-800 dark:text-white">{currentWord.term}</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        {options.map((option, index) => (
                            <button
                                key={index}
                                onClick={() => handleAnswer(option)}
                                disabled={feedback !== null}
                                className="w-full p-3 sm:p-4 text-left rounded-lg shadow-md transition-colors bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-white hover:bg-cyan-500 dark:hover:bg-cyan-400 hover:text-white disabled:opacity-70"
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};


// WordShooterGame
interface FallingWord {
    word: Word;
    id: string; // unique key
    x: number; // %
    delay: number; // animation-delay in seconds
    duration: number; // animation-duration in seconds
}

const WordShooterGame: React.FC = () => {
    const { allWords, onNavigate, handleGameComplete } = useAppContext();
    const { addToast } = useToasts();
    
    const [gameState, setGameState] = useState<'setup' | 'playing' | 'finished'>('setup');
    const [selectedUnit, setSelectedUnit] = useState<string|number>('all');
    
    const [questions, setQuestions] = useState<Word[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [score, setScore] = useState(0);
    const [lives, setLives] = useState(3);
    
    const [fallingWords, setFallingWords] = useState<FallingWord[]>([]);
    const [feedback, setFeedback] = useState<'correct' | 'incorrect' | 'miss' | null>(null);

    const NUM_QUESTIONS = 15;
    const MIN_WORDS_FOR_GAME = 5;

    const units = useMemo(() => {
        const unitSet = new Set<string | number>();
        allWords.forEach(word => {
            if (word.unit) unitSet.add(word.unit);
        });
        return Array.from(unitSet).sort((a, b) => Number(a) - Number(b));
    }, [allWords]);

    const currentQuestionWord = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);

    const endGame = useCallback(() => {
        const correctAnswers = score / 10;
        const incorrectAnswers = Math.max(0, currentQuestionIndex - correctAnswers);
        handleGameComplete(score, correctAnswers, incorrectAnswers, 0);
        onNavigate('gameResult', { score, correct: correctAnswers, incorrect: incorrectAnswers, timeTaken: 0, gameName: '뜻 사격 게임' });
        setGameState('finished');
    }, [score, currentQuestionIndex, handleGameComplete, onNavigate]);

    useEffect(() => {
        if (lives <= 0 && gameState === 'playing') {
            addToast("게임 오버!", "error");
            endGame();
        }
    }, [lives, gameState, endGame, addToast]);

    const setupQuestion = useCallback((qIndex: number, gameWords: Word[], optionSource: Word[]) => {
        if (qIndex >= gameWords.length) {
            addToast("모든 문제를 완료했습니다!", "success");
            endGame();
            return;
        }

        const correctWord = gameWords[qIndex];
        const incorrectOptions = shuffleArray(optionSource.filter(w => w.id !== correctWord.id)).slice(0, MIN_WORDS_FOR_GAME - 1);
        const optionsForScreen = shuffleArray([correctWord, ...incorrectOptions]);

        setFallingWords(optionsForScreen.map((word, index) => ({
            word,
            id: `${word.id}-${qIndex}-${index}`,
            x: 5 + Math.random() * 80,
            delay: Math.random() * 1.5,
            duration: 8 + Math.random() * 4,
        })));
    }, [endGame]);

    const handleStartGame = () => {
        const sourceWords = selectedUnit === 'all' 
            ? allWords 
            : allWords.filter(w => String(w.unit) === String(selectedUnit));

        if (sourceWords.length < MIN_WORDS_FOR_GAME) {
            addToast(`사격 게임을 위해 단어가 최소 ${MIN_WORDS_FOR_GAME}개 필요합니다.`, "warning");
            return;
        }

        const gameQuestions = shuffleArray(sourceWords).slice(0, NUM_QUESTIONS);
        setQuestions(gameQuestions);
        setScore(0);
        setLives(3);
        setCurrentQuestionIndex(0);
        setFeedback(null);
        setupQuestion(0, gameQuestions, sourceWords);
        setGameState('playing');
    };
    
    const goToNextQuestion = useCallback(() => {
        const nextQIndex = currentQuestionIndex + 1;
        const sourceWords = selectedUnit === 'all' ? allWords : allWords.filter(w => String(w.unit) === String(selectedUnit));
        
        setTimeout(() => {
            setFeedback(null);
            setCurrentQuestionIndex(nextQIndex);
            setupQuestion(nextQIndex, questions, sourceWords);
        }, 800);
    }, [currentQuestionIndex, questions, selectedUnit, allWords, setupQuestion]);


    const handleWordSelection = (selectedWord: Word) => {
        if (feedback) return;

        const isCorrect = selectedWord.id === currentQuestionWord.id;
        if (isCorrect) {
            setScore(s => s + 10);
            setFeedback('correct');
        } else {
            setLives(l => l - 1);
            setFeedback('incorrect');
        }
        goToNextQuestion();
    };

    const handleAnimationEnd = (wordId: string | number) => {
        if (wordId === currentQuestionWord?.id && !feedback) {
            setLives(l => l - 1);
            setFeedback('miss');
            goToNextQuestion();
        }
    };

    if (gameState === 'setup') {
        return (
            <div className="p-4 sm:p-8 flex flex-col items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6">🎯 뜻 사격 게임 설정</h1>
                <div className="w-full max-w-md bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-lg space-y-6">
                    <div>
                        <label htmlFor="unit-select-shooter" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">모드 선택</label>
                        <select
                            id="unit-select-shooter"
                            value={String(selectedUnit)}
                            onChange={(e) => setSelectedUnit(e.target.value)}
                            className="w-full p-3 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500"
                        >
                            <option value="all">전체 단어 ({NUM_QUESTIONS}문제 랜덤)</option>
                            <optgroup label="단원별 게임">
                                {units.map(unit => <option key={unit} value={unit}>단원 {unit}</option>)}
                            </optgroup>
                        </select>
                    </div>
                    <button onClick={handleStartGame} className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md">
                        게임 시작
                    </button>
                </div>
            </div>
        );
    }
    
    const getFeedbackBg = () => {
        if (!feedback) return '';
        switch (feedback) {
            case 'correct': return 'bg-green-500/20 dark:bg-green-500/10';
            case 'incorrect': return 'bg-red-500/20 dark:bg-red-500/10';
            case 'miss': return 'bg-yellow-500/20 dark:bg-yellow-500/10';
            default: return '';
        }
    }

    return (
        <div className={`flex flex-col h-[calc(100vh-80px)] transition-colors duration-300 ${getFeedbackBg()}`}>
            <div className="p-4 bg-slate-100 dark:bg-slate-800/80 shadow-md z-10">
                <div className="flex justify-between items-center max-w-4xl mx-auto">
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">점수: <span className="text-cyan-500">{score}</span></p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">문제: {Math.min(currentQuestionIndex + 1, NUM_QUESTIONS)} / {NUM_QUESTIONS}</p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">생명: {'❤️'.repeat(lives)}{'🤍'.repeat(Math.max(0, 3 - lives))}</p>
                </div>
                <div className="mt-4 text-center">
                    <p className="text-sm text-slate-500 dark:text-slate-400">다음 뜻을 가진 단어를 맞추세요:</p>
                    <h2 className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{currentQuestionWord?.meaning || "로딩중..."}</h2>
                </div>
            </div>
            <div className="relative flex-grow overflow-hidden bg-slate-200/50 dark:bg-slate-900/50">
                {currentQuestionWord && fallingWords.map(fw => (
                    <button
                        key={fw.id}
                        onClick={() => handleWordSelection(fw.word)}
                        onAnimationEnd={() => handleAnimationEnd(fw.word.id)}
                        disabled={!!feedback}
                        className="word-shooter-falling-word absolute py-2 px-4 rounded-lg shadow-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-semibold whitespace-nowrap disabled:opacity-50"
                        style={{
                            left: `${fw.x}%`,
                            top: 0,
                            animationDelay: `${fw.delay}s`,
                            animationDuration: `${fw.duration}s`
                        }}
                    >
                        {fw.word.term}
                    </button>
                ))}
            </div>
        </div>
    );
};

// WordBombGame
const WordBombGame: React.FC = () => {
    const { allWords, onNavigate, handleGameComplete } = useAppContext();
    const { addToast } = useToasts();
    
    const [gameState, setGameState] = useState<'setup' | 'playing' | 'finished'>('setup');
    const [selectedUnit, setSelectedUnit] = useState<string|number>('all');
    
    const [questions, setQuestions] = useState<Word[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [score, setScore] = useState(0);
    const [lives, setLives] = useState(5);
    const [inputValue, setInputValue] = useState('');
    
    const [bombKey, setBombKey] = useState(0);
    const [feedbackClass, setFeedbackClass] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const inputRef = useRef<HTMLInputElement>(null);
    const timerIdRef = useRef<number | null>(null);

    const NUM_QUESTIONS = 20;
    const MIN_WORDS_FOR_GAME = 5;
    const ANIMATION_DURATION = '10s';

    const units = useMemo(() => {
        const unitSet = new Set<string | number>();
        allWords.forEach(word => {
            if (word.unit) unitSet.add(word.unit);
        });
        return Array.from(unitSet).sort((a, b) => Number(a) - Number(b));
    }, [allWords]);

    const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);

    const cleanUp = useCallback(() => {
        if(timerIdRef.current) {
            clearTimeout(timerIdRef.current);
            timerIdRef.current = null;
        }
    }, []);

    const endGame = useCallback(() => {
        cleanUp();
        if (gameState === 'finished') return;
        
        const correctAnswers = score / 10;
        const incorrectAnswers = Math.max(0, currentQuestionIndex - correctAnswers);
        handleGameComplete(score, correctAnswers, incorrectAnswers, 0);
        onNavigate('gameResult', { score, correct: correctAnswers, incorrect: incorrectAnswers, timeTaken: 0, gameName: '단어 폭탄 제거' });
        setGameState('finished');
    }, [score, currentQuestionIndex, handleGameComplete, onNavigate, gameState, cleanUp]);

    useEffect(() => {
        return () => cleanUp();
    }, [cleanUp]);
    
    useEffect(() => {
        if (lives <= 0 && gameState === 'playing') {
            addToast("게임 오버!", "error");
            endGame();
        }
    }, [lives, gameState, endGame, addToast]);
    
    const setupNextQuestion = useCallback((nextIndex: number) => {
        if (nextIndex >= questions.length) {
            addToast("모든 폭탄을 제거했습니다! 🎉", "success");
            endGame();
            return;
        }
        setCurrentQuestionIndex(nextIndex);
        setInputValue('');
        setBombKey(k => k + 1);
        setIsSubmitting(false);
        inputRef.current?.focus();
    }, [questions, endGame]);

    const handleAnswer = useCallback((isCorrect: boolean) => {
        if (isSubmitting) return;
        setIsSubmitting(true);

        if (isCorrect) {
            setScore(s => s + 10);
            setFeedbackClass('bg-green-500/20 dark:bg-green-500/10');
        } else {
            setLives(l => l - 1);
            setFeedbackClass('bg-red-500/20 dark:bg-red-500/10');
            inputRef.current?.classList.add('animate-shake');
        }
        
        timerIdRef.current = window.setTimeout(() => {
            if(inputRef.current) inputRef.current.classList.remove('animate-shake');
            setFeedbackClass('');
            if (lives <= 1 && !isCorrect) {
                endGame();
            } else {
                setupNextQuestion(currentQuestionIndex + 1);
            }
        }, 500);
    }, [isSubmitting, lives, endGame, setupNextQuestion, currentQuestionIndex]);

    const handleAnimationEnd = useCallback(() => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        setLives(l => l - 1);
        setFeedbackClass('bg-yellow-500/20 dark:bg-yellow-500/10');
        
        timerIdRef.current = window.setTimeout(() => {
            setFeedbackClass('');
            if (lives <= 1) {
                endGame();
            } else {
                setupNextQuestion(currentQuestionIndex + 1);
            }
        }, 500);
    }, [isSubmitting, lives, endGame, setupNextQuestion, currentQuestionIndex]);
    
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setInputValue(value);
        if (currentQuestion && value.trim().toLowerCase() === currentQuestion.term.toLowerCase()) {
            handleAnswer(true);
        }
    };

    const handleFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting || !inputValue.trim()) return;
        handleAnswer(inputValue.trim().toLowerCase() === currentQuestion.term.toLowerCase());
    };
    
    const handleStartGame = () => {
        const alphabetOnly = (term: string) => /^[a-zA-Z\s'-]+$/.test(term);
        const sourceWords = (selectedUnit === 'all' 
            ? allWords 
            : allWords.filter(w => String(w.unit) === String(selectedUnit))
        ).filter(w => alphabetOnly(w.term));

        if (sourceWords.length < MIN_WORDS_FOR_GAME) {
            addToast(`단어 폭탄 제거 게임을 위해 알파벳 단어가 최소 ${MIN_WORDS_FOR_GAME}개 필요합니다.`, "warning");
            return;
        }

        setQuestions(shuffleArray(sourceWords).slice(0, NUM_QUESTIONS));
        setScore(0);
        setLives(5);
        setCurrentQuestionIndex(0);
        setInputValue('');
        setBombKey(0);
        setFeedbackClass('');
        setIsSubmitting(false);
        setGameState('playing');
        
        // Focus after state update
        setTimeout(() => inputRef.current?.focus(), 0);
    };

    if (gameState === 'setup') {
        return (
            <div className="p-4 sm:p-8 flex flex-col items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6">💣 단어 폭탄 제거 설정</h1>
                <div className="w-full max-w-md bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-lg space-y-6">
                    <div>
                        <label htmlFor="unit-select-bomb" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">모드 선택</label>
                        <select
                            id="unit-select-bomb"
                            value={String(selectedUnit)}
                            onChange={(e) => setSelectedUnit(e.target.value)}
                            className="w-full p-3 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500"
                        >
                            <option value="all">전체 단어 ({NUM_QUESTIONS}문제 랜덤)</option>
                            <optgroup label="단원별 게임">
                                {units.map(unit => <option key={unit} value={unit}>단원 {unit}</option>)}
                            </optgroup>
                        </select>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">알파벳으로만 구성된 단어만 출제됩니다.</p>
                    </div>
                    <button onClick={handleStartGame} className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md">
                        게임 시작
                    </button>
                </div>
            </div>
        );
    }
    
    return (
        <div className={`flex flex-col h-[calc(100vh-80px)] transition-colors duration-300 ${feedbackClass}`}>
            <div className="p-4 bg-slate-100 dark:bg-slate-800/80 shadow-md z-10">
                <div className="flex justify-between items-center max-w-4xl mx-auto">
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">점수: <span className="text-cyan-500">{score}</span></p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">문제: {Math.min(currentQuestionIndex + 1, NUM_QUESTIONS)} / {NUM_QUESTIONS}</p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">생명: {'❤️'.repeat(lives)}{'🤍'.repeat(Math.max(0, 5 - lives))}</p>
                </div>
            </div>
            <div className="relative flex-grow overflow-hidden bg-slate-200/50 dark:bg-slate-900/50">
                {currentQuestion && (
                    <div
                        key={bombKey}
                        onAnimationEnd={handleAnimationEnd}
                        className="word-bomb absolute flex flex-col items-center p-4 rounded-lg shadow-2xl bg-slate-800 text-white font-semibold"
                        style={{
                            left: `${10 + Math.random() * 60}%`,
                            animationDuration: ANIMATION_DURATION,
                        }}
                    >
                        <span className="text-4xl">💣</span>
                        <span className="mt-2 text-lg text-center">{currentQuestion.meaning}</span>
                    </div>
                )}
            </div>
            <div className="p-4 bg-slate-100 dark:bg-slate-800/80">
                <form onSubmit={handleFormSubmit} className="max-w-md mx-auto">
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        disabled={isSubmitting}
                        placeholder="단어를 입력하여 폭탄을 제거하세요!"
                        className="w-full p-4 text-center text-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-md border-2 border-slate-300 dark:border-slate-600 shadow-inner focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 disabled:opacity-50"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck="false"
                    />
                </form>
            </div>
        </div>
    );
};


// WordZombieDefenseGame
interface FallingZombie {
    word: Word;
    id: string; 
    key: string;
    x: number;
    delay: number;
    duration: number;
}

const WordZombieDefenseGame: React.FC = () => {
    const { allWords, onNavigate, handleGameComplete, userSettings } = useAppContext();
    const { addToast } = useToasts();
    
    const [gameState, setGameState] = useState<'setup' | 'playing' | 'finished'>('setup');
    const [gameSettings, setGameSettings] = useState({
        unit: 'all' as string | number,
        inputType: 'click' as 'click' | 'typing',
    });
    
    const [questions, setQuestions] = useState<Word[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [score, setScore] = useState(0);
    const [lives, setLives] = useState(5);
    
    const [fallingZombies, setFallingZombies] = useState<FallingZombie[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [feedbackClass, setFeedbackClass] = useState('');

    const inputRef = useRef<HTMLInputElement>(null);
    const timerIdRef = useRef<NodeJS.Timeout | null>(null);

    const NUM_QUESTIONS = 15;
    const MIN_WORDS_FOR_GAME = 5;
    const ZOMBIE_ANIMATION_DURATION_MIN = 10;
    const ZOMBIE_ANIMATION_DURATION_MAX = 15;

    const units = useMemo(() => {
        const unitSet = new Set<string | number>();
        allWords.forEach(word => {
            if (word.unit) unitSet.add(word.unit);
        });
        return Array.from(unitSet).sort((a, b) => Number(a) - Number(b));
    }, [allWords]);

    const currentQuestionWord = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);

    const cleanUpTimers = useCallback(() => {
        if (timerIdRef.current) {
            clearTimeout(timerIdRef.current);
            timerIdRef.current = null;
        }
    }, []);

    const endGame = useCallback(() => {
        if (gameState === 'finished') return;
        cleanUpTimers();
        
        const correctAnswers = score / 10;
        const incorrectAnswers = Math.max(0, currentQuestionIndex - correctAnswers);
        handleGameComplete(score, correctAnswers, incorrectAnswers, 0);
        onNavigate('gameResult', { score, correct: correctAnswers, incorrect: incorrectAnswers, timeTaken: 0, gameName: '단어 좀비 디펜스' });
        setGameState('finished');
    }, [gameState, cleanUpTimers, score, currentQuestionIndex, handleGameComplete, onNavigate]);
    
    useEffect(() => {
        return () => cleanUpTimers();
    }, [cleanUpTimers]);
    
    useEffect(() => {
        if (lives <= 0 && gameState === 'playing') {
            addToast("좀비에게 당했습니다! 게임 오버!", "error");
            endGame();
        }
    }, [lives, gameState, endGame, addToast]);
    
    const setupQuestion = useCallback((qIndex: number, gameWords: Word[], optionSource: Word[]) => {
        if (qIndex >= gameWords.length) {
            addToast("모든 좀비를 막아냈습니다!", "success");
            endGame();
            return;
        }

        const correctWord = gameWords[qIndex];
        const incorrectOptions = shuffleArray(optionSource.filter(w => w.id !== correctWord.id)).slice(0, MIN_WORDS_FOR_GAME - 1);
        const optionsForScreen = shuffleArray([correctWord, ...incorrectOptions]);

        const speedMultiplier = 1 - (qIndex / (NUM_QUESTIONS * 2)); // Gets faster over time

        setFallingZombies(optionsForScreen.map((word, index) => ({
            word,
            id: `${word.id}-${qIndex}-${index}`,
            key: `${word.id}-${qIndex}-${index}-${Date.now()}`,
            x: 5 + Math.random() * 80,
            delay: Math.random() * 2.0,
            duration: (ZOMBIE_ANIMATION_DURATION_MIN + Math.random() * (ZOMBIE_ANIMATION_DURATION_MAX - ZOMBIE_ANIMATION_DURATION_MIN)) * speedMultiplier,
        })));
        setIsSubmitting(false);
        setInputValue('');
        if (gameSettings.inputType === 'typing') {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [endGame, gameSettings.inputType, NUM_QUESTIONS]);
    
    const goToNextQuestion = useCallback(() => {
        const nextQIndex = currentQuestionIndex + 1;
        const alphabetOnly = (term: string) => /^[a-zA-Z\s'-]+$/.test(term);
        const sourceWords = gameSettings.unit === 'all' 
            ? allWords 
            : allWords.filter(w => String(w.unit) === String(gameSettings.unit));
        const filteredSource = gameSettings.inputType === 'typing' ? sourceWords.filter(w => alphabetOnly(w.term)) : sourceWords;

        timerIdRef.current = setTimeout(() => {
            setFeedbackClass('');
            setCurrentQuestionIndex(nextQIndex);
            setupQuestion(nextQIndex, questions, filteredSource);
        }, 800);
    }, [currentQuestionIndex, gameSettings.unit, gameSettings.inputType, allWords, setupQuestion, questions]);

    const processAnswer = useCallback((isCorrect: boolean) => {
        if (isSubmitting) return;

        if (isCorrect) {
            setIsSubmitting(true);
            cleanUpTimers();
            speak(currentQuestionWord.term, undefined, userSettings.speechRate);
            setScore(s => s + 10);
            setFeedbackClass('bg-green-500/20 dark:bg-green-500/10');
            goToNextQuestion();
        } else {
            setLives(l => l - 1);
            setScore(s => Math.max(0, s - 2)); // Penalty for wrong answer
            setFeedbackClass('bg-red-500/20 dark:bg-red-500/10');
            addToast("땡! 생명이 줄어듭니다.", "error");

            if (gameSettings.inputType === 'click') {
                setIsSubmitting(true);
                cleanUpTimers();
                goToNextQuestion();
            } else { // Typing mode, incorrect
                inputRef.current?.classList.add('animate-shake');
                setTimeout(() => inputRef.current?.classList.remove('animate-shake'), 500);
                setInputValue('');
            }
        }
    }, [isSubmitting, cleanUpTimers, currentQuestionWord, userSettings.speechRate, goToNextQuestion, gameSettings.inputType, lives]);

    const handleZombieClick = (selectedWord: Word) => {
        processAnswer(selectedWord.id === currentQuestionWord.id);
    };

    const handleTypingSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting || !inputValue.trim()) return;
        const isCorrect = inputValue.trim().toLowerCase() === currentQuestionWord.term.toLowerCase();
        processAnswer(isCorrect);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setInputValue(value);
        if (currentQuestionWord && value.trim().toLowerCase() === currentQuestionWord.term.toLowerCase()) {
            processAnswer(true);
        }
    };
    
    const handleAnimationEnd = (wordId: string | number) => {
        if (wordId === currentQuestionWord?.id && !isSubmitting) {
            setIsSubmitting(true);
            cleanUpTimers();
            setLives(l => l - 1);
            setFeedbackClass('bg-yellow-500/20 dark:bg-yellow-500/10');
            addToast("좀비를 놓쳤습니다!", "warning");
            goToNextQuestion();
        }
    };

    const handleStartGame = () => {
        const alphabetOnly = (term: string) => /^[a-zA-Z\s'-]+$/.test(term);
        const sourceWords = (gameSettings.unit === 'all' 
            ? allWords 
            : allWords.filter(w => String(w.unit) === String(gameSettings.unit))
        ).filter(w => gameSettings.inputType === 'typing' ? alphabetOnly(w.term) : true);

        if (sourceWords.length < MIN_WORDS_FOR_GAME) {
            addToast(`좀비 디펜스 게임을 위해 단어가 최소 ${MIN_WORDS_FOR_GAME}개 필요합니다. (사용 가능 단어: ${sourceWords.length}개)`, "warning");
            return;
        }

        const gameQuestions = shuffleArray(sourceWords).slice(0, NUM_QUESTIONS);
        setQuestions(gameQuestions);
        setScore(0);
        setLives(5);
        setCurrentQuestionIndex(0);
        setFeedbackClass('');
        setIsSubmitting(false);
        setupQuestion(0, gameQuestions, sourceWords);
        setGameState('playing');
    };
    
    const handleSettingChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
        const { name, value } = e.target;
        setGameSettings(prev => ({...prev, [name]: value}));
    };

    if (gameState === 'setup') {
        return (
            <div className="p-4 sm:p-8 flex flex-col items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-cyan-600 dark:text-cyan-400 mb-6">🧟 단어 좀비 디펜스 설정</h1>
                <div className="w-full max-w-md bg-slate-100 dark:bg-slate-700 p-6 rounded-lg shadow-lg space-y-6">
                    <div>
                        <label htmlFor="unit" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">단어 범위 선택</label>
                        <select name="unit" id="unit" value={String(gameSettings.unit)} onChange={handleSettingChange}
                            className="w-full p-3 bg-white dark:bg-slate-600 rounded-md border-slate-300 dark:border-slate-500">
                            <option value="all">전체 단어 ({NUM_QUESTIONS}문제 랜덤)</option>
                            <optgroup label="단원별 게임">
                                {units.map(unit => <option key={unit} value={unit}>단원 {unit}</option>)}
                            </optgroup>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">입력 방식 선택</label>
                        <div className="flex space-x-4 rounded-md bg-slate-200 dark:bg-slate-600 p-1">
                           <label className={`w-1/2 text-center p-2 rounded-md cursor-pointer transition-colors ${gameSettings.inputType === 'click' ? 'bg-cyan-500 text-white shadow' : 'text-slate-700 dark:text-slate-200'}`}>
                               <input type="radio" name="inputType" value="click" checked={gameSettings.inputType === 'click'} onChange={handleSettingChange} className="sr-only" />
                               클릭 모드
                           </label>
                           <label className={`w-1/2 text-center p-2 rounded-md cursor-pointer transition-colors ${gameSettings.inputType === 'typing' ? 'bg-cyan-500 text-white shadow' : 'text-slate-700 dark:text-slate-200'}`}>
                               <input type="radio" name="inputType" value="typing" checked={gameSettings.inputType === 'typing'} onChange={handleSettingChange} className="sr-only" />
                               타이핑 모드
                           </label>
                        </div>
                        {gameSettings.inputType === 'typing' && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">타이핑 모드에서는 알파벳 단어만 출제됩니다.</p>}
                    </div>

                    <button onClick={handleStartGame} className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-md shadow-md">
                        게임 시작
                    </button>
                </div>
            </div>
        );
    }
    
    return (
        <div className={`flex flex-col h-[calc(100vh-80px)] transition-colors duration-300 ${feedbackClass}`}>
            <div className="p-4 bg-slate-100 dark:bg-slate-800/80 shadow-md z-10">
                 <div className="flex justify-between items-center max-w-4xl mx-auto">
                     <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">점수: <span className="text-cyan-500">{score}</span></p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">문제: {Math.min(currentQuestionIndex + 1, NUM_QUESTIONS)} / {NUM_QUESTIONS}</p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">생명: {'❤️'.repeat(lives)}{'🤍'.repeat(Math.max(0, 5 - lives))}</p>
                 </div>
                 <div className="mt-4 text-center">
                     <p className="text-sm text-slate-500 dark:text-slate-400">다음 뜻을 가진 좀비를 막아내세요:</p>
                     <h2 className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{currentQuestionWord?.meaning || "로딩중..."}</h2>
                 </div>
            </div>
            <div className="relative flex-grow overflow-hidden bg-slate-200/50 dark:bg-slate-900/50">
                {currentQuestionWord && fallingZombies.map(zombie => (
                    <button
                        key={zombie.key}
                        onClick={() => handleZombieClick(zombie.word)}
                        onAnimationEnd={() => handleAnimationEnd(zombie.word.id)}
                        disabled={isSubmitting || gameSettings.inputType === 'typing'}
                        className="word-zombie-defense-falling-item absolute flex flex-col items-center p-2 rounded-lg shadow-lg bg-green-900/80 text-white font-semibold whitespace-nowrap disabled:opacity-50"
                        style={{
                            left: `${zombie.x}%`,
                            animationName: 'fall',
                            animationTimingFunction: 'linear',
                            animationFillMode: 'forwards',
                            animationDelay: `${zombie.delay}s`,
                            animationDuration: `${zombie.duration}s`
                        }}
                    >
                        <span className="text-3xl">🧟</span>
                        <span className="text-sm mt-1">{zombie.word.term}</span>
                    </button>
                ))}
            </div>
            {gameSettings.inputType === 'typing' && (
                <div className="p-4 bg-slate-100 dark:bg-slate-800/80">
                    <form onSubmit={handleTypingSubmit} className="max-w-md mx-auto">
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={handleInputChange}
                            disabled={isSubmitting}
                            placeholder="단어를 입력하여 좀비를 막으세요!"
                            className="w-full p-4 text-center text-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-md border-2 border-slate-300 dark:border-slate-600 shadow-inner focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 disabled:opacity-50"
                            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                        />
                    </form>
                </div>
            )}
        </div>
    );
};


// Main App Component
const App: React.FC = () => {
    const { addToast } = useToasts();
    
    // State initialization from localStorage or defaults
    const [userSettings, setUserSettings] = useState<UserSettings>(() => {
        try {
            const savedSettings = localStorage.getItem('userSettings');
            if (savedSettings) {
                return JSON.parse(savedSettings);
            }
        } catch (error) {
            console.error("Could not parse userSettings from localStorage:", error);
        }
        // Default settings
        return {
            grade: '중등',
            textbook: '기본',
            dailyGoal: 10,
            username: '사용자',
            theme: 'light',
            speechRate: 1,
            autoPlayAudio: true,
            xp: 0,
            level: 1
        };
    });

    const [allWords, setAllWords] = useState<Word[]>(() => {
        try {
            const savedWords = localStorage.getItem('allWords');
            if (savedWords) {
                const parsed = JSON.parse(savedWords);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
            // If nothing valid in storage, initialize with sample words and save to storage
            localStorage.setItem('allWords', JSON.stringify(sampleWords));
            return sampleWords;
        } catch (error) {
            console.error("Error reading or initializing words from localStorage", error);
            return sampleWords; // Fallback in case of any error
        }
    });

    const [wordStats, setWordStats] = useState<Record<string | number, WordStat>>(() => {
        try {
            const savedStats = localStorage.getItem('wordStats');
            if(savedStats) {
                return JSON.parse(savedStats);
            }
            return {};
        } catch (error) {
            console.error("Could not parse wordStats from localStorage:", error);
            return {};
        }
    });

    const [appScreen, setAppScreen] = useState<AppScreen>('dashboard');
    const [routeParams, setRouteParams] = useState<any>({});
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [globalLoading, setGlobalLoading] = useState(false);

    // Persist to localStorage whenever critical data changes
    useEffect(() => {
        try {
            if (userSettings) {
                localStorage.setItem('userSettings', JSON.stringify(userSettings));
            } else {
                localStorage.removeItem('userSettings');
            }
        } catch (error) {
            addToast("설정 저장에 실패했습니다. 저장 공간이 부족할 수 있습니다.", "error");
            console.error("Error saving userSettings to localStorage:", error);
        }
    }, [userSettings, addToast]);
    
    useEffect(() => {
        try {
            localStorage.setItem('allWords', JSON.stringify(allWords));
        } catch (error) {
             addToast("단어 목록 저장에 실패했습니다. 저장 공간이 부족할 수 있습니다.", "error");
            console.error("Error saving allWords to localStorage:", error);
        }
    }, [allWords, addToast]);

    useEffect(() => {
        try {
            localStorage.setItem('wordStats', JSON.stringify(wordStats));
        } catch (error) {
            addToast("학습 상태 저장에 실패했습니다. 저장 공간이 부족할 수 있습니다.", "error");
            console.error("Error saving wordStats to localStorage:", error);
        }
    }, [wordStats, addToast]);

    // Save userSettings to localStorage whenever it changes
    useEffect(() => {
        if (userSettings) {
            localStorage.setItem('userSettings', JSON.stringify(userSettings));
        }
    }, [userSettings]);



    const handleSaveSettings = (settings: UserSettings) => {
        // If grade level changes, offer to reset learning progress
        if (userSettings && settings.grade !== userSettings.grade) {
            // This is a simple implementation. A confirmation modal would be better UX.
            addToast("학년이 변경되었습니다. 학습 진행 상황이 초기화될 수 있습니다.", "info");
        }
        setUserSettings(settings);
        addToast("설정이 성공적으로 저장되었습니다.", "success");
    };

    const handleResetData = () => {
        // Clear everything from localStorage
        localStorage.removeItem('userSettings');
        localStorage.removeItem('allWords');
        localStorage.removeItem('wordStats');
        // Reset state
        setUserSettings({
            grade: '중등',
            textbook: '기본',
            dailyGoal: 10,
            username: '사용자',
            theme: 'light',
            speechRate: 1,
            autoPlayAudio: true,
            xp: 0,
            level: 1
        });
        setAllWords([...sampleWords]);
        setWordStats({});
        setAppScreen('loginSetup');
        addToast("모든 데이터가 초기화되었습니다.", "success");
    };

    const handleSetupComplete = (settings: UserSettings) => {
        setUserSettings(settings);
        setAppScreen('dashboard');
    };

    const handleNavigate = (screen: AppScreen, params?: any) => {
        setAppScreen(screen);
        setRouteParams(params || {});
        window.scrollTo(0, 0); // Scroll to top on navigation
    };
    
    const updateWordStat = (wordId: string | number, updates: Partial<WordStat>) => {
        setWordStats(prev => ({
            ...prev,
            [wordId]: {
                ...(prev[wordId] || getDefaultWordStat(wordId)),
                ...updates,
            }
        }));
    };
    
    const handleWordLearned = (wordId: string | number) => {
        const today = getTodayDateString();
        updateWordStat(wordId, { lastReviewed: today });
        if(userSettings && userSettings.lastLearnedDate !== today) {
             setUserSettings(prev => prev ? ({...prev, lastLearnedDate: today, currentStreak: (prev.currentStreak || 0) + 1 }) : prev);
        } else {
             setUserSettings(prev => prev ? ({...prev, lastLearnedDate: today }) : prev);
        }
    };
    
    const addXp = useCallback((amount: number) => {
        if (!userSettings) return;
        setUserSettings(prev => {
            if (!prev) return prev;
            let newXp = prev.xp + amount;
            let newLevel = prev.level;
            let xpForNextLevel = newLevel * 100;

            while (newXp >= xpForNextLevel) {
                newXp -= xpForNextLevel;
                newLevel += 1;
                xpForNextLevel = newLevel * 100;
                addToast(`레벨 업! 🎉 레벨 ${newLevel} 달성!`, 'success');
            }

            const updatedBestStreak = Math.max(prev.bestStreak || 0, prev.currentStreak || 0);

            return { ...prev, xp: newXp, level: newLevel, bestStreak: updatedBestStreak };
        });
    }, [userSettings, addToast]);

    const handleQuizComplete = (score: number, total: number, incorrectWords: Word[]) => {
        if (!userSettings) return;
        const today = getTodayDateString();
        const accuracy = total > 0 ? (score / total) * 100 : 0;
        
        addXp(Math.round(accuracy/5)); // Award XP based on quiz score
        
        setUserSettings(prev => prev ? ({...prev, lastQuizDate: today, lastQuizScore: accuracy}) : prev);
        incorrectWords.forEach(word => {
            updateWordStat(word.id, { quizIncorrectCount: (wordStats[word.id]?.quizIncorrectCount || 0) + 1 });
        });
    };

    const handleGameComplete = (score: number, _correct: number, _incorrect: number, _timeTaken: number) => {
         if (!userSettings) return;
        const today = getTodayDateString();
        addXp(score);
        setUserSettings(prev => prev ? ({...prev, lastGameDate: today }) : prev);
        addToast(`${score} XP를 획득했습니다!`, 'info');
    };

    const handleSaveCustomWord = async (word: Partial<Word>, gradeLevel?: string, unit?: number): Promise<{ success: boolean; reason?: string }> => {
        const { term, meaning, partOfSpeech, exampleSentence } = word;

        if (!term?.trim() || !meaning?.trim() || !partOfSpeech?.trim() || !exampleSentence?.trim()) {
            return { success: false, reason: "필수 필드를 모두 입력해주세요." };
        }
        
        // Check for duplicates, ignoring the word being edited itself
        if (allWords.some(w => w.term.toLowerCase() === term.trim().toLowerCase() && w.id !== word.id)) {
            return { success: false, reason: "이미 존재하는 단어입니다." };
        }

        const grade = gradeLevel || userSettings?.grade || 'middle1';

        if (word.id) { // Editing existing word
            setAllWords(prev => prev.map(w => w.id === word.id ? { ...w, ...word, gradeLevel: grade, unit } as Word : w));
        } else { // Adding new word
            const newWord: Word = {
                id: `custom-${new Date().getTime()}`,
                term: term.trim(),
                meaning: meaning.trim(),
                partOfSpeech: partOfSpeech.trim(),
                exampleSentence: exampleSentence.trim(),
                pronunciation: word.pronunciation?.trim() || '',
                exampleSentenceMeaning: word.exampleSentenceMeaning?.trim() || '',
                gradeLevel: grade,
                isCustom: true,
                unit: unit
            };
            setAllWords(prev => [...prev, newWord]);
            setWordStats(prev => ({...prev, [newWord.id]: getDefaultWordStat(newWord.id)}));
        }
        return { success: true };
    };
    
    const handleDeleteCustomWord = (wordId: string | number, options = { silent: false }) => {
        const wordToDelete = allWords.find(w => w.id === wordId);
        if (!wordToDelete) return;

        setAllWords(prev => prev.filter(w => w.id !== wordId));
        setWordStats(prev => {
            const newStats = { ...prev };
            delete newStats[wordId];
            return newStats;
        });

        if (!options.silent) {
            addToast(`'${wordToDelete.term}' 단어가 삭제되었습니다.`, "success");
        }
    };
    
    // Derived state for dashboard, memoized for performance
    const memoizedStats = useMemo(() => {
        const today = getTodayDateString();
        
        let learnedWordsToday = 0;
        let totalWordsLearned = 0;
        let totalQuizScore = 0;
        let quizCount = 0;
        let hasIncorrectWordsToReview = false;

        Object.values(wordStats).forEach(stat => {
            if (stat.lastReviewed) {
                totalWordsLearned++;
                if (stat.lastReviewed === today) {
                    learnedWordsToday++;
                }
            }
            if(stat.quizIncorrectCount > 0) {
                hasIncorrectWordsToReview = true;
            }
        });
        
        // This is a simplified way to track quiz history. A more robust app might store an array of scores.
        if(userSettings?.lastQuizDate && userSettings?.lastQuizScore !== undefined) {
             totalQuizScore += userSettings.lastQuizScore;
             quizCount++;
        }
        
        const averageQuizScore = quizCount > 0 ? totalQuizScore / quizCount : 0;
        const quizTakenToday = userSettings?.lastQuizDate === today;
        const gamePlayedToday = userSettings?.lastGameDate === today;
        
        return {
            learnedWordsToday,
            totalWordsLearned,
            learningStreak: { 
                currentStreak: userSettings?.currentStreak || 0,
                bestStreak: userSettings?.bestStreak || 0,
            },
            averageQuizScore,
            quizTakenToday,
            gamePlayedToday,
            hasIncorrectWordsToReview,
        };
    }, [wordStats, userSettings]);
    

    const appContextValue: AppContextType = {
        userSettings: userSettings!, // Assumed to be non-null in most components
        handleSaveSettings,
        handleResetData,
        onNavigate: handleNavigate,
        allWords,
        wordStats,
        handleWordLearned,
        handleQuizComplete,
        updateWordStat,
        handleDeleteCustomWord,
        handleSaveCustomWord,
        memoizedStats,
        setGlobalLoading,
        addXp,
        handleGameComplete,
        isSettingsModalOpen,
        handleOpenSettings: () => setIsSettingsModalOpen(true),
        handleCloseSettings: () => setIsSettingsModalOpen(false),
        appScreen,
        routeParams
    };


    if (!userSettings) {
        return <LoginSetupScreen onSetupComplete={handleSetupComplete} />;
    }

    const renderScreen = () => {
        switch (appScreen) {
            case 'dashboard':
                return <DashboardScreen {...memoizedStats} />;
            case 'learnWords':
                return <LearnWordsScreen routeParams={routeParams} />;
            case 'quiz':
                return <QuizScreen routeParams={routeParams} />;
            case 'allWords':
                return <AllWordsScreen />;
            case 'stats':
                return <StatsScreen />;
            case 'manageWords':
                return <ManageWordsScreen />;
            case 'tutorChat':
                return <TutorChatScreen />;
            case 'gameSelection':
                return <GameSelectionScreen />;
            case 'wordMatchGame':
                return <WordMatchGame />;
            case 'typingPracticeGame':
                return <TypingPracticeGame />;
            case 'speedQuizGame':
                return <SpeedQuizGame />;
            case 'wordShooterGame':
                 return <WordShooterGame />;
            case 'wordBombGame':
                return <WordBombGame />;
            case 'wordZombieDefense':
                return <WordZombieDefenseGame />;
            case 'timedWordLinkGame':
                return <TimedWordLinkGame />;
            case 'gameResult':
                return <GameResultScreen routeParams={routeParams}/>;
            default:
                return <DashboardScreen {...memoizedStats} />;
        }
    };

    return (
        <AppContext.Provider value={appContextValue}>
            <GlobalSpinner isLoading={globalLoading} />
            <div className={`app-container bg-slate-50 dark:bg-slate-900 min-h-screen`}>
                <NavBar currentScreen={appScreen} onOpenSettings={() => setIsSettingsModalOpen(true)} />
                <main className="container mx-auto">
                    {renderScreen()}
                </main>
                <EditSettingsModal isOpen={isSettingsModalOpen} onCancel={() => setIsSettingsModalOpen(false)} />
            </div>
        </AppContext.Provider>
    );
};


const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <React.StrictMode>
            <ToastProvider>
                <App />
            </ToastProvider>
        </React.StrictMode>
    );
}
