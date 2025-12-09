import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptData } from "../types";

export const generateClientMessage = async (data: ReceiptData): Promise<string> => {
  // Ensure we are using the globally polyfilled process
  // @ts-ignore
  const apiKey = (window.process && window.process.env && window.process.env.API_KEY) || process.env.API_KEY;

  if (!apiKey) {
      console.warn("API Key missing");
      return "Erro: Chave de API não configurada. Verifique as configurações.";
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
  } catch (error) {
    console.error("Error generating message:", error);
    return "Erro ao conectar com a IA. Por favor, tente novamente.";
  }
};

export const parseReceiptFromText = async (text: string, catalogNames: string[] = []): Promise<any> => {
  // Ensure we are using the globally polyfilled process
  // @ts-ignore
  const apiKey = (window.process && window.process.env && window.process.env.API_KEY) || process.env.API_KEY;

  if (!apiKey) {
      console.warn("API Key missing");
      throw new Error("API Key not configured");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-2.5-flash";

  const catalogString = catalogNames.join(", ");

  const prompt = `
    Analise o seguinte texto de um pedido/ficha de cliente.
    
    1. Extraia os dados pessoais do cliente.
    2. Tente identificar um CÓDIGO DA VENDA, Número do Pedido ou ID (ex: #1234, 8402, PED-01).
    3. Identifique o CPF ou CNPJ do cliente se houver.
    4. Identifique se há produtos mencionados que correspondam à lista de catálogos fornecida abaixo.
    
    LISTA DE PRODUTOS DO SISTEMA:
    [${catalogString}]

    Se encontrar um produto no texto que pareça ser um item da lista acima, inclua o NOME EXATO DA LISTA no array "items".
    Se não houver produtos ou não corresponderem, deixe o array vazio.
    IGNORE preços e quantidades encontrados no texto, apenas identifique o nome do produto.

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
              items: { type: Type.STRING },
            }
          }
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("No response from AI");

    const parsedData = JSON.parse(jsonText);
    return parsedData;
  } catch (error) {
    console.error("Error parsing receipt text:", error);
    throw error;
  }
};