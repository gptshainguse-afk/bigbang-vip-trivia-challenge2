
import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

export const generateBigBangQuestions = async (usedQuestions: string[] = []): Promise<Question[]> => {
  // 遵循規範：在調用前才初始化
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  const systemInstruction = `你是一位資深的 BIGBANG 粉絲 (V.I.P)，對 GD、太陽、大聲、T.O.P 的生平、舞台、綜藝名場面瞭如指掌。
  你的任務是生成 10 題有趣的繁體中文問答。
  
  絕對規則：
  1. 答案必須且只能是這四人之一： "G-Dragon", "T.O.P", "Taeyang", "Daesung"。
  2. 禁止提及「勝利 (Seungri)」或任何與他相關的爭議。
  3. 題目類型：綜藝梗（如《家族誕生》、《無限挑戰》）、成員怪癖、經典時尚、舞台突發狀況。
  4. 避免重複以下題目內容：${usedQuestions.join(', ')}。
  5. 格式必須嚴格遵守 JSON。`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "請生成 10 題 BIGBANG 問答題。",
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
              correctAnswer: { type: Type.STRING, description: "必須精確為 G-Dragon, T.O.P, Taeyang 或 Daesung" },
              funFact: { type: Type.STRING }
            },
            required: ["id", "text", "correctAnswer", "funFact"]
          }
        }
      }
    });

    const result = JSON.parse(response.text || '[]');
    if (result.length === 0) throw new Error("Empty response");
    return result;
  } catch (error) {
    console.error("Gemini API Error:", error);
    // 備用題目（確保格式與成員名稱完全一致）
    return [
      { id: Date.now() + 1, text: "在《家族誕生》中，哪位成員因為抓魚時的膽小表現與劉在錫組成「阿呆阿瓜」？", correctAnswer: "Daesung", funFact: "大聲在該節目中展現了驚人的綜藝感！" },
      { id: Date.now() + 2, text: "哪位成員以喜愛收集藝術品與昂貴椅子聞名，甚至曾說家裡沒地方坐？", correctAnswer: "T.O.P", funFact: "他對藝術的熱愛讓他被稱為「崔收藏家」。" },
      { id: Date.now() + 3, text: "經典歌曲《眼、鼻、嘴》是哪位成員寫給其妻子的情歌？", correctAnswer: "Taeyang", funFact: "這首歌發行後橫掃各大音源榜。" },
      { id: Date.now() + 4, text: "哪位成員曾因「壽司頭」或是「玉子燒髮型」在 MAMA 頒獎典禮引起熱議？", correctAnswer: "G-Dragon", funFact: "GD 的時尚風格總是走在最前面。" },
      { id: Date.now() + 5, text: "哪位成員在練習生時期因為太餓，曾偷偷跟太陽去買麵包吃而被社長發現？", correctAnswer: "G-Dragon", funFact: "兩人從練習生時期就是患難與共的好兄弟。" },
      { id: Date.now() + 6, text: "在《無限挑戰》歌謠祭中，哪位成員曾跟朴明秀組成「GG」組合並演唱《花心》？", correctAnswer: "G-Dragon", funFact: "朴明秀對 GD 有著近乎瘋狂的喜愛。" },
      { id: Date.now() + 7, text: "哪位成員在 2024 年的大聲 YouTube 頻道《家大聲》中，合體展現了依然完美的默契？", correctAnswer: "Daesung", funFact: "成員們經常在大聲的頻道中互相客串。" },
      { id: Date.now() + 8, text: "哪位成員的聲音非常有辨識度，低沉的低音砲饒舌是 BIGBANG 音樂的標誌？", correctAnswer: "T.O.P", funFact: "他的聲音被粉絲譽為靈魂低音。" },
      { id: Date.now() + 9, text: "誰是 BIGBANG 中唯一一位沒有任何負面新聞、被稱為「道德標竿」的成員？", correctAnswer: "Taeyang", funFact: "太陽的自律在韓國演藝圈非常有名。" },
      { id: Date.now() + 10, text: "哪位成員曾在日本活動時取藝名為 D-Lite？", correctAnswer: "Daesung", funFact: "他在日本的高人氣讓他被封為「國民弟弟」。" }
    ];
  }
};
