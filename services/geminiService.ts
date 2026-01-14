import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

export const generateBigBangQuestions = async (usedQuestions: string[] = []): Promise<Question[]> => {
  // 遵循規範：直接使用 process.env.API_KEY 初始化
  // 系統會自動注入此變數，不應手動判斷 undefined 導致阻斷
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const systemInstruction = `你是一位資深的 BIGBANG 粉絲 (V.I.P)。
    請生成 10 題關於 G-Dragon, T.O.P, Taeyang, Daesung 的繁體中文問答題。
    
    規則：
    1. 正確答案只能是： "G-Dragon", "T.O.P", "Taeyang", "Daesung"。
    2. 禁止提及「勝利 (Seungri)」。
    3. 題目必須有趣，包含綜藝名場面、成員怪癖、經典時尚、或 2024 年後的最新活動。
    4. 避開以下重複題目：${usedQuestions.join('、')}。
    5. 必須返回 JSON 陣列格式。`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "請生成 10 題有趣的 BIGBANG V.I.P 專屬問答。",
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
              correctAnswer: { type: Type.STRING, description: "必須精確為成員藝名" },
              funFact: { type: Type.STRING }
            },
            required: ["id", "text", "correctAnswer", "funFact"]
          }
        }
      }
    });

    const result = JSON.parse(response.text || '[]');
    if (result.length > 0) return result;
    throw new Error("Empty AI result");
    
  } catch (error) {
    console.error("Gemini API Error, fallback to static questions:", error);
    // 備案：高品質靜態題目
    return getFallbackQuestions();
  }
};

function getFallbackQuestions(): Question[] {
  const now = Date.now();
  return [
    { id: now + 1, text: "在《家族誕生》中，大聲與哪位主持人組成了經典的「阿呆阿瓜」組合？", correctAnswer: "Daesung", funFact: "這對組合當時是節目的核心笑點！" },
    { id: now + 2, text: "哪位成員以喜愛椅子聞名，甚至家裡收藏了大量名貴家具到沒地方走路？", correctAnswer: "T.O.P", funFact: "他是一位知名的藝術與設計品收藏家。" },
    { id: now + 3, text: "經典歌曲《眼、鼻、嘴》是太陽寫給誰的歌曲？", correctAnswer: "Taeyang", funFact: "那是寫給他當時的女友（現任妻子）閔孝琳的。" },
    { id: now + 4, text: "GD 曾在 MAMA 頒獎典禮上以哪種造型驚豔全場，被戲稱為「壽司頭」？", correctAnswer: "G-Dragon", funFact: "靈感據說來自於亮黃色的玉子燒壽司。" },
    { id: now + 5, text: "哪位成員在練習生時期因為太餓，曾跟太陽一起去偷買麵包吃而被社長教訓？", correctAnswer: "G-Dragon", funFact: "這是 GDYB 兩位竹馬好友最經典的練習生趣聞。" },
    { id: now + 6, text: "誰在 2024 年推出了大受歡迎的個人 YouTube 節目《家大聲》？", correctAnswer: "Daesung", funFact: "節目中邀請了許多老友，包含 GD 與太陽。" },
    { id: now + 7, text: "哪位成員擁有迷人的低音砲嗓音，且在《Doom Dada》中展現了超高速饒舌？", correctAnswer: "T.O.P", funFact: "他的聲音被粉絲稱為「靈魂低音砲」。" },
    { id: now + 8, text: "哪位成員被稱為 K-Pop 的時尚領軍人物，曾多次受邀參加香奈兒時裝秀？", correctAnswer: "G-Dragon", funFact: "他是香奈兒全球形象大使。 " },
    { id: now + 9, text: "誰是隊內的「自律王」，出道多年幾乎沒有任何負面新聞且已婚？", correctAnswer: "Taeyang", funFact: "他的私生活非常低調且專情。" },
    { id: now + 10, text: "哪位成員在 2013 年曾發行過著名的演歌 (Trot) 作品《看我，貴順》？", correctAnswer: "Daesung", funFact: "這首歌由 GD 親自為他量身打造。" }
  ];
}
