import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

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
