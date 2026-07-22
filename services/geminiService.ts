import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptData } from "../types";

/**
 * Gets a GenAI client initialized with user agent header and available key.
 */
const getAiClient = () => {
  const metaEnv = (import.meta as any).env || {};
  const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || metaEnv.VITE_API_KEY || '') as string;
  return new GoogleGenAI({
    apiKey: apiKey || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

/**
 * Generates a friendly confirmation message for the client using Gemini.
 */
export const generateClientMessage = async (data: ReceiptData): Promise<string> => {
  // Try server endpoint first for fast server-side execution
  try {
    const res = await fetch('/api/generate-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    if (res.ok) {
      const result = await res.json();
      if (result.message) return result.message;
    }
  } catch (e) {
    // Fall back to direct SDK call if route is not present or client standalone
  }

  const ai = getAiClient();
  
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
    Você é o motor de inteligência da BelConfort. Gere uma resposta profissional e cordial para WhatsApp.
    
    DADOS DO PEDIDO:
    Cliente: ${data.name}
    Venda ID: ${data.saleCode}
    Valor Final: ${totalText}
    Lista de Itens:
    ${productsListText}

    Escreva uma mensagem curta para WhatsApp com agradecimento e emojis.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.2,
        systemInstruction: "Você é um assistente de elite da BelConfort. Seu tom é executivo, acolhedor e focado em eficiência."
      }
    });

    return response.text || "Não foi possível gerar a mensagem.";
  } catch (error: any) {
    console.error("Error generating message:", error);
    throw error;
  }
};

/**
 * Parses receipt text into structured JSON data using Gemini with fast inference.
 */
export const parseReceiptFromText = async (text: string, catalogNames: string[] = []): Promise<any> => {
  // Try server endpoint first for instant execution & server-side API key protection
  try {
    const res = await fetch('/api/parse-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, catalogNames }),
    });
    if (res.ok) {
      const result = await res.json();
      if (result.clientData || result.items) {
        return result;
      }
    }
  } catch (e) {
    // Fall back to direct SDK call if route unavailable
  }

  const ai = getAiClient();
  const compactCatalog = catalogNames.slice(0, 150).join(", ");

  const prompt = `
    Analise a ficha técnica/texto de venda abaixo e extraia com precisão:
    
    DIRETRIZES DE EXTRAÇÃO RÁPIDA:
    1. Nome, CPF/CNPJ, Endereço (Rua, Número, Bairro, Cidade), Telefones (contato1, contato2) e Método de Pagamento.
    2. Mapeie cada produto para o nome correspondente no catálogo oficial: [${compactCatalog}]
    3. BRINDES: Se menciona "travesseiro" como cortesia/brinde, mapeie para: "TRAVESSEIRO FLOCOS CONFORTO 20CM 60X40 BRANCO".

    TEXTO:
    ${text}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.1,
        systemInstruction: "Você é um extrator ultrarrápido de dados de vendas da BelConfort.",
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
                shippingValue: { type: Type.NUMBER },
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
    if (!jsonText) throw new Error("Resposta vazia da IA.");

    return JSON.parse(jsonText);
  } catch (error: any) {
    console.error("Error parsing receipt text:", error);
    throw error;
  }
};
