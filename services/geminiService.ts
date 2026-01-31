
import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

export const generateBigBangQuestions = async (usedQuestions: string[] = [], customKey?: string): Promise<Question[]> => {
  const apiKey = customKey || process.env.API_KEY;

  if (!apiKey) {
    console.warn("[GeminiService] No API Key provided. Switching to fallback.");
    return getFallbackQuestions();
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    const systemInstruction = `你是一位服務於 BIGBANG 頂級粉絲 (VIP) 的專業互動遊戲出題者。
    請生成 10 題高難度的繁體中文問答，主題圍繞 GD, T.O.P, Taeyang, Daesung。

    【出題原則】：
    1. **高難度選項**：選項不應只是成員名字。針對題目設計 4 個相似或具干擾性的選項（例如：正確日期 vs 錯誤日期、相似的表演名稱）。
    2. **去線索化**：題目中嚴禁出現會直接暗示答案的關鍵字（例如：如果答案是大聲，題目不應出現「家大聲」或「阿呆阿瓜」）。
    3. **主題多樣化**：
       - 2024-2025 最新動態（GD 的《Power》宣傳細節、太陽的《THE LIGHT YEAR》巡演細節、大聲的音樂劇或 YouTube 梗）。
       - 經典趣聞：綜藝節目中的具體對話、舞台事故、成員間的冷知識。
       - 時尚與藝術：T.O.P 的收藏細節、GD 的品牌聯名細節。
    4. **嚴格禁令**：絕對禁止提及勝利 (Seungri) 及其相關事件。
    5. **格式要求**：必須返回 JSON 陣列，每題包含 id, text, options (4個字串), correctAnswer (必須是 options 之一), funFact。`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "請開始為 VIP 生成 10 題極具挑戰性的多樣化題目。",
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
              options: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "固定 4 個選項"
              },
              correctAnswer: { type: Type.STRING },
              funFact: { type: Type.STRING }
            },
            required: ["id", "text", "options", "correctAnswer", "funFact"]
          }
        }
      }
    });

    let rawText = response.text || "";
    rawText = rawText.replace(/```json|```/g, "").trim();
    
    const result = JSON.parse(rawText);
    if (Array.isArray(result)) {
      return result.map((q: any) => ({
        ...q,
        options: q.options.length === 4 ? q.options : [...q.options, "無選項A", "無選項B", "無選項C", "無選項D"].slice(0, 4)
      }));
    }
    throw new Error("Invalid output format");
    
  } catch (error) {
    console.error("[GeminiService] AI Error:", error);
    return getFallbackQuestions();
  }
};

function getFallbackQuestions(): Question[] {
  const now = Date.now();
  return [
    { 
      id: now + 1, 
      text: "在 2024 MAMA 頒獎典禮上，G-Dragon 回歸舞台表演的第一首曲目是？", 
      options: ["POWER", "HOMEBOY", "COUP D'ETAT", "ONE OF A KIND"],
      correctAnswer: "POWER", 
      funFact: "這是 GD 闊別多年再次登上 MAMA 舞台，引起全球轟動！" 
    },
    { 
      id: now + 2, 
      text: "太陽曾在巡演中表示，哪一首歌是他在洗澡時獲得靈感創作的？", 
      options: ["Wedding Dress", "Ringa Linga", "Eyes, Nose, Lips", "VIBE"],
      correctAnswer: "Eyes, Nose, Lips", 
      funFact: "這首歌紀錄了他對妻子的真摯情感。" 
    }
  ];
}
