
import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

export const generateBigBangQuestions = async (usedQuestions: string[] = [], customKey?: string): Promise<Question[]> => {
  const apiKey = customKey || process.env.API_KEY;

  if (!apiKey) {
    console.warn("[GeminiService] No API Key provided. Switching to fallback.");
    return getFallbackQuestions();
  }

  console.log(`[GeminiService] Attempting to fetch questions with key: ${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`);

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    // 嚴格定義系統指令，確保答案與成員列表完全一致
    const systemInstruction = `你是一位資深的 BIGBANG 專家。請生成 10 題問答題。
    
    規則：
    1. correctAnswer 必須是這四個字串之一："G-Dragon", "T.O.P", "Taeyang", "Daesung"。
    2. 禁止提及「勝利」或任何負面爭議。
    3. 題目類型：綜藝梗、練習生往事、最新活動（2024-2025）、成員特徵。
    4. 排除這些重複題目：${usedQuestions.join('、')}。
    5. 必須返回純粹的 JSON 陣列，不要有 markdown 區塊。`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "請開始生成 10 題全新的 BIGBANG V.I.P 鐵粉考題。",
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              text: { type: Type.STRING },
              correctAnswer: { type: Type.STRING },
              funFact: { type: Type.STRING }
            },
            required: ["id", "text", "correctAnswer", "funFact"]
          }
        }
      }
    });

    // 處理可能的 JSON 解析問題
    let rawText = response.text || "";
    // 移除可能存在的 markdown 標籤
    rawText = rawText.replace(/```json|```/g, "").trim();
    
    const result = JSON.parse(rawText);
    if (Array.isArray(result) && result.length > 0) {
      console.log("[GeminiService] Successfully generated questions from AI.");
      return result;
    }
    throw new Error("Invalid format from AI");
    
  } catch (error) {
    console.error("[GeminiService] AI generation failed:", error);
    return getFallbackQuestions();
  }
};

function getFallbackQuestions(): Question[] {
  console.log("[GeminiService] Using fallback questions.");
  const now = Date.now();
  return [
    { id: now + 1, text: "在《家族誕生》中，大聲與劉在錫組成的經典雙人組叫什麼？", correctAnswer: "Daesung", funFact: "他們被稱為「阿呆阿瓜」，是節目的笑點擔當！" },
    { id: now + 2, text: "哪位成員因為太愛椅子，被爆料連客廳都放滿收藏而沒地方坐？", correctAnswer: "T.O.P", funFact: "他是國際知名的藝術家具收藏迷。" },
    { id: now + 3, text: "《眼、鼻、嘴》這首歌是太陽寫給哪位女藝人的情歌？", correctAnswer: "Taeyang", funFact: "這首歌是寫給他當時的女友，也就是現在的妻子閔孝琳。" },
    { id: now + 4, text: "GD 曾在頒獎典禮上以哪種造型亮眼，被粉絲戲稱為「壽司頭」？", correctAnswer: "G-Dragon", funFact: "那個造型靈感來自黃色的玉子燒壽司。" },
    { id: now + 5, text: "練習生時期，誰因為太餓偷買麵包吃而被社長訓話？", correctAnswer: "G-Dragon", funFact: "當時太陽也一起去了，這是 GDYB 最經典的革命情感故事。" },
    { id: now + 6, text: "2024 年哪位成員開設了訪談節目《家大聲》？", correctAnswer: "Daesung", funFact: "他在節目中展現了絕佳的口才，還請到 GD 站台。" },
    { id: now + 7, text: "誰的個人單曲《Doom Dada》展現了超高速饒舌與低音藝術？", correctAnswer: "T.O.P", funFact: "該曲 MV 充滿超現實主義美感。" },
    { id: now + 8, text: "誰是香奈兒（Chanel）首位全球形象大使，引領 K-Pop 時尚多年？", correctAnswer: "G-Dragon", funFact: "他對時尚的敏銳度讓他成為全球時尚 icon。" },
    { id: now + 9, text: "隊內的「信仰代表」，並以健康形象與自律著稱的成員是？", correctAnswer: "Taeyang", funFact: "他是韓國演藝圈公認的模範藝人。" },
    { id: now + 10, text: "大聲的經典演歌作品名為什麼？", correctAnswer: "Daesung", funFact: "曲名是《看我，貴順》，洗腦旋律紅遍男女老少。" }
  ];
}
