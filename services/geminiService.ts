import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

export const generateBigBangQuestions = async (usedQuestions: string[] = []): Promise<Question[]> => {
  // 獲取 API KEY 的安全方式
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    console.error("Critical Error: process.env.API_KEY is undefined.");
    return getFallbackQuestions();
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const systemInstruction = `你是一位超級 BIGBANG 專家 (V.I.P)。
  請生成 10 題關於 G-Dragon, T.O.P, Taeyang, Daesung 的繁體中文有趣問答。
  
  核心準則：
  1. 正確答案必須是以下四個字串之一（精確匹配）："G-Dragon", "T.O.P", "Taeyang", "Daesung"。
  2. 絕對不准提到「勝利 (Seungri)」。
  3. 題目類型：綜藝梗（如《家族誕生》、《無限挑戰》）、經典舞台失誤、成員間的私下趣聞、標誌性時尚。
  4. 絕對不可重複出現以下題目：${usedQuestions.join('、')}。
  5. 每一題都要有有趣的「funFact」。
  6. 輸出格式必須是純 JSON 陣列。`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "請生成 10 題全新的 BIGBANG 鐵粉問答。",
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

    const result = JSON.parse(response.text || '[]');
    if (result.length === 0) throw new Error("API return empty results");
    return result;
  } catch (error) {
    console.warn("Gemini API Error, using high-quality fallback questions:", error);
    return getFallbackQuestions();
  }
};

function getFallbackQuestions(): Question[] {
  return [
    { id: Date.now() + 1, text: "在《無限挑戰》歌謠祭中，GD 曾與哪位大叔前輩組成「GG」組合並演唱《花心》？", correctAnswer: "G-Dragon", funFact: "當時朴明秀對 GD 的「執著」讓全韓國觀眾爆笑。" },
    { id: Date.now() + 2, text: "哪位成員曾在日本以「D-Lite」名義發行演歌 (Trot) 專輯《看我，貴順》？", correctAnswer: "Daesung", funFact: "這首歌是由 GD 親自作詞作曲送給大聲的。" },
    { id: Date.now() + 3, text: "哪位成員因為太愛收集椅子，甚至被成員爆料家裡客廳連坐的位置都沒有？", correctAnswer: "T.O.P", funFact: "他是專業的設計師椅收藏家，收藏量驚人。" },
    { id: Date.now() + 4, text: "太陽的經典歌曲《眼、鼻、嘴》MV 中，背景那張巨大的照片是哪位女明星？", correctAnswer: "Taeyang", funFact: "那是他的初戀及現任妻子閔孝琳。" },
    { id: Date.now() + 5, text: "GD 曾在哪個頒獎典禮上以「壽司頭」髮型亮相，成為時尚史上的名場面？", correctAnswer: "G-Dragon", funFact: "那個造型靈感來自玉子燒壽司。" },
    { id: Date.now() + 6, text: "哪位成員被稱為「BIGBANG 的道德標竿」，出道多年幾乎沒有任何負面新聞？", correctAnswer: "Taeyang", funFact: "他是韓國演藝圈公認的自律代表。" },
    { id: Date.now() + 7, text: "在練習生時期，哪兩位成員因為太餓偷偷去便利商店買麵包吃，差點被社長開除？", correctAnswer: "G-Dragon", funFact: "這兩位就是竹馬好友 GD 和太陽。" },
    { id: Date.now() + 8, text: "哪位成員在 2024 年開設了 YouTube 頻道《家大聲》，專門邀請朋友到家裡作客？", correctAnswer: "Daesung", funFact: "太陽和 GD 都曾出現在該節目中支持他。" },
    { id: Date.now() + 9, text: "哪位成員擁有低沉的嗓音，並在電影《向著炮火》中擔任主演獲得最佳新人獎？", correctAnswer: "T.O.P", funFact: "他是 BIGBANG 中第一位獲得電影演技大獎的成員。" },
    { id: Date.now() + 10, text: "誰在《家族誕生》中展現了抓魚的恐懼，被封為「阿呆阿瓜」的一員？", correctAnswer: "Daesung", funFact: "他與劉在錫的默契讓該節目成為當年的綜藝之王。" }
  ];
}
