
import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

export const generateBigBangQuestions = async (usedQuestions: string[] = [], customKey?: string): Promise<Question[]> => {
  const apiKey = customKey || process.env.API_KEY;

  if (!apiKey) {
    console.warn("[GeminiService] No API Key provided. Switching to fallback.");
    return getFallbackQuestions();
  }

  console.log(`[GeminiService] Fetching questions... (Key prefix: ${apiKey.substring(0, 5)})`);

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    const systemInstruction = `你是一位資深的 BIGBANG (GD, T.O.P, Taeyang, Daesung) 鐵粉專家。
    請生成 10 題高難度的繁體中文問答。

    【嚴格格式要求】：
    1. correctAnswer 屬性必須從這四個選項中擇一： "G-Dragon", "T.O.P", "Taeyang", "Daesung"。
    2. 禁止提及勝利 (Seungri)。
    3. 題目內容：必須包含 2024-2025 的最新動態（如大聲的《家大聲》、GD 參加 2024 MAMA、太陽的巡演）、經典綜藝梗（如《家族誕生》、GD 的壽司頭）。
    4. 必須嚴格返回 JSON 陣列。
    5. 不要重複以下題目：${usedQuestions.join('、')}。`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "請開始生成 10 題高品質的 VIP 鐵粉問答。",
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.NUMBER },
              text: { type: Type.STRING },
              correctAnswer: { type: Type.STRING },
              funFact: { type: Type.STRING }
            },
            required: ["id", "text", "correctAnswer", "funFact"]
          }
        }
      }
    });

    let rawText = response.text || "";
    rawText = rawText.replace(/```json|```/g, "").trim();
    
    console.log("[GeminiService] Raw AI Response:", rawText);
    
    const result = JSON.parse(rawText);
    if (Array.isArray(result) && result.length > 0) {
      // 確保屬性名稱正確
      const sanitized = result.map((q: any) => ({
        id: q.id || Date.now(),
        text: q.text || "未知題目",
        correctAnswer: q.correctAnswer || q.answer || q.correct_answer || "",
        funFact: q.funFact || ""
      }));
      console.log("[GeminiService] Sanitized Success:", sanitized[0]);
      return sanitized;
    }
    throw new Error("Invalid array format");
    
  } catch (error) {
    console.error("[GeminiService] AI Error:", error);
    return getFallbackQuestions();
  }
};

function getFallbackQuestions(): Question[] {
  const now = Date.now();
  return [
    { id: now + 1, text: "在《家族誕生》中，大聲與哪位主持人組成了經典的「阿呆阿瓜」？", correctAnswer: "Daesung", funFact: "這是大聲在綜藝界大放異彩的開始！" },
    { id: now + 2, text: "GD 曾在 MAMA 典禮上以哪種造型驚豔全場，被戲稱為「壽司頭」？", correctAnswer: "G-Dragon", funFact: "那個造型當時引起了時尚圈極大討論。" },
    { id: now + 3, text: "太陽的經典情歌《眼、鼻、嘴》是寫給哪位女藝人的？", correctAnswer: "Taeyang", funFact: "也就是他現在的妻子閔孝琳。" },
    { id: now + 4, text: "誰在 2024 年開設了個人 YouTube 節目《家大聲》？", correctAnswer: "Daesung", funFact: "節目邀請了 GD 與太陽，展現了團體不變的情誼。" },
    { id: now + 5, text: "哪位成員以喜愛椅子與藝術品收藏聞名？", correctAnswer: "T.O.P", funFact: "他對藝術的熱愛眾所皆知，甚至曾擔任拍賣會策劃。" }
  ];
}
