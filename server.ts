import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Helper for server-side Gemini client
  const getAi = () => {
    const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.VITE_API_KEY || '') as string;
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  };

  // Fast AI import route
  app.post("/api/parse-receipt", async (req, res) => {
    try {
      const { text, catalogNames = [] } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Texto do pedido é obrigatório." });
      }

      const ai = getAi();
      const compactCatalog = (catalogNames as string[]).slice(0, 150).join(", ");

      const prompt = `
        Analise a ficha técnica/texto de venda abaixo e extraia com precisão:
        
        DIRETRIZES DE EXTRAÇÃO RÁPIDA:
        1. Nome, CPF/CNPJ, Endereço (Rua, Número, Bairro, Cidade), Telefones (contato1, contato2) e Método de Pagamento.
        2. Mapeie cada produto para o nome correspondente no catálogo oficial: [${compactCatalog}]
        3. BRINDES: Se menciona "travesseiro" como cortesia/brinde, mapeie para: "TRAVESSEIRO FLOCOS CONFORTO 20CM 60X40 BRANCO".

        TEXTO DO CLIENTE:
        ${text}
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
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
      const data = JSON.parse(jsonText);
      res.json(data);
    } catch (error: any) {
      console.error("[Server Error] Parse receipt failed:", error);
      res.status(500).json({ error: error.message || "Erro ao processar pedido com IA." });
    }
  });

  // Fast AI WhatsApp message route
  app.post("/api/generate-message", async (req, res) => {
    try {
      const { data } = req.body;
      if (!data) return res.status(400).json({ error: "Dados inválidos." });

      const ai = getAi();
      const subtotal = data.products ? data.products.reduce((acc: number, curr: any) => acc + (curr.price * curr.quantity), 0) : 0;
      let discountAmount = 0;
      if (data.discountType === 'fixed') {
        discountAmount = data.discountValue || 0;
      } else {
        discountAmount = subtotal * ((data.discountValue || 0) / 100);
      }
      const finalTotal = Math.max(0, subtotal - discountAmount);

      const productsListText = data.products && data.products.length > 0 
        ? data.products.map((p: any) => `- ${p.quantity}x ${p.name} (${(p.price * p.quantity).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`).join('\n')
        : "Não especificado";
      
      const totalText = finalTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      const prompt = `
        Você é o motor de inteligência da BelConfort. Gere uma resposta profissional e cordial para WhatsApp.
        
        DADOS DO PEDIDO:
        Cliente: ${data.name || 'Cliente'}
        Venda ID: ${data.saleCode || ''}
        Valor Final: ${totalText}
        Lista de Itens:
        ${productsListText}

        Escreva uma mensagem curta para WhatsApp com agradecimento e emojis.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          temperature: 0.2,
          systemInstruction: "Você é um assistente de elite da BelConfort. Seu tom é executivo, acolhedor e focado em eficiência."
        }
      });

      res.json({ message: response.text || "" });
    } catch (error: any) {
      console.error("[Server Error] Generate message failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  const customCatalogPath = path.join(process.cwd(), 'custom_catalog.json');

  // Helper to load custom catalog from disk
  const loadCustomCatalog = (): any[] => {
    try {
      if (fs.existsSync(customCatalogPath)) {
        return JSON.parse(fs.readFileSync(customCatalogPath, 'utf8'));
      }
    } catch (e) {
      console.error("[Server] Error reading custom_catalog.json:", e);
    }
    return [];
  };

  // Helper to save custom catalog to disk
  const saveCustomCatalog = (catalog: any[]) => {
    try {
      fs.writeFileSync(customCatalogPath, JSON.stringify(catalog, null, 2), 'utf8');
    } catch (e) {
      console.error("[Server] Error writing custom_catalog.json:", e);
    }
  };

  // GET /api/catalog - Returns list of custom products to sync across devices
  app.get("/api/catalog", (req, res) => {
    const catalog = loadCustomCatalog();
    res.json(catalog);
  });

  // API Route to add a product to types.ts and custom_catalog.json
  app.post("/api/catalog", async (req, res) => {
    try {
      const { name, price } = req.body;
      if (!name || typeof price !== "number") {
        return res.status(400).json({ error: "Nome e preço são obrigatórios." });
      }

      const formattedName = name.trim().toUpperCase();
      const typesPath = path.join(process.cwd(), 'types.ts');
      
      // 1. Add to types.ts so it remains fixed under codebase exports
      if (fs.existsSync(typesPath)) {
        let content = fs.readFileSync(typesPath, 'utf8');
        
        // Check if product already exists in source file (case insensitive search)
        const uContent = content.toUpperCase();
        if (!uContent.includes(`"${formattedName}"`) && !uContent.includes(`'${formattedName}'`)) {
          const searchString = 'export const PRODUCT_CATALOG: CatalogItem[] = [';
          const insertIndex = content.indexOf(searchString);
          
          if (insertIndex !== -1) {
            // Insert right after the opening square bracket
            const insertPosition = insertIndex + searchString.length;
            const newItemString = `\n  { name: "${formattedName}", price: ${price.toFixed(2)} },`;
            
            const newContent = content.slice(0, insertPosition) + newItemString + content.slice(insertPosition);
            fs.writeFileSync(typesPath, newContent, 'utf8');
            console.log(`[Server] Gravado no types.ts: ${formattedName}`);
          }
        }
      }

      // 2. Add to custom_catalog.json for device sync
      const catalog = loadCustomCatalog();
      const exists = catalog.some(p => p.name.toUpperCase() === formattedName);
      if (!exists) {
        catalog.push({ name: formattedName, price });
        saveCustomCatalog(catalog);
        console.log(`[Server] Gravado no custom_catalog.json: ${formattedName}`);
      }

      res.json({ success: true, message: "Produto cadastrado e sincronizado com sucesso!" });
    } catch (error: any) {
      console.error("[Server Error] Falha ao atualizar catálogo:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/catalog - Removes a custom product from types.ts and custom_catalog.json
  app.delete("/api/catalog", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Nome é obrigatório." });
      }

      const formattedName = name.trim().toUpperCase();
      const typesPath = path.join(process.cwd(), 'types.ts');

      // 1. Remove from types.ts source code if exists
      if (fs.existsSync(typesPath)) {
        let content = fs.readFileSync(typesPath, 'utf8');
        
        // Find and remove { name: "PRODUCT", price: ... } pattern
        const escapedName = formattedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\s*\\{\\s*name:\\s*["']${escapedName}["']\\s*,\\s*price:\\s*\\d+(\\.\\d+)?\\s*\\}\\s*,?`, 'i');
        
        if (regex.test(content)) {
          const newContent = content.replace(regex, '');
          fs.writeFileSync(typesPath, newContent, 'utf8');
          console.log(`[Server] Removido do types.ts: ${formattedName}`);
        }
      }

      // 2. Remove from custom_catalog.json
      let catalog = loadCustomCatalog();
      const initialLength = catalog.length;
      catalog = catalog.filter(p => p.name.toUpperCase() !== formattedName);
      if (catalog.length !== initialLength) {
        saveCustomCatalog(catalog);
        console.log(`[Server] Removido do custom_catalog.json: ${formattedName}`);
      }

      res.json({ success: true, message: "Produto removido com sucesso!" });
    } catch (error: any) {
      console.error("[Server Error] Falha ao remover produto:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
