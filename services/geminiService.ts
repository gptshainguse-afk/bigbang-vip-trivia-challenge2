
import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

const getApiKey = () => {
  return process.env.API_KEY || (window as any)._ENV_?.API_KEY || '';
};

export const generateBigBangQuestions = async (): Promise<Question[]> => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `你是一位 BIGBANG 的資深超級粉絲 (V.I.P)。請生成 10 題關於成員：G-Dragon, T.O.P, Taeyang, Daesung 的有趣且具挑戰性的問答題。

  絕對規則：
  1. 題目內容必須使用「繁體中文」。
  2. 絕對不能出現關於「勝利 (Seungri)」或答案是「勝利」的任何內容。
  3. 每題的正確答案必須是這四個人之一："G-Dragon", "T.O.P", "Taeyang", 或 "Daesung"。
  4. 題目主題：綜藝節目名場面（如《家族誕生》、《無限挑戰》）、音樂紀錄、成員間的趣事、獨特的時尚風格、鮮為人知的祕密。
  5. 每一題請提供一個簡短的「趣味事實 (funFact)」供主持人宣讀。

  請回傳一個 JSON 陣列，包含：id (int), text (string), correctAnswer (string), funFact (string)。`;

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
              correctAnswer: { type: Type.STRING, description: "必須是 G-Dragon, T.O.P, Taeyang, Daesung 其中之一" },
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
    // 備用中文題目
    return [
      { id: 1, text: "哪位成員以收藏頂級家具聞名，甚至曾開玩笑說自己的家就像博物館？", correctAnswer: "T.O.P", funFact: "T.O.P 的椅子收藏在藝術界非常出名！" },
      { id: 2, text: "誰曾被稱為「微笑天使」，除了強大的搖滾唱功，也出過多首熱門的 Trot (演歌) 單曲？", correctAnswer: "Daesung", funFact: "大聲在日本以 D-Lite 身份活動非常成功。" },
      { id: 3, text: "經典神曲《眼、鼻、嘴》是哪位成員寫給當時的女友（現任妻子）閔孝琳的歌曲？", correctAnswer: "Taeyang", funFact: "這首歌發行後成為了國民婚禮祝歌。" },
      { id: 4, text: "BIGBANG 的隊長，被譽為「K-Pop 之王」，也是引領全球流行的時尚指標是誰？", correctAnswer: "G-Dragon", funFact: "GD 12歲就進入 YG 當練習生。" },
      { id: 5, text: "在綜藝節目《家族誕生》中，哪位成員與劉在錫組成了爆笑的「阿呆阿瓜」組合？", correctAnswer: "Daesung", funFact: "大聲是當時演藝圈公認的綜藝天才。" }
    ];
  }
};
