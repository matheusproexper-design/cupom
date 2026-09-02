import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Supabase client for official product catalog lookup
  const supabaseUrl = 'https://qdjmxoaxxgdpxgtpbaqt.supabase.co';
  const supabaseKey = 'sb_publishable_q47gD-GrwsLfWh-yxD9kSA_uvZamJrZ';
  const supabase = createClient(supabaseUrl, supabaseKey);

  let cachedSupabaseProducts: Array<{ id?: string; codigo?: string; nome: string; preco: number }> = [];
  let lastSupabaseFetchTime = 0;

  async function getSupabaseCatalog(): Promise<Array<{ id?: string; codigo?: string; nome: string; preco: number }>> {
    const now = Date.now();
    if (cachedSupabaseProducts.length > 0 && (now - lastSupabaseFetchTime < 60000)) {
      return cachedSupabaseProducts;
    }
    try {
      const { data, error } = await supabase
        .from('produtos')
        .select('id, codigo, nome, preco')
        .order('nome', { ascending: true });
      if (!error && data && data.length > 0) {
        cachedSupabaseProducts = data;
        lastSupabaseFetchTime = now;
        console.log(`[Supabase Server] ${data.length} produtos carregados do Supabase.`);
      }
    } catch (err) {
      console.warn('[Supabase Server] Erro ao consultar produtos:', err);
    }
    return cachedSupabaseProducts;
  }

  // Pre-load catalog on startup
  getSupabaseCatalog().catch(() => {});

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

  // Candidate models for automatic fallback in case of high demand
  const FALLBACK_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.6-flash'];

  // Helper to call Gemini with multi-model fallback
  async function generateContentWithFallback(ai: any, params: {
    contents: string;
    config?: any;
  }) {
    let lastError: any = null;
    for (const modelName of FALLBACK_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: params.contents,
          config: params.config,
        });
        if (response && response.text) {
          return response;
        }
      } catch (err: any) {
        console.warn(`[Gemini] Model ${modelName} failed or busy:`, err?.message || err);
        lastError = err;
      }
    }
    throw lastError || new Error("Modelos de IA ocupados no momento.");
  }

  // Deterministic intelligent local parser fallback when AI is experiencing high demand
  function parseReceiptWithRegex(text: string, catalogItems: Array<{ codigo?: string; nome: string; preco?: number }> = []): any {
    const clean = text.replace(/\r\n/g, '\n');
    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);

    const clientData: any = {};
    const items: Array<{ code?: string; name: string; quantity: number; price?: number }> = [];

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
      if (isProdLine || catalogItems.some(cat => line.toUpperCase().includes(cat.nome.toUpperCase().slice(0, 15)))) {
        const qtyMatch = line.match(/^(\d+)x?\s+/i) || line.match(/(\d+)\s+(?:unidades?|un|pe[cç]as?|x)/i) || line.match(/\b(\d+)\b/);
        const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

        let matchedItem: { codigo?: string; nome: string; preco?: number } | null = null;
        for (const cat of catalogItems) {
          const keywords = cat.nome.toUpperCase().split(' ').filter(k => k.length > 2);
          const matchCount = keywords.filter(k => line.toUpperCase().includes(k)).length;
          if (matchCount >= 2 || line.toUpperCase().includes(cat.nome.toUpperCase())) {
            matchedItem = cat;
            break;
          }
        }

        let matchedName = matchedItem ? matchedItem.nome : line.replace(/^(?:produtos?|itens?|item|\d+x?|\d+)\s*[:\-]?\s*/i, '').trim().toUpperCase();

        if (matchedName && matchedName.length > 3 && !/^(?:cliente|endere[cç]o|valor|pagamento|data|telefone)/i.test(matchedName)) {
          items.push({
            code: matchedItem?.codigo || Math.floor(100000 + Math.random() * 900000).toString(),
            name: matchedName,
            price: matchedItem?.preco || 0,
            quantity: isNaN(qty) || qty < 1 ? 1 : qty,
          });
        }
      }
    }

    // Check for gifts like "travesseiro"
    if (/travesseiro/i.test(clean) && !items.some(i => /travesseiro/i.test(i.name))) {
      items.push({
        code: "612212",
        name: "TRAVESSEIRO FLOCOS CONFORTO 20CM 60X40 BRANCO",
        quantity: 1,
        price: 0
      });
    }

    return { clientData, items };
  }

  // Fast AI import route powered by Supabase catalog
  app.post("/api/parse-receipt", async (req, res) => {
    try {
      const { text, catalogNames = [] } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Texto do pedido é obrigatório." });
      }

      const ai = getAi();
      
      // 1. Fetch live Supabase products catalog (source of truth)
      const supabaseProducts = await getSupabaseCatalog();
      
      // Merge with client-supplied names if any
      const catalogMap = new Map<string, { codigo?: string; nome: string; preco?: number }>();
      supabaseProducts.forEach(p => {
        catalogMap.set(p.nome.trim().toUpperCase(), p);
      });
      (catalogNames as string[]).forEach(n => {
        const u = n.trim().toUpperCase();
        if (!catalogMap.has(u)) {
          catalogMap.set(u, { nome: u, preco: 0 });
        }
      });

      const catalogItems = Array.from(catalogMap.values());
      const catalogFormattedList = catalogItems
        .map(p => `- ${p.nome}${p.preco ? ` | R$ ${p.preco}` : ''}${p.codigo ? ` [Cód: ${p.codigo}]` : ''}`)
        .join('\n');

      const prompt = `
        Você é um extrator de inteligência artificial de alta precisão da BelConfort.
        
        IMPORTANTE: OS PRODUTOS OFICIAIS DA BELCONFORT ESTÃO NO CATÁLOGO DO SUPABASE ABAIXO:
        === CATÁLOGO OFICIAL NO SUPABASE (TABELA PRODUTOS) ===
        ${catalogFormattedList}
        ======================================================

        DIRETRIZES ESSENCIAIS DE EXTRAÇÃO:
        1. Para cada produto do pedido, você DEVE encontrar a correspondência EXATA com um item do catálogo no Supabase acima.
        2. Retorne o nome EXATO conforme registrado no Supabase (ex: "COLCHÃO D33 20CM SOLTEIRO BEGE", "BASE BOX BILÚ 40CM CASAL PRETO", etc.).
        3. Preencha o código (code) e o preço (price) conforme o catálogo do Supabase, a não ser que haja um preço unitário específico negociado no texto.
        4. BRINDES: Se o cliente ganhou travesseiro de cortesia ou brinde, adicione "TRAVESSEIRO FLOCOS CONFORTO 20CM 60X40 BRANCO" com price: 0 e a quantidade ganha.
        5. DADOS DO CLIENTE: Extraia nome, cpf/cnpj, telefones (contact1, contact2), endereço completo (street, number, neighborhood, city, complement), data e forma de pagamento (PIX, CARTÃO, DINHEIRO, etc.).

        TEXTO DO PEDIDO:
        ${text}
      `;

      try {
        const response = await generateContentWithFallback(ai, {
          contents: prompt,
          config: {
            temperature: 0.1,
            systemInstruction: "Você é um assistente de vendas da BelConfort especializado em reconhecer e mapear produtos no catálogo do Supabase.",
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
                      code: { type: Type.STRING },
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
          const parsed = JSON.parse(jsonText);
          
          // Post-process items to ensure Supabase codes and prices are accurate
          if (parsed.items && Array.isArray(parsed.items)) {
            parsed.items = parsed.items.map((item: any) => {
              const matched = catalogItems.find(c => c.nome.toUpperCase() === (item.name || '').trim().toUpperCase()) ||
                              catalogItems.find(c => c.nome.toUpperCase().includes((item.name || '').trim().toUpperCase()));
              return {
                code: item.code || matched?.codigo || Math.floor(100000 + Math.random() * 900000).toString(),
                name: matched ? matched.nome : (item.name || '').toUpperCase(),
                quantity: item.quantity || 1,
                price: (item.price !== undefined && item.price !== null && item.price > 0) ? item.price : (matched?.preco || item.price || 0)
              };
            });
          }

          return res.json(parsed);
        }
      } catch (aiErr) {
        console.warn("[Server Gemini Fallback] IA ocupada, usando extrator com catálogo do Supabase:", aiErr);
        const fallbackResult = parseReceiptWithRegex(text, catalogItems);
        return res.json(fallbackResult);
      }

      const fallbackResult = parseReceiptWithRegex(text, catalogItems);
      return res.json(fallbackResult);
    } catch (error: any) {
      console.error("[Server Error] Parse receipt failed:", error);
      try {
        const supabaseProducts = await getSupabaseCatalog();
        const fallbackResult = parseReceiptWithRegex(req.body.text || '', supabaseProducts);
        return res.json(fallbackResult);
      } catch (fErr) {
        res.status(500).json({ error: "Erro ao processar pedido." });
      }
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

      const response = await generateContentWithFallback(ai, {
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

      // 3. Sync with Supabase produtos table
      try {
        await supabase.from('produtos').insert([{
          codigo: Math.floor(100000 + Math.random() * 900000).toString(),
          nome: formattedName,
          preco: price
        }]);
        // Invalidate server cache so next parse has the new item
        cachedSupabaseProducts = [];
        console.log(`[Server] Gravado no Supabase: ${formattedName}`);
      } catch (sbErr) {
        console.warn('[Server] Não foi possível persistir no Supabase:', sbErr);
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

      // Invalidate server cache
      cachedSupabaseProducts = [];

      res.json({ success: true, message: "Produto removido com sucesso!" });
    } catch (error: any) {
      console.error("[Server Error] Falha ao remover produto:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Receipts Snapshots Backup Endpoints
  const snapshotsPath = path.join(process.cwd(), 'receipts_snapshots.json');
  const loadSnapshots = (): Record<string, any> => {
    try {
      if (fs.existsSync(snapshotsPath)) {
        return JSON.parse(fs.readFileSync(snapshotsPath, 'utf8'));
      }
    } catch (e) {
      console.error("[Server] Error reading receipts_snapshots.json:", e);
    }
    return {};
  };

  const saveSnapshots = (data: Record<string, any>) => {
    try {
      fs.writeFileSync(snapshotsPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error("[Server] Error writing receipts_snapshots.json:", e);
    }
  };

  app.get("/api/receipts-snapshots", (req, res) => {
    res.json(loadSnapshots());
  });

  app.post("/api/receipts-snapshots", (req, res) => {
    const { id, snapshot } = req.body;
    if (id && snapshot) {
      const all = loadSnapshots();
      all[id] = snapshot;
      saveSnapshots(all);
    }
    res.json({ success: true });
  });

  app.delete("/api/receipts-snapshots/:id", (req, res) => {
    const { id } = req.params;
    if (id) {
      const all = loadSnapshots();
      if (all[id]) {
        delete all[id];
        saveSnapshots(all);
      }
    }
    res.json({ success: true });
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
