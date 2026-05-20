import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route to add a product to types.ts
  app.post("/api/catalog", async (req, res) => {
    try {
      const { name, price } = req.body;
      if (!name || typeof price !== "number") {
        return res.status(400).json({ error: "Nome e preço são obrigatórios." });
      }

      const formattedName = name.trim().toUpperCase();
      const typesPath = path.join(process.cwd(), 'types.ts');
      
      if (!fs.existsSync(typesPath)) {
        return res.status(404).json({ error: "Arquivo types.ts não encontrado." });
      }

      let content = fs.readFileSync(typesPath, 'utf8');
      
      // Check if product already exists (case insensitive search to be safe)
      const uContent = content.toUpperCase();
      if (uContent.includes(`"${formattedName}"`) || uContent.includes(`'${formattedName}'`)) {
        return res.status(400).json({ error: "Este produto já existe no catálogo do types.ts." });
      }

      const searchString = 'export const PRODUCT_CATALOG: CatalogItem[] = [';
      const insertIndex = content.indexOf(searchString);
      
      if (insertIndex === -1) {
        return res.status(500).json({ error: "Não foi possível localizar o PRODUCT_CATALOG no types.ts" });
      }

      // Insert right after the opening square bracket
      const insertPosition = insertIndex + searchString.length;
      const newItemString = `\n  { name: "${formattedName}", price: ${price.toFixed(2)} },`;
      
      const newContent = content.slice(0, insertPosition) + newItemString + content.slice(insertPosition);
      fs.writeFileSync(typesPath, newContent, 'utf8');

      console.log(`[Server] Novo produto cadastrado e fixado no types.ts: ${formattedName} (R$ ${price})`);
      res.json({ success: true, message: "Produto cadastrado e fixado no types.ts com sucesso!" });
    } catch (error: any) {
      console.error("[Server Error] Falha ao atualizar types.ts:", error);
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
