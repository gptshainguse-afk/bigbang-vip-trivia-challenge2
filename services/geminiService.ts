
import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

export const generateBigBangQuestions = async (usedQuestions: string[] = []): Promise<Question[]> => {
  // 遵循規範：在調用前才初始化，並使用指定的 API Key 獲取方式
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemInstruction = `你是一位資深的 BIGBANG 粉絲 (V.I.P)。
  請生成 10 題關於 G-Dragon, T.O.P, Taeyang, Daesung 的繁體中文有趣問答。
  
  核心規則：
  1. 答案必須且只能是這四人之一： "G-Dragon", "T.O.P", "Taeyang", "Daesung"。
  2. 絕對禁止出現「勝利 (Seungri)」或任何與他相關的內容。
  3. 題目類型：綜藝名場面、成員習慣、時尚梗、練習生趣事、舞台趣聞。
  4. 絕對避開重複以下題目：${usedQuestions.join('、')}。
  5. 每一題必須附帶一個 short 'funFact'。
  6. 輸出格式必須是純 JSON。`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "請為我生成 10 題新的 BIGBANG 問答題。",
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
    if (result.length === 0) throw new Error("API 回傳為空");
    return result;
  } catch (error) {
    console.error("Gemini API 發生錯誤:", error);
    // 備用高品質中文題目
    return [
      { id: 101, text: "在《家族誕生》中，哪位成員因為不敢抓魚而被封為「阿呆阿瓜」的一員？", correctAnswer: "Daesung", funFact: "大聲在該節目中與劉在錫的化學反應是收視保證！" },
      { id: 102, text: "誰曾在 MAMA 頒獎典禮上以神似「玉子燒」或「長壽司」的亮黃色髮型引起全球討論？", correctAnswer: "G-Dragon", funFact: "GD 的髮型演變史一直是大眾關注焦點。" },
      { id: 103, text: "哪位成員以喜愛紅酒與收集名貴椅子（如 Charlotte Perriand）聞名，家裡像博物館？", correctAnswer: "T.O.P", funFact: "他對椅子和現代藝術的熱情是偶像界第一。" },
      { id: 104, text: "經典抒情歌《眼、鼻、嘴》是哪位成員在 2014 年寫給愛人閔孝琳的表白歌曲？", correctAnswer: "Taeyang", funFact: "這首歌發行時在各國排行榜蟬聯多週冠軍。" },
      { id: 105, text: "哪位成員在練習生時期，因為太陽太餓而一起去便利商店買麵包吃，結果被社長抓包？", correctAnswer: "G-Dragon", funFact: "兩人當初為了這顆麵包差點被開除練習生資格。" },
      { id: 106, text: "誰在 2024 年開設了 YouTube 談話節目《家大聲》，並邀集了各路圈內好友來聊天？", correctAnswer: "Daesung", funFact: "該頻道目前是許多 V.I.P 獲取成員近況的重要管道。" },
      { id: 107, text: "哪位成員的低沉嗓音被稱為「低音砲」，在歌曲《Doom Dada》中展現了極致的快嘴饒舌？", correctAnswer: "T.O.P", funFact: "他的聲線是 BIGBANG 音樂中不可或缺的重金屬元素。" },
      { id: 108, text: "誰是 BIGBANG 中公認的「舞蹈機器」，並在 2023 年與 BTS 的 Jimin 合作了單曲《VIBE》？", correctAnswer: "Taeyang", funFact: "太陽的律動感在韓流圈被視為教科書等級。" },
      { id: 109, text: "在《無限挑戰》歌謠祭中，哪位成員曾與鄭亨敦組成「形龍敦野」並產生莫名的 CP 感？", correctAnswer: "G-Dragon", funFact: "當時兩人的互動被選為年度最佳情侶之一。" },
      { id: 110, text: "哪位成員在日本發展時以藝名「D-Lite」活動，並發行過多張充滿活力的 Trot 專輯？", correctAnswer: "Daesung", funFact: "大聲在日本展現了極強的親和力與唱功。" }
    ];
  }
};
