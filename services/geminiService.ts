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
      model: 'gemini-3.7-flash',
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

const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.7-flash', 'gemini-2.5-pro'];

// Deterministic intelligent local parser fallback when AI is experiencing high demand
export function parseReceiptLocally(text: string, catalogNames: string[] = []): any {
  const clean = text.replace(/\r\n/g, '\n');
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);

  const clientData: any = {};
  const items: Array<{ name: string; quantity: number; price?: number }> = [];

  // Extract Name
  const nameMatch = clean.match(/(?:cliente|nome|comprador|destinat[aá]rio)[:\s-]*([^\n,;]+)/i);
  if (nameMatch) {
    clientData.name = nameMatch[1].trim().toUpperCase();
  }

  // Extract CPF / CNPJ
  const cpfMatch = clean.match(/(?:cpf|cnpj|doc|documento)[:\s-]*([0-9.\-\/]{11,18})/i) || clean.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
  if (cpfMatch) {
    clientData.cpf = (cpfMatch[1] || cpfMatch[0]).replace(/[^\d.\-\/]/g, '').trim();
  }

  // Extract Phones
  const phoneMatches = clean.match(/(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}/g);
  if (phoneMatches && phoneMatches.length > 0) {
    clientData.contact1 = phoneMatches[0].trim();
    if (phoneMatches.length > 1) {
      clientData.contact2 = phoneMatches[1].trim();
    }
  }

  // Extract Payment Method
  const paymentMatch = clean.match(/(?:forma de pagamento|pagamento|pagto|condi[cç][aã]o)[:\s-]*([^\n]+)/i);
  if (paymentMatch) {
    clientData.paymentMethod = paymentMatch[1].trim().toUpperCase();
  } else if (/pix/i.test(clean)) {
    clientData.paymentMethod = 'PIX';
  } else if (/cart[aã]o|cr[eé]dito|d[eé]bito/i.test(clean)) {
    clientData.paymentMethod = 'CARTÃO';
  } else if (/dinheiro|esp[eé]cie/i.test(clean)) {
    clientData.paymentMethod = 'DINHEIRO';
  }

  // Extract Address parts
  const endMatch = clean.match(/(?:endere[cç]o|rua|av|avenida|logradouro|local)[:\s-]*([^\n]+)/i);
  if (endMatch) {
    const endLine = endMatch[1].trim();
    const numMatch = endLine.match(/,\s*(\d+[a-zA-Z]?|\b\d+\b)/);
    if (numMatch) {
      clientData.number = numMatch[1].trim();
      clientData.street = endLine.substring(0, numMatch.index).replace(/^(?:rua|av|avenida|travessa|alameda)\s*/i, '').trim().toUpperCase();
    } else {
      clientData.street = endLine.toUpperCase();
    }

    const bairroMatch = endLine.match(/-\s*([^-,]+?)(?:\s*-\s*|\s*,\s*|$)/);
    if (bairroMatch && bairroMatch[1]) {
      clientData.neighborhood = bairroMatch[1].trim().toUpperCase();
    }
  }

  const bairroLineMatch = clean.match(/(?:bairro)[:\s-]*([^\n,]+)/i);
  if (bairroLineMatch) {
    clientData.neighborhood = bairroLineMatch[1].trim().toUpperCase();
  }

  const cidadeLineMatch = clean.match(/(?:cidade|munic[ií]pio)[:\s-]*([^\n,]+)/i);
  if (cidadeLineMatch) {
    clientData.city = cidadeLineMatch[1].trim().toUpperCase();
  }

  // Extract Products from catalog or lines
  for (const line of lines) {
    const isProdLine = /(?:produto|item|colch[aã]o|base|bicama|cabeceira|travesseiro|fog[aã]o|unibox|arm[aá]rio)/i.test(line);
    if (isProdLine || catalogNames.some(cat => line.toUpperCase().includes(cat.toUpperCase().slice(0, 15)))) {
      const qtyMatch = line.match(/^(\d+)x?\s+/i) || line.match(/(\d+)\s+(?:unidades?|un|pe[cç]as?|x)/i) || line.match(/\b(\d+)\b/);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

      let matchedName = '';
      for (const catName of catalogNames) {
        const keywords = catName.toUpperCase().split(' ').filter(k => k.length > 2);
        const matchCount = keywords.filter(k => line.toUpperCase().includes(k)).length;
        if (matchCount >= 2 || line.toUpperCase().includes(catName.toUpperCase())) {
          matchedName = catName;
          break;
        }
      }

      if (!matchedName) {
        matchedName = line.replace(/^(?:produtos?|itens?|item|\d+x?|\d+)\s*[:\-]?\s*/i, '').trim().toUpperCase();
      }

      if (matchedName && matchedName.length > 3 && !/^(?:cliente|endere[cç]o|valor|pagamento|data|telefone)/i.test(matchedName)) {
        items.push({
          name: matchedName,
          quantity: isNaN(qty) || qty < 1 ? 1 : qty,
        });
      }
    }
  }

  // Check for gifts like "travesseiro"
  if (/travesseiro/i.test(clean) && !items.some(i => /travesseiro/i.test(i.name))) {
    items.push({
      name: "TRAVESSEIRO FLOCOS CONFORTO 20CM 60X40 BRANCO",
      quantity: 1,
      price: 0
    });
  }

  return { clientData, items };
}

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
      if (result && (result.clientData || result.items)) {
        return result;
      }
    }
  } catch (e: any) {
    console.warn("[GeminiService] Servidor inacessível, utilizando fallback do cliente...");
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

  for (const modelName of FALLBACK_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
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
                    quantity: { type: Type.NUMBER },
                    price: { type: Type.NUMBER }
                  }
                },
              }
            }
          }
        }
      });

      const jsonText = response.text;
      if (jsonText) {
        return JSON.parse(jsonText);
      }
    } catch (err) {
      console.warn(`[Gemini Client] Model ${modelName} unavailable:`, err);
    }
  }

  // Fallback to local intelligent parser
  return parseReceiptLocally(text, catalogNames);
};
