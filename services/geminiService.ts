
import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptData } from "../types";

/**
 * Generates a friendly confirmation message for the client using Gemini.
 */
export const generateClientMessage = async (data: ReceiptData): Promise<string> => {
  // Use the pre-configured process.env.API_KEY directly as per coding guidelines
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  
  const subtotal = data.products.reduce((acc, curr) => acc + (curr.price * curr.quantity), 0);
  let discountAmount = 0;
  if (data.discountType === 'fixed') {
    discountAmount = data.discountValue;
  } else {
    discountAmount = subtotal * (data.discountValue / 100);
  }
  const finalTotal = Math.max(0, subtotal - discountAmount);

  const productsListText = data.products.length > 0 
    ? data.products.map(p => `- ${p.quantity}x ${p.name} (${(p.price * p.quantity).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`).join('\n')
    : "Não especificado";
  
  const totalText = finalTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const prompt = `
    Você é o motor de inteligência da BelConfort. Gere uma resposta extremamente profissional e cordial.
    
    DADOS DO PEDIDO:
    Cliente: ${data.name}
    Venda ID: ${data.saleCode}
    Valor Final: ${totalText}
    Lista de Itens:
    ${productsListText}

    MISSÃO:
    Escreva uma mensagem curta para WhatsApp. Seja direto, use emojis de forma sofisticada e agradeça a confiança na BelConfort.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: "Você é um assistente de elite da BelConfort. Seu tom é executivo, acolhedor e focado em eficiência. Evite redundâncias e saudações genéricas de IA."
      }
    });

    return response.text || "Não foi possível gerar a mensagem.";
  } catch (error: any) {
    console.error("Error generating message:", error);
    throw error;
  }
};

/**
 * Parses receipt text into structured JSON data using Gemini.
 */
export const parseReceiptFromText = async (text: string, catalogNames: string[] = []): Promise<any> => {
  // Use the pre-configured process.env.API_KEY directly as per coding guidelines
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

  const catalogString = catalogNames.join(", ");

  const prompt = `
    Analise a ficha técnica/texto de venda abaixo e extraia cada bit de informação com precisão absoluta.
    
    DIRETRIZES:
    1. Localize Nome, CPF/CNPJ e Endereço Completo.
    2. Mapeie cada produto para o nome correspondente no catálogo oficial: [${catalogString}]
    3. REGRAS DE BRINDES: Se o cliente "ganhou" ou tem travesseiro como "cortesia", mapeie para: "TRAVESSEIRO FLOCOS CONFORTO 20CM 60X40 BRANCO".
    4. DATA: Se não houver data, deixe vazio para preenchimento manual.

    TEXTO DO CLIENTE:
    ${text}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: {
        systemInstruction: "Você é um extrator de dados JSON de alta performance. Sua prioridade é a integridade dos dados e a correspondência exata de nomes de produtos do catálogo.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            clientData: {
              type: Type.OBJECT,
              properties: {
                saleCode: { type: Type.STRING },
                name: { type: Type.STRING },
                cpf: { type: Type.STRING },
                date: { type: Type.STRING },
                email: { type: Type.STRING },
                street: { type: Type.STRING },
                number: { type: Type.STRING },
                neighborhood: { type: Type.STRING },
                city: { type: Type.STRING },
                complement: { type: Type.STRING },
                contact1: { type: Type.STRING },
                contact2: { type: Type.STRING },
                paymentMethod: { type: Type.STRING },
              }
            },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  quantity: { type: Type.NUMBER }
                }
              },
            }
          }
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("Resposta vazia.");

    return JSON.parse(jsonText);
  } catch (error: any) {
    console.error("Error parsing receipt text:", error);
    throw error;
  }
};
