
import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

// 在 Vercel 環境中，如果是純客戶端 ESM，可能需要確保 API_KEY 有正確讀取
// 注意：生產環境建議透過後端轉發以保護 API Key，但此處遵循原架構
const getApiKey = () => {
  return process.env.API_KEY || (window as any)._ENV_?.API_KEY || '';
};

export const generateBigBangQuestions = async (): Promise<Question[]> => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a BIGBANG super-fan (V.I.P). Generate exactly 10 fun and challenging trivia questions about the 4 members: G-Dragon, T.O.P, Taeyang, and Daesung. 
  
  CRITICAL RULES:
  1. DO NOT include any questions or answers related to Seungri.
  2. Every question's answer MUST be one of these four: "G-Dragon", "T.O.P", "Taeyang", or "Daesung".
  3. Focus on funny stories, variety show moments, music records, unique fashion choices, and gossip/secrets.
  4. Ensure the questions are diverse and entertaining.
  5. Provide a short 'funFact' for the host to read.
  
  Return a JSON array of objects with the fields: id (int), text (string), correctAnswer (string), and funFact (string).`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              text: { type: Type.STRING },
              correctAnswer: { type: Type.STRING, description: "Must be one of: G-Dragon, T.O.P, Taeyang, Daesung" },
              funFact: { type: Type.STRING }
            },
            required: ["id", "text", "correctAnswer", "funFact"]
          }
        }
      }
    });

    return JSON.parse(response.text || '[]');
  } catch (error) {
    console.error("Error generating questions:", error);
    return [
      { id: 1, text: "Which member is known for having a massive collection of high-end furniture and once joked his house is like a museum?", correctAnswer: "T.O.P", funFact: "T.O.P's art and chair collection is world-renowned!" },
      { id: 2, text: "Who was famously called the 'Smiling Angel' but is also known for his powerful rock-vocals and trot singing?", correctAnswer: "Daesung", funFact: "Daesung's Japanese solo career as D-Lite is incredibly successful!" },
      { id: 3, text: "Which member released the hit solo 'Eyes, Nose, Lips' which was inspired by his now-wife Min Hyo-rin?", correctAnswer: "Taeyang", funFact: "Taeyang was the first member to get married." },
      { id: 4, text: "Who is the legendary leader of the group, known as the 'King of K-Pop' and a global fashion icon?", correctAnswer: "G-Dragon", funFact: "GD became a trainee at YG when he was only 12 years old." },
      { id: 5, text: "On 'Family Outing', which member was known for his hilarious chemistry with Yoo Jae-suk as the 'Dumb and Dumber' duo?", correctAnswer: "Daesung", funFact: "Daesung was a variety show king in the late 2000s!" },
      { id: 6, text: "Which member has a pet dog named 'Gaho' that became almost as famous as he was during the 'Heartbreaker' era?", correctAnswer: "G-Dragon", funFact: "Gaho is a Shar Pei and has appeared in many music videos." },
      { id: 7, text: "Who is known for his deep bass voice and for being the 'Visual' who loves pink but acts very charismatic on stage?", correctAnswer: "T.O.P", funFact: "T.O.P was an underground rapper named Tempo before BIGBANG." },
      { id: 8, text: "Which member is widely considered the best dancer in the group and is famous for his soulful R&B vocals?", correctAnswer: "Taeyang", funFact: "Taeyang's name means 'Sun' because he wanted to be a bright light for the world." },
      { id: 9, text: "Who famously wrote and produced the mega-hit 'Lies' which was originally intended to be his solo song?", correctAnswer: "G-Dragon", funFact: "GD has over 170 songs registered under his name for royalties." },
      { id: 10, text: "Which member is known to be the most 'modest' and once said he prefers to stay at home rather than go out to clubs?", correctAnswer: "Daesung", funFact: "Daesung is known for his polite and humble personality." }
    ];
  }
};
