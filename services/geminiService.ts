

import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptData } from "../types";

// Helper to safely get the API Key from various possible sources
const getApiKey = (): string => {
  // 1. Try Vite Environment Variable (Standard for Vercel + Vite)
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_KEY) {
      // @ts-ignore
      return import.meta.env.VITE_API_KEY;
    }
  } catch (e) {}

  // 2. Try Process Env (Fallback / Node shim)
  if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
    return process.env.API_KEY;
  }

  // 3. Check for manual global override
  // @ts-ignore
  if (typeof window !== 'undefined' && window.process && window.process.env && window.process.env.API_KEY) {
    // @ts-ignore
    return window.process.env.API_KEY;
  }

  return "";
};

export const generateClientMessage = async (data: ReceiptData): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return "ERRO DE CONFIGURAÇÃO: Chave API não encontrada. Verifique as Variáveis de Ambiente no Vercel (VITE_API_KEY).";
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-2.5-flash";
  
  // Calculations for prompt
  const subtotal = data.products.reduce((acc, curr) => acc + (curr.price * curr.quantity), 0);
  let discountAmount = 0;
  if (data.discountType === 'fixed') {
    discountAmount = data.discountValue;
  } else {
    discountAmount = subtotal * (data.discountValue / 100);
  }
  const finalTotal = Math.max(0, subtotal - discountAmount);

  // Format product list for the prompt
  const productsListText = data.products.length > 0 
    ? data.products.map(p => `- ${p.quantity}x ${p.name} (${(p.price * p.quantity).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`).join('\n')
    : "Não especificado";
  
  const discountText = discountAmount > 0 
    ? `Desconto: - ${discountAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n` 
    : '';

  const totalText = finalTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const prompt = `
    Você é um assistente de vendas da BelConfort (Loja de Camas e Móveis).
    Escreva uma mensagem curta, amigável e profissional para o WhatsApp do cliente confirmando o pedido.
    
    Dados do cliente:
    Nome: ${data.name}
    CPF: ${data.cpf}
    Data: ${data.date}
    Endereço: ${data.street}, ${data.number}, ${data.neighborhood}, ${data.city} ${data.complement ? `(${data.complement})` : ''}
    Forma de Pagamento: ${data.paymentMethod}
    
    Produtos:
    ${productsListText}

    ${discountText}
    Valor Total: ${totalText}
    
    A mensagem deve agradecer a preferência pela BelConfort.
    Use emojis relacionados a conforto, móveis e casa. 
    Seja objetivo e cordial.
  `;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });

    return response.text || "Não foi possível gerar a mensagem.";
  } catch (error: any) {
    console.error("Error generating message:", error);
    return `Erro na IA: ${error.message || 'Desconhecido'}`;
  }
};

export const parseReceiptFromText = async (text: string, catalogNames: string[] = []): Promise<any> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("CHAVE API NÃO ENCONTRADA! Adicione VITE_API_KEY nas variáveis de ambiente do Vercel.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-2.5-flash";

  const catalogString = catalogNames.join(", ");

  const prompt = `
    Analise o seguinte texto de um pedido/ficha de cliente.
    
    1. Extraia os dados pessoais do cliente.
    2. Tente identificar um CÓDIGO DA VENDA, Número do Pedido ou ID (ex: #1234, 8402, PED-01).
    3. Identifique o CPF ou CNPJ do cliente se houver.
    4. Identifique os produtos mencionados que correspondam à lista de catálogos fornecida abaixo.
    
    REGRAS IMPORTANTES PARA PRODUTOS:
    - Analise com MUITA atenção a QUANTIDADE de cada item mencionado (ex: "2 camas" = quantidade 2, "3x travesseiros" = quantidade 3). Se não especificar, assuma 1.
    - Se o texto mencionar "TRAVESSEIRO DE BRINDE", "GANHOU TRAVESSEIRO", "TRAVESSEIRO GRÁTIS" ou qualquer menção a brinde de travesseiro, você DEVE mapear automaticamente para o produto: "TRAVESSEIRO FLOCOS CONFORTO 20CM 60X40 BRANCO".
    - Procure corresponder o texto do usuário com o NOME EXATO DA LISTA abaixo.
    
    LISTA DE PRODUTOS DO SISTEMA:
    [${catalogString}]

    Retorne um JSON com os dados do cliente e um array de itens.
    Cada item deve ter "name" (string exata da lista) e "quantity" (numero).

    Texto para analise:
    ${text}
  `;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
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
    if (!jsonText) throw new Error("A IA retornou uma resposta vazia.");

    const parsedData = JSON.parse(jsonText);
    return parsedData;
  } catch (error: any) {
    console.error("Error parsing receipt text:", error);
    // Re-throw with clear message
    throw new Error(error.message || "Falha na comunicação com a IA");
  }
};