
import React, { useState, useEffect, useRef } from 'react';
import { INITIAL_DATA, ReceiptData, PRODUCTS_LIST, PRODUCT_CATALOG, Product, CatalogItem } from './types';
import { generateReceiptPDF, getReceiptBlob } from './services/pdfService';
import { generateClientMessage, parseReceiptFromText, parseReceiptLocally } from './services/geminiService';
import { supabase } from './services/supabase';
import { Input, Select, TextArea } from './components/Input';
import { ReceiptHistoryModal } from './components/ReceiptHistoryModal';
import { 
  Calendar, User, MapPin, Hash, Map, Building2, 
  Phone, Download, Printer, CreditCard, Plus, Trash2, Tag, Percent, Search,
  ShieldCheck, Mail, MessageCircle, FileText, Sparkles, Loader2, Barcode,
  Users, UserPlus, ExternalLink, Share2, Copy, RotateCcw, AlertTriangle, History,
  CheckCircle2, RefreshCw, Database, Lock, Eye, EyeOff, ShieldAlert,
  Palette, Layers, ShoppingBag, ArrowRight, Maximize2, X, Wand2, UserCheck, MessageSquare
} from 'lucide-react';
import Fuse from 'fuse.js';
import JsBarcode from 'jsbarcode';

const STORAGE_KEY = 'belconfort_receipt_data';
const TEAM_STORAGE_KEY = 'belconfort_team_list';
const ADMIN_DELETE_PASSWORD = '50735073Math@';

// Initialize Fuse instance outside component for performance
const fuse = new Fuse(PRODUCTS_LIST, {
  includeScore: true,
  threshold: 0.4, // 0.0 is exact match, 1.0 is match anything. 0.4 is good for typos.
  ignoreLocation: true, // Allows "Box Casal" to match "Base Box Bilú Casal"
});

// Barcode Component for Preview
const BarcodePreview = ({ code }: { code: string }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  
  useEffect(() => {
    if (imgRef.current && code) {
      try {
        const canvas = document.createElement('canvas');
        JsBarcode(canvas, code, {
          format: "CODE128",
          width: 1, // Denser barcode
          height: 30,
          displayValue: false,
          margin: 0,
          background: 'transparent',
          lineColor: '#000000'
        });
        imgRef.current.src = canvas.toDataURL();
      } catch(e) { /* ignore */ }
    }
  }, [code]);

  if (!code) return null;
  return <img ref={imgRef} alt="barcode" className="h-2.5 w-auto max-w-full object-contain opacity-80 mix-blend-multiply mt-0.5" />;
}

export default function App() {
  // Initialize state from localStorage or default
  const [data, setData] = useState<ReceiptData>(() => {
    try {
      const savedData = localStorage.getItem(STORAGE_KEY);
      if (savedData) {
        // Merge with INITIAL_DATA to ensure schema compatibility if fields are added later
        return { ...INITIAL_DATA, ...JSON.parse(savedData) };
      }
    } catch (error) {
      console.error("Failed to load from local storage", error);
    }
    return INITIAL_DATA;
  });

  // Salespeople Team State - Updated with new requested names
  const [salespeople, setSalespeople] = useState<string[]>(() => {
    try {
      const savedTeam = localStorage.getItem(TEAM_STORAGE_KEY);
      if (savedTeam) {
        return JSON.parse(savedTeam);
      }
    } catch (error) {}
    return ['ROBSON', 'SARA', 'MATHEUS', 'GABRIEL', 'JEFFERSON', 'ITALO', 'MANOELA', 'ANA', 'DEBORA'];
  });

  const [newSalespersonName, setNewSalespersonName] = useState("");

  // UI State
  const [activeTab, setActiveTab] = useState<'manual' | 'import' | 'catalog'>('manual');
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<{title: string, msg: string} | null>(null);

  // Custom Products Catalog State
  const [customProducts, setCustomProducts] = useState<CatalogItem[]>(() => {
    try {
      const saved = localStorage.getItem('belconfort_custom_catalog');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("Failed to load custom catalog from localStorage", e);
    }
    return [];
  });

  // Fetch custom catalog from server on app load to sync across different devices
  useEffect(() => {
    const fetchServerCatalog = async () => {
      try {
        const response = await fetch('/api/catalog');
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            setCustomProducts(data);
          }
        }
      } catch (err) {
        console.error("[BelConfort] Falha ao sincronizar catálogo centralizado do servidor:", err);
      }
    };
    fetchServerCatalog();
  }, []);

  // 5 inputs to compose the product name in exact sequence: CATEGORIA -> PRODUTO -> ALTURA -> TAMANHO -> COR
  const [newProdCategoria, setNewProdCategoria] = useState("");
  const [newProdProduto, setNewProdProduto] = useState("");
  const [newProdAltura, setNewProdAltura] = useState("");
  const [newProdTamanho, setNewProdTamanho] = useState("");
  const [newProdCor, setNewProdCor] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");

  // Product name composed dynamically from the 5 inputs
  const computedProductName = React.useMemo(() => {
    return [
      newProdCategoria.trim(),
      newProdProduto.trim(),
      newProdAltura.trim(),
      newProdTamanho.trim(),
      newProdCor.trim()
    ].filter(Boolean).join(" ").toUpperCase();
  }, [newProdCategoria, newProdProduto, newProdAltura, newProdTamanho, newProdCor]);

  // Combined product catalog
  const fullCatalog = React.useMemo(() => {
    const combined = [...customProducts, ...PRODUCT_CATALOG];
    return combined.sort((a, b) => a.name.localeCompare(b.name));
  }, [customProducts]);

  const fullProductsList = React.useMemo(() => {
    return fullCatalog.map(p => p.name);
  }, [fullCatalog]);

  // Update Fuse search collections whenever catalog updates
  useEffect(() => {
    fuse.setCollection(fullProductsList);
  }, [fullProductsList]);

  // Save custom catalog to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('belconfort_custom_catalog', JSON.stringify(customProducts));
  }, [customProducts]);

  // Temporary state for adding a product
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedPrice, setSelectedPrice] = useState("");
  const [selectedQuantity, setSelectedQuantity] = useState("1");
  const [selectedProductCode, setSelectedProductCode] = useState("");
  const [isExchange, setIsExchange] = useState(false);
  const [exchangeDetails, setExchangeDetails] = useState("");

  // Search state & Supabase Products
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [supabaseProducts, setSupabaseProducts] = useState<Array<{ id?: string; codigo?: string; nome: string; preco: number }>>([]);
  const [isSearchingSupabase, setIsSearchingSupabase] = useState(false);

  // Catalog tab & Supabase product catalog state
  const [allSupabaseCatalog, setAllSupabaseCatalog] = useState<Array<{ id: string; codigo: string; nome: string; preco: number; criado_em?: string }>>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isSavingCustomProduct, setIsSavingCustomProduct] = useState(false);
  const [customProductSuccess, setCustomProductSuccess] = useState<string | null>(null);
  const [catalogSearchTerm, setCatalogSearchTerm] = useState("");

  // State for discount and shipping input as string
  const [discountInput, setDiscountInput] = useState("");
  const [shippingInput, setShippingInput] = useState("");
  const [isSavingSupabase, setIsSavingSupabase] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // Onboarding / Welcome Modal State for Smart Import & Attendant Identification
  const [isWelcomeModalOpen, setIsWelcomeModalOpen] = useState(false);
  const [modalSalesperson, setModalSalesperson] = useState(() => {
    return localStorage.getItem('belconfort_saved_salesperson') || '';
  });
  const [modalImportText, setModalImportText] = useState("");
  const [isModalImporting, setIsModalImporting] = useState(false);
  const [modalImportError, setModalImportError] = useState<{ title: string; msg: string } | null>(null);

  // Automatically require attendant identification on first entry if no name is saved
  useEffect(() => {
    const saved = localStorage.getItem('belconfort_saved_salesperson');
    if (saved && saved.trim()) {
      setData(prev => ({
        ...prev,
        salesperson: prev.salesperson || saved.trim()
      }));
      setModalSalesperson(saved.trim());
    } else {
      // Obligatory lock: Open modal and require salesperson identification
      setIsWelcomeModalOpen(true);
    }
  }, []);

  // Security password state for deleting products from catalog/Supabase
  const [productToDelete, setProductToDelete] = useState<{ id?: string; name: string; preco?: number; codigo?: string } | null>(null);
  const [deleteProductPassword, setDeleteProductPassword] = useState("");
  const [showDeleteProductPassword, setShowDeleteProductPassword] = useState(false);
  const [deleteProductPasswordError, setDeleteProductPasswordError] = useState("");
  const [isDeletingProduct, setIsDeletingProduct] = useState(false);

  // Fetch all products from Supabase catalog
  const fetchCatalogFromSupabase = async () => {
    setIsLoadingCatalog(true);
    try {
      const { data, error } = await supabase
        .from('produtos')
        .select('*')
        .order('nome', { ascending: true });
      if (!error && data) {
        setAllSupabaseCatalog(data);
      } else if (error) {
        console.error('[Supabase] Erro ao carregar catálogo completo:', error);
      }
    } catch (err) {
      console.error('[Supabase] Falha ao consultar catálogo de produtos:', err);
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  useEffect(() => {
    fetchCatalogFromSupabase();
  }, []);

  // Debounce effect for search term
  useEffect(() => {
    if (!searchTerm) {
      setDebouncedSearchTerm("");
      return;
    }

    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // 1. Fetch & list products pulling directly from Supabase 'produtos' table
  useEffect(() => {
    let isCurrent = true;
    const fetchSupabaseProducts = async () => {
      setIsSearchingSupabase(true);
      try {
        let query = supabase
          .from('produtos')
          .select('*')
          .order('nome', { ascending: true });

        const term = debouncedSearchTerm.trim();
        if (term) {
          query = query.ilike('nome', `%${term}%`);
        } else {
          query = query.limit(50);
        }

        const { data: results, error } = await query;
        if (error) {
          console.error('[Supabase] Erro ao pesquisar produtos:', error);
          if (isCurrent) {
            // Fallback locally
            const fallback = fullCatalog
              .filter(p => !term || p.name.toLowerCase().includes(term.toLowerCase()))
              .map(p => ({
                codigo: Math.floor(100000 + Math.random() * 900000).toString(),
                nome: p.name,
                preco: p.price
              }));
            setSupabaseProducts(fallback);
          }
        } else if (isCurrent && results) {
          setSupabaseProducts(results);
        }
      } catch (err) {
        console.error('[Supabase] Falha ao consultar tabela produtos:', err);
      } finally {
        if (isCurrent) {
          setIsSearchingSupabase(false);
        }
      }
    };

    fetchSupabaseProducts();

    return () => {
      isCurrent = false;
    };
  }, [debouncedSearchTerm, fullCatalog]);

  // Save to localStorage whenever data changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  // Save team to localStorage
  useEffect(() => {
    localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(salespeople));
  }, [salespeople]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setData(prev => ({ ...prev, [name]: value }));
  };

  const handleResetData = () => {
    if (window.confirm("Tem certeza que deseja iniciar um novo atendimento? Todos os dados atuais serão apagados.")) {
        setData(INITIAL_DATA);
        setSearchTerm("");
        setDiscountInput("");
        setShippingInput("");
        setSelectedProduct("");
        setSelectedPrice("");
        setSelectedQuantity("1");
        setSelectedProductCode("");
        setImportText("");
        setImportError(null);
        setActiveTab('manual');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleAddSalesperson = () => {
    if (newSalespersonName.trim()) {
      const name = newSalespersonName.trim().toUpperCase();
      if (!salespeople.includes(name)) {
        setSalespeople([...salespeople, name]);
      }
      setNewSalespersonName("");
    }
  };

  const handleRemoveSalesperson = (name: string) => {
    setSalespeople(salespeople.filter(s => s !== name));
  };

  const saveProductToTypesTS = async (name: string, price: number) => {
    try {
      const response = await fetch('/api/catalog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, price }),
      });
      if (response.ok) {
        console.log(`[BelConfort Disk] Produto "${name}" gravado com sucesso no types.ts!`);
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.warn(`[BelConfort Disk] Aviso: ${errorData.error || "Erro de rede"}`);
      }
    } catch (err) {
      console.error("[BelConfort Disk] Erro ao enviar produto para gravação:", err);
    }
  };

  const handleAddCustomProduct = async () => {
    const name = computedProductName.trim();
    if (!name) {
      alert("Preencha os campos para formar o nome do produto.");
      return;
    }
    
    // Parse the default price (handling comma as decimal separator)
    const priceValue = parseFloat(newProductPrice.replace('.', '').replace(',', '.') || "0");
    
    setIsSavingCustomProduct(true);
    setCustomProductSuccess(null);

    const generatedCode = Math.floor(100000 + Math.random() * 900000).toString();

    // 1. Persist directly to Supabase produtos table
    try {
      const { error } = await supabase.from('produtos').insert([{
        codigo: generatedCode,
        nome: name,
        preco: priceValue
      }]);

      if (error) {
        console.error('[Supabase] Erro ao salvar novo produto:', error);
        alert(`Erro ao salvar no Supabase: ${error.message}`);
      } else {
        setCustomProductSuccess(`Produto "${name}" salvo com sucesso no Supabase!`);
        setTimeout(() => setCustomProductSuccess(null), 4000);
      }
    } catch (err) {
      console.error('[Supabase] Erro inesperado ao salvar no Supabase:', err);
    } finally {
      setIsSavingCustomProduct(false);
    }

    const newProductItem: CatalogItem = {
      name,
      price: priceValue
    };

    setCustomProducts(prev => [...prev.filter(p => p.name !== name), newProductItem]);
    
    // Persist in types.ts via Server API
    saveProductToTypesTS(name, priceValue);

    // Refresh both Supabase lists
    await fetchCatalogFromSupabase();

    setNewProdCategoria("");
    setNewProdProduto("");
    setNewProdAltura("");
    setNewProdTamanho("");
    setNewProdCor("");
    setNewProductPrice("");
  };

  const handleRequestDeleteProduct = (id?: string, name?: string, preco?: number, codigo?: string) => {
    if (!name) return;
    setProductToDelete({ id, name, preco, codigo });
    setDeleteProductPassword("");
    setShowDeleteProductPassword(false);
    setDeleteProductPasswordError("");
  };

  const handleConfirmDeleteProductWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productToDelete || !productToDelete.name) return;

    if (deleteProductPassword !== ADMIN_DELETE_PASSWORD) {
      setDeleteProductPasswordError("Senha incorreta! Não autorizado a excluir produto.");
      return;
    }

    const { id, name } = productToDelete;
    setIsDeletingProduct(true);

    try {
      setCustomProducts(prev => prev.filter(p => p.name !== name));

      // 1. Delete from Supabase produtos table
      try {
        if (id && !id.startsWith('custom-')) {
          const { error } = await supabase.from('produtos').delete().eq('id', id);
          if (error) console.error('[Supabase] Erro ao deletar por ID:', error);
        } else {
          const { error } = await supabase.from('produtos').delete().ilike('nome', name);
          if (error) console.error('[Supabase] Erro ao deletar por nome:', error);
        }
      } catch (err) {
        console.error('[Supabase] Erro ao remover produto:', err);
      }

      // 2. Delete from server disk types.ts
      try {
        await fetch('/api/catalog', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name }),
        });
      } catch (err) {
        console.error("[BelConfort Disk] Erro ao sincronizar remoção no servidor:", err);
      }

      // 3. Refresh catalog
      await fetchCatalogFromSupabase();
      setProductToDelete(null);
      setDeleteProductPassword("");
      setDeleteProductPasswordError("");
    } catch (err) {
      console.error("Erro ao excluir produto:", err);
    } finally {
      setIsDeletingProduct(false);
    }
  };

  const handleSearchSelect = (product: { id?: string; codigo?: string; nome: string; preco: number }) => {
    setSelectedProduct(product.nome);
    setSelectedProductCode(product.codigo || "");
    setSearchTerm(product.nome);
    setDebouncedSearchTerm(product.nome);
    setIsSearchOpen(false);
    
    // Auto-fill price
    if (product.preco !== undefined && product.preco !== null) {
      setSelectedPrice(Number(product.preco).toFixed(2).replace('.', ','));
    } else {
      setSelectedPrice("");
    }
  };

  const handleAddProduct = () => {
    const productName = (selectedProduct || searchTerm.trim()).toUpperCase();
    if (!productName) return;
    
    // Parse the price input (handling comma as decimal separator)
    const priceValue = parseFloat(selectedPrice.replace('.', '').replace(',', '.') || "0");
    const quantityValue = parseInt(selectedQuantity) || 1;
    
    // Auto-save to catalog and Supabase if it's a new product
    const exists = fullCatalog.some(p => p.name.toUpperCase() === productName.trim().toUpperCase());
    if (!exists) {
      const newProductItem: CatalogItem = {
        name: productName,
        price: priceValue
      };
      setCustomProducts(prev => [...prev, newProductItem]);
      
      // Auto-save to types.ts on local disk
      saveProductToTypesTS(productName, priceValue);

      // Auto-save directly to Supabase
      supabase.from('produtos').insert([{
        codigo: Math.floor(100000 + Math.random() * 900000).toString(),
        nome: productName,
        preco: priceValue
      }]).then(({ error }) => {
        if (error) console.error('[Supabase] Erro ao cadastrar produto:', error);
        fetchCatalogFromSupabase();
      });
    }

    // Generate a pseudo-code (Numeric only - 6 digits) or use Supabase product code
    const productCode = selectedProductCode || Math.floor(100000 + Math.random() * 900000).toString();

    const newProduct: Product = {
      code: productCode,
      name: productName,
      price: priceValue,
      quantity: quantityValue,
      warrantyTime: "", // Default empty, user edits in list
      warrantyUnit: "MESES", // Default unit
      isExchange: isExchange,
      exchangeDetails: isExchange ? exchangeDetails : ""
    };

    setData(prev => ({
      ...prev,
      products: [...prev.products, newProduct]
    }));

    // Reset inputs
    setSelectedProduct("");
    setSelectedProductCode("");
    setSearchTerm("");
    setDebouncedSearchTerm("");
    setSelectedPrice("");
    setSelectedQuantity("1");
    setIsExchange(false);
    setExchangeDetails("");
  };

  const handleRemoveProduct = (index: number) => {
    setData(prev => ({
      ...prev,
      products: prev.products.filter((_, i) => i !== index)
    }));
  };

  const handleUpdateProductWarranty = (index: number, field: 'time' | 'unit', value: string) => {
    setData(prev => {
        const newProducts = prev.products.map((p, i) => {
            if (i === index) {
                if (field === 'time') {
                    return { ...p, warrantyTime: value };
                } else {
                    return { ...p, warrantyUnit: value as 'DIAS' | 'MESES' | 'ANOS' };
                }
            }
            return p;
        });
        return { ...prev, products: newProducts };
    });
  };

  const handleUpdateProductExchangeDetails = (index: number, value: string) => {
    setData(prev => {
        const newProducts = prev.products.map((p, i) => {
            if (i === index) {
                return { ...p, exchangeDetails: value };
            }
            return p;
        });
        return { ...prev, products: newProducts };
    });
  };

  const handleDiscountInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDiscountInput(val);
    const num = parseFloat(val.replace('.', '').replace(',', '.') || "0");
    setData(prev => ({ ...prev, discountValue: num }));
  };

  const handleDiscountTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setData(prev => ({ ...prev, discountType: e.target.value as 'fixed' | 'percentage' }));
  };

  const handleShippingInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setShippingInput(val);
    const num = parseFloat(val.replace('.', '').replace(',', '.') || "0");
    setData(prev => ({ ...prev, shippingValue: num }));
  };

  const handleSmartImport = async () => {
    if (!importText.trim()) return;

    setIsImporting(true);
    setImportError(null);
    try {
      // Pass the system product list so AI can match exact names
      const result = await parseReceiptFromText(importText, fullProductsList);
      
      // LOGIC UPDATE: Check existing products in the cart to update quantity instead of duplicating
      // Create a working copy of current products
      let updatedProducts = [...data.products];
      
      if (result.items && Array.isArray(result.items)) {
        result.items.forEach((item: { name: string, quantity: number, price?: number }) => {
            if (!item.name) return;
            const targetName = item.name.trim().toUpperCase();
            const systemProduct = fullCatalog.find(p => p.name.toUpperCase() === targetName) ||
                                  fullCatalog.find(p => p.name.toUpperCase().includes(targetName) || targetName.includes(p.name.toUpperCase()));
            
            const prodName = systemProduct ? systemProduct.name : targetName;
            const prodPrice = systemProduct ? systemProduct.price : (item.price || 0);
            const quantityToAdd = item.quantity || 1;

            // Check if product already exists in the cart
            const existingProductIndex = updatedProducts.findIndex(p => p.name.toUpperCase() === prodName.toUpperCase());

            if (existingProductIndex >= 0) {
                // Update quantity
                const existingProduct = updatedProducts[existingProductIndex];
                updatedProducts[existingProductIndex] = {
                    ...existingProduct,
                    quantity: existingProduct.quantity + quantityToAdd
                };
            } else {
                // Add new product
                const pseudoCode = Math.floor(100000 + Math.random() * 900000).toString();
                
                updatedProducts.push({
                    code: pseudoCode,
                    name: prodName,
                    price: prodPrice,
                    quantity: quantityToAdd,
                    warrantyTime: "",
                    warrantyUnit: "MESES"
                });
            }
        });
      }

      setData(prev => ({
        ...prev,
        ...result.clientData, // Merge client data
        products: updatedProducts, // Use the updated list with merged quantities
      }));

      setImportText("");
      setActiveTab('manual'); // Switch back to view result
    } catch (error: any) {
      console.error(error);
      
      let errorTitle = "Erro na Inteligência Artificial";
      let errorMsg = error.message || "Erro desconhecido";
      let detailedMsg = "";

      // Tenta extrair a mensagem JSON se existir (comum em erros do Google)
      try {
        const rawMsg = errorMsg;
        const jsonMatch = rawMsg.match(/\{.*\}/);
        
        if (jsonMatch) {
            const parsedError = JSON.parse(jsonMatch[0]);
            const errObj = parsedError.error || parsedError;
            
            if (errObj) {
                if (
                    (errObj.status === "PERMISSION_DENIED" && errObj.message && errObj.message.includes("leaked")) ||
                    (errObj.message && errObj.message.includes("API key was reported as leaked"))
                ) {
                     errorMsg = "CHAVE API BLOQUEADA PELO GOOGLE";
                     detailedMsg = "Sua API KEY foi detectada como pública (vazada) e bloqueada por segurança.";
                } else {
                     detailedMsg = errObj.message || JSON.stringify(errObj);
                }
            }
        }
      } catch (e) { /* falha no parse */ }

      if (!detailedMsg && (errorMsg.includes("leaked") || errorMsg.includes("API key"))) {
          errorTitle = "CHAVE API BLOQUEADA (VAZAMENTO)";
          errorMsg = "O Google bloqueou sua API KEY por segurança (detectada como pública).";
          detailedMsg = "SOLUÇÃO: Gere uma nova chave no Google AI Studio e atualize a variável 'VITE_API_KEY' na Vercel.";
      }

      setImportError({ title: errorTitle, msg: detailedMsg || errorMsg });
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirmWelcomeModal = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const finalSalesperson = modalSalesperson.trim().toUpperCase();

    // 1. Mandatory salesperson check
    if (!finalSalesperson) {
      alert("Por favor, informe ou selecione quem está na página para liberar o acesso ao sistema.");
      return;
    }

    // Auto-apply and persist salesperson name
    localStorage.setItem('belconfort_saved_salesperson', finalSalesperson);
    setData(prev => ({ ...prev, salesperson: finalSalesperson }));

    // 2. If import text was provided, process via Gemini AI
    if (modalImportText.trim()) {
      setIsModalImporting(true);
      setModalImportError(null);
      try {
        const result = await parseReceiptFromText(modalImportText, fullProductsList);
        
        let updatedProducts = [...data.products];
        if (result.items && Array.isArray(result.items)) {
          result.items.forEach((item: { name: string, quantity: number, price?: number }) => {
            if (!item.name) return;
            const targetName = item.name.trim().toUpperCase();
            const systemProduct = fullCatalog.find(p => p.name.toUpperCase() === targetName) ||
                                  fullCatalog.find(p => p.name.toUpperCase().includes(targetName) || targetName.includes(p.name.toUpperCase()));
            
            const prodName = systemProduct ? systemProduct.name : targetName;
            const prodPrice = systemProduct ? systemProduct.price : (item.price || 0);
            const quantityToAdd = item.quantity || 1;
            const existingProductIndex = updatedProducts.findIndex(p => p.name.toUpperCase() === prodName.toUpperCase());

            if (existingProductIndex >= 0) {
              const existingProduct = updatedProducts[existingProductIndex];
              updatedProducts[existingProductIndex] = {
                ...existingProduct,
                quantity: existingProduct.quantity + quantityToAdd
              };
            } else {
              const pseudoCode = Math.floor(100000 + Math.random() * 900000).toString();
              updatedProducts.push({
                code: pseudoCode,
                name: prodName,
                price: prodPrice,
                quantity: quantityToAdd,
                warrantyTime: "",
                warrantyUnit: "MESES"
              });
            }
          });
        }

        setData(prev => ({
          ...prev,
          ...result.clientData,
          salesperson: finalSalesperson,
          products: updatedProducts,
        }));

        setModalImportText("");
        setIsWelcomeModalOpen(false);
        setActiveTab('manual');
      } catch (error: any) {
        console.error(error);
        // Fallback locally in case of unhandled exception
        try {
          const fallbackResult = parseReceiptLocally(modalImportText, fullProductsList);
          setData(prev => ({
            ...prev,
            ...fallbackResult.clientData,
            salesperson: finalSalesperson,
          }));
          setModalImportText("");
          setIsWelcomeModalOpen(false);
          setActiveTab('manual');
        } catch (fErr) {
          setModalImportError({
            title: "Aviso na Importação",
            msg: "Não foi possível interpretar todos os dados. Você pode preencher os campos diretamente no formulário."
          });
        }
      } finally {
        setIsModalImporting(false);
      }
    } else {
      // Just close the modal and start with the salesperson defined
      setIsWelcomeModalOpen(false);
    }
  };

  // --- MAPS LOGIC ---
  const getAddressUrl = () => {
    const { street, number, neighborhood, city } = data;
    if (!street && !city) return '';
    const query = encodeURIComponent(`${street}, ${number} - ${neighborhood}, ${city}`);
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  };

  const handleOpenMap = () => {
    const url = getAddressUrl();
    if (url) window.open(url, '_blank');
  };

  const handleShareLocation = async () => {
    const url = getAddressUrl();
    if (!url) return;

    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Localização do Cliente - BelConfort',
                text: `Endereço do cliente: ${data.street}, ${data.number} - ${data.neighborhood}`,
                url: url
            });
        } catch (err) {
            console.log('Share canceled');
        }
    } else {
        try {
            await navigator.clipboard.writeText(url);
            alert("Link do mapa copiado para a área de transferência!");
        } catch (err) {
            alert("Não foi possível copiar o link.");
        }
    }
  };

  // --- BUNDLE LOGIC & LABELING ---
  const getBundleDetails = (products: Product[]) => {
    const activeProducts = products.filter(p => !p.isExchange);
    let totalDiscount = 0;
    let hasBaseDiscount = false;
    let hasPillowDiscount = false;

    const specificPillowName = "TRAVESSEIRO FLOCOS CONFORTO 20CM 60X40 BRANCO";

    // 1. Check if there is ANY product other than the specific pillow
    const hasAnyOtherProduct = activeProducts.some(p => p.name !== specificPillowName);

    // --- RULE: Check for any "BASE BAÚ" in the cart ---
    // If a Base Baú is present, the combo discount (Base + Mattress) is disabled.
    const hasBaseBau = activeProducts.some(p => {
        const n = p.name.toUpperCase();
        return n.startsWith("BASE") && (n.includes("BAÚ") || n.includes("BAU"));
    });

    // 2. Identify Inventory of Mattresses (Colchão) for Base Bundle Logic
    let solteiroMattressCount = 0;
    let casalMattressCount = 0;
    let queenMattressCount = 0;
    let superKingMattressCount = 0;

    activeProducts.forEach(p => {
        const name = p.name.toUpperCase();
        if (name.includes("COLCHÃO") || name.includes("COLCHAO")) {
            if (name.includes("SUPER KING")) superKingMattressCount += p.quantity;
            else if (name.includes("QUEEN")) queenMattressCount += p.quantity;
            else if (name.includes("CASAL")) casalMattressCount += p.quantity;
            else if (name.includes("SOLTEIRO") || name.includes("SOLTEIRÃO") || name.includes("SOLTEIRAO")) solteiroMattressCount += p.quantity;
        }
    });

    // 3. Iterate products to apply specific rules
    activeProducts.forEach(p => {
        const name = p.name.toUpperCase();
        
        // RULE: Pillow "FLOCOS CONFORTO" is discounted (free) if there is ANY other product in the cart
        if (name === specificPillowName) {
             if (hasAnyOtherProduct) {
                totalDiscount += (p.price * p.quantity);
                hasPillowDiscount = true;
             }
        }

        // RULE: Base Discounts based on Mattresses (Bundle Logic)
        // MODIFIED: Only apply if NO "BASE BAÚ" is in the cart
        if (name.startsWith("BASE") && !hasBaseBau) {
            let targetPrice = 0;
            let applied = false;

            if (name.includes("SUPER KING") && superKingMattressCount > 0) {
                targetPrice = 350.00;
                const quantityToDiscount = Math.min(p.quantity, superKingMattressCount);
                if (quantityToDiscount > 0) {
                    const discountPerItem = Math.max(0, p.price - targetPrice);
                    totalDiscount += (discountPerItem * quantityToDiscount);
                    superKingMattressCount -= quantityToDiscount;
                    if (discountPerItem > 0) applied = true;
                }
            }
            else if (name.includes("QUEEN") && queenMattressCount > 0) {
                targetPrice = 300.00;
                const quantityToDiscount = Math.min(p.quantity, queenMattressCount);
                if (quantityToDiscount > 0) {
                    const discountPerItem = Math.max(0, p.price - targetPrice);
                    totalDiscount += (discountPerItem * quantityToDiscount);
                    queenMattressCount -= quantityToDiscount;
                    if (discountPerItem > 0) applied = true;
                }
            }
            else if (name.includes("CASAL") && casalMattressCount > 0) {
                targetPrice = 250.00;
                const quantityToDiscount = Math.min(p.quantity, casalMattressCount);
                if (quantityToDiscount > 0) {
                    const discountPerItem = Math.max(0, p.price - targetPrice);
                    totalDiscount += (discountPerItem * quantityToDiscount);
                    casalMattressCount -= quantityToDiscount;
                    if (discountPerItem > 0) applied = true;
                }
            }
            else if ((name.includes("SOLTEIRO") || name.includes("SOLTEIRAO") || name.includes("SOLTEIRÃO")) && solteiroMattressCount > 0) {
                targetPrice = 200.00;
                const quantityToDiscount = Math.min(p.quantity, solteiroMattressCount);
                if (quantityToDiscount > 0) {
                    const discountPerItem = Math.max(0, p.price - targetPrice);
                    totalDiscount += (discountPerItem * quantityToDiscount);
                    solteiroMattressCount -= quantityToDiscount;
                    if (discountPerItem > 0) applied = true;
                }
            }

            if (applied) {
                hasBaseDiscount = true;
            }
        }
    });

    // Logic for Label
    let label = "";
    if (hasBaseDiscount && hasPillowDiscount) {
        label = "Desconto Combo + Travesseiro Brinde";
    } else if (hasBaseDiscount) {
        label = "Desconto Combo (Base+Colchão)";
    } else if (hasPillowDiscount) {
        label = "Desconto (Travesseiro Brinde)";
    } else {
        label = "Desconto Promocional";
    }

    return { totalDiscount, label };
  };

  // --- TOTAL CALCULATIONS ---
  const subtotal = data.products.reduce((acc, curr) => {
    const itemTotal = curr.price * curr.quantity;
    return acc + (curr.isExchange ? -itemTotal : itemTotal);
  }, 0);
  const bundleDetails = getBundleDetails(data.products);
  const bundleDiscount = bundleDetails.totalDiscount;
  const bundleDiscountLabel = bundleDetails.label;
  
  let manualDiscount = 0;
  if (data.discountType === 'fixed') {
    manualDiscount = data.discountValue;
  } else {
    manualDiscount = subtotal * (data.discountValue / 100);
  }

  const totalDiscount = bundleDiscount + manualDiscount;
  const totalValue = Math.max(0, subtotal - totalDiscount + (data.shippingValue || 0));

  // Helper to create a temporary data object with the FULL discount applied for the PDF/Message
  const getDataForExport = () => {
    return {
        ...data,
        bundleDiscount: bundleDiscount,
        bundleLabel: bundleDiscountLabel, 
        discountType: data.discountType,
        discountValue: data.discountValue
    } as ReceiptData;
  };

  const handleGeneratePDF = async () => {
    setIsSavingSupabase(true);
    try {
      // 1. Criar novo registro na tabela comprovantes (salvando o nome do cliente e valor total)
      const clientName = data.name && data.name.trim() ? data.name.trim() : 'CLIENTE NÃO INFORMADO';
      const { data: comprovante, error: compError } = await supabase
        .from('comprovantes')
        .insert([{
          cliente_nome: clientName,
          total: totalValue
        }])
        .select()
        .single();

      if (compError) {
        console.error('[Supabase] Erro ao salvar comprovante:', compError);
      } else if (comprovante?.id && data.products.length > 0) {
        // 2. Pegar o ID gerado e salvar os produtos do carrinho na tabela itens_comprovante vinculados à venda
        const itensToInsert = data.products.map(p => ({
          comprovante_id: comprovante.id,
          nome_produto: p.name,
          quantidade: p.quantity,
          preco: p.price
        }));

        const { error: itemsError } = await supabase
          .from('itens_comprovante')
          .insert(itensToInsert);

        if (itemsError) {
          console.error('[Supabase] Erro ao salvar itens do comprovante no Supabase:', itemsError);
        } else {
          console.log('[Supabase] Comprovante e itens registrados com sucesso! ID:', comprovante.id);
        }
      }
    } catch (err) {
      console.error('[Supabase] Erro inesperado ao salvar no Supabase:', err);
    } finally {
      setIsSavingSupabase(false);
      // Gerar PDF
      await generateReceiptPDF(getDataForExport());
    }
  };

  const handleSendEmail = async () => {
    try {
      const exportData = getDataForExport();
      const blob = await getReceiptBlob(exportData);
      const safeName = exportData.name ? exportData.name.toUpperCase() : 'CLIENTE';
      const fileName = `COMPROVANTE - ${safeName}.pdf`;
      const file = new File([blob], fileName, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Comprovante de Compra - BelConfort',
          text: `Olá ${exportData.name}, segue em anexo o seu comprovante de compra.`,
          files: [file]
        });
      } else {
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        
        const subject = encodeURIComponent("Comprovante de Compra - BelConfort");
        const body = encodeURIComponent(`Olá ${exportData.name},\n\nSegue o comprovante de compra.\n(Por favor, anexe o arquivo PDF baixado manualmente).`);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
        
        alert("O PDF foi baixado automaticamente. Por favor, anexe-o ao e-mail que foi aberto.");
      }
    } catch (error) {
      console.error("Erro ao compartilhar:", error);
    }
  };

  const handleSendWhatsApp = async () => {
    try {
      const exportData = getDataForExport();
      const blob = await getReceiptBlob(exportData);
      const safeName = exportData.name ? exportData.name.toUpperCase() : 'CLIENTE';
      const fileName = `COMPROVANTE - ${safeName}.pdf`;
      const file = new File([blob], fileName, { type: 'application/pdf' });
      
      const totalFormatted = totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const messageText = `Olá ${exportData.name || 'Cliente'}, tudo bem? 😃\n\nAqui está o seu comprovante de compra na *BelConfort Camas e Móveis*.\n\n*Atendido por:* ${exportData.salesperson}\n*Valor Total:* ${totalFormatted}\n\nObrigado pela preferência! 💙`;

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Comprovante BelConfort',
          text: messageText,
          files: [file]
        });
      } else {
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = fileName;
        link.click();

        const encodedText = encodeURIComponent(messageText);
        window.open(`https://wa.me/?text=${encodedText}`, '_blank');
        
        setTimeout(() => {
            alert("⬇️ O PDF foi baixado no seu computador.\n\nO WhatsApp Web foi aberto. Por favor, arraste o arquivo PDF baixado para a conversa.");
        }, 1000);
      }
    } catch (error) {
      console.error("Erro ao enviar para WhatsApp:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans selection:bg-blue-500 selection:text-white pb-20">
      
      <header className="border-b border-gray-800 bg-[#0047AB] shadow-lg sticky top-0 z-50">
        <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
               <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-white drop-shadow-md">BelConfort</h1>
            </div>
            <div className="flex items-center gap-3 text-blue-100 text-[9px] sm:text-[10px] tracking-[0.2em] font-medium uppercase mt-[-2px] sm:mt-[-4px]">
               <span>Camas e Móveis</span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
             <button
               type="button"
               onClick={() => {
                 setModalSalesperson(data.salesperson || localStorage.getItem('belconfort_saved_salesperson') || '');
                 setIsWelcomeModalOpen(true);
               }}
               className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-semibold transition-all backdrop-blur-sm shadow-sm"
               title="Abrir Importação Inteligente ou alterar Vendedor"
             >
               <Sparkles className="w-3.5 h-3.5 text-yellow-300 flex-shrink-0" />
               <span className="hidden md:inline">Importação IA & Vendedor:</span>
               <span className="font-bold text-yellow-200 uppercase max-w-[100px] sm:max-w-none truncate">{data.salesperson || 'Identificar'}</span>
             </button>
             <div className="hidden md:block text-right">
                <p className="text-xs text-blue-200 font-medium">Ecosistema</p>
                <p className="text-xs text-white font-bold">Vendas & Gestão</p>
             </div>
             <span className="text-[10px] font-medium px-2 py-0.5 sm:py-1 bg-white/10 rounded-full text-white border border-white/20">v1.6.1</span>
          </div>
        </div>
      </header>

      <main className="w-full max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 py-3 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-8">
          
          {/* Left Column: Form */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Tab Navigation */}
            <div className="grid grid-cols-3 p-1 gap-1 bg-gray-900 rounded-xl border border-gray-800">
                <button
                onClick={() => setActiveTab('manual')}
                className={`flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                    activeTab === 'manual'
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                } flex-1`}
                >
                <FileText className="w-4 h-4" />
                Manual
                </button>
                <button
                onClick={() => setActiveTab('import')}
                className={`flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                    activeTab === 'import'
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                } flex-1`}
                >
                <Sparkles className="w-4 h-4" />
                Importar
                </button>
                <button
                onClick={() => setActiveTab('catalog')}
                className={`flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                    activeTab === 'catalog'
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                } flex-1`}
                >
                <Barcode className="w-4 h-4" />
                Catálogo
                </button>
            </div>

            {/* Smart Import Section */}
            {activeTab === 'import' && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                 <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                      <span className="w-1 h-6 bg-purple-500 rounded-full"></span>
                      Importação Inteligente
                    </h2>
                    <span className="text-xs text-gray-500 uppercase tracking-wider">AI Powered</span>
                  </div>
                  
                  {importError && (
                    <div className="mb-4 bg-red-900/20 border border-red-500/50 text-red-200 p-4 rounded-lg text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-2">
                        <div className="mt-0.5"><AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400" /></div>
                        <div>
                            <p className="font-bold text-red-400 mb-1">{importError.title}</p>
                            <p className="opacity-90 leading-relaxed">{importError.msg}</p>
                            {importError.msg.includes("API Studio") || importError.msg.includes("Vercel") ? (
                                <a 
                                  href="https://aistudio.google.com/app/apikey" 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 mt-3 text-xs bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 px-3 py-1.5 rounded-full transition-colors font-medium"
                                >
                                  Gerar Nova Chave API <ExternalLink className="w-3 h-3"/>
                                </a>
                            ) : null}
                        </div>
                    </div>
                  )}

                  <p className="text-sm text-gray-400 mb-4">
                    Cole abaixo a ficha do cliente (ex: WhatsApp). A IA irá identificar o cliente e os produtos automaticamente.
                  </p>
                  <TextArea
                    label="Cole o texto aqui..."
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    className="min-h-[200px] mb-4 font-mono text-sm"
                  />
                  <button
                    onClick={handleSmartImport}
                    disabled={isImporting || !importText.trim()}
                    className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-purple-900/20"
                  >
                    {isImporting ? (
                        <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processando...
                        </>
                    ) : (
                        <>
                        <Sparkles className="w-4 h-4" />
                        Processar com IA
                        </>
                    )}
                  </button>
              </div>
            )}
            
             {/* Catalog Management Section */}
             {activeTab === 'catalog' && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
                 <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                        Cadastrar Novo Produto
                      </h2>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Cadastre e salve produtos diretamente no banco de dados Supabase
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-1 rounded-full text-[11px] font-bold">
                        <Database className="w-3.5 h-3.5" />
                        Supabase Conectado
                      </span>
                    </div>
                  </div>

                  {/* Feedback de Sucesso */}
                  {customProductSuccess && (
                    <div className="flex items-center gap-2 p-3 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-emerald-300 text-xs font-semibold animate-in fade-in slide-in-from-top-1 duration-200">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>{customProductSuccess}</span>
                    </div>
                  )}

                  <div className="bg-gray-800/50 p-5 rounded-2xl border border-gray-700/50 space-y-4">
                    {/* Datalists para sugestões rápidas */}
                    <datalist id="list-categorias">
                      <option value="ARMÁRIO / COZINHA" />
                      <option value="BASE" />
                      <option value="BICAMA" />
                      <option value="CABECEIRA" />
                      <option value="COLCHÃO" />
                      <option value="FOGÃO" />
                      <option value="TRAVESSEIRO" />
                      <option value="UNIBOX" />
                    </datalist>

                    <datalist id="list-alturas">
                      <option value="22CM" />
                      <option value="24CM" />
                      <option value="26CM" />
                      <option value="28CM" />
                      <option value="30CM" />
                      <option value="32CM" />
                      <option value="34CM" />
                      <option value="62CM" />
                      <option value="7CM" />
                    </datalist>

                    <datalist id="list-tamanhos">
                      <option value="CASAL" />
                      <option value="SOLTEIRO" />
                      <option value="QUEEN" />
                      <option value="KING" />
                      <option value="VIÚVA" />
                      <option value="SUPER KING" />
                      <option value="52X78" />
                      <option value="PADRÃO" />
                    </datalist>

                    <datalist id="list-cores">
                      <option value="MARROM" />
                      <option value="CINZA" />
                      <option value="BEGE" />
                      <option value="PRETO" />
                      <option value="BRANCO" />
                      <option value="CHUMBO" />
                      <option value="AZUL" />
                      <option value="OFF WHITE" />
                    </datalist>

                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-blue-400" />
                        Composição do Nome do Produto (Sequência Obrigatória)
                      </span>
                    </div>

                    {/* Grid com os 5 inputs na sequência solicitada */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                      {/* 1. CATEGORIA */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-1 flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-[9px] font-mono">1</span>
                          Categoria
                        </label>
                        <Input
                          label="1. Categoria"
                          list="list-categorias"
                          value={newProdCategoria}
                          onChange={(e) => setNewProdCategoria(e.target.value)}
                          placeholder="EX: COLCHÃO"
                          className="uppercase text-xs"
                          icon={<Building2 className="w-4 h-4" />}
                        />
                      </div>

                      {/* 2. PRODUTO */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-1 flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-[9px] font-mono">2</span>
                          Produto
                        </label>
                        <Input
                          label="2. Produto"
                          value={newProdProduto}
                          onChange={(e) => setNewProdProduto(e.target.value)}
                          placeholder="EX: ECO PREMIUM"
                          className="uppercase text-xs"
                          icon={<ShoppingBag className="w-4 h-4" />}
                        />
                      </div>

                      {/* 3. ALTURA */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-1 flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-[9px] font-mono">3</span>
                          Altura
                        </label>
                        <Input
                          label="3. Altura"
                          list="list-alturas"
                          value={newProdAltura}
                          onChange={(e) => setNewProdAltura(e.target.value)}
                          placeholder="EX: 22CM"
                          className="uppercase text-xs"
                          icon={<Hash className="w-4 h-4" />}
                        />
                      </div>

                      {/* 4. TAMANHO */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-1 flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-[9px] font-mono">4</span>
                          Tamanho
                        </label>
                        <Input
                          label="4. Tamanho"
                          list="list-tamanhos"
                          value={newProdTamanho}
                          onChange={(e) => setNewProdTamanho(e.target.value)}
                          placeholder="EX: CASAL"
                          className="uppercase text-xs"
                          icon={<Maximize2 className="w-4 h-4" />}
                        />
                      </div>

                      {/* 5. COR */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-1 flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-[9px] font-mono">5</span>
                          Cor
                        </label>
                        <Input
                          label="5. Cor"
                          list="list-cores"
                          value={newProdCor}
                          onChange={(e) => setNewProdCor(e.target.value)}
                          placeholder="EX: MARROM"
                          className="uppercase text-xs"
                          icon={<Palette className="w-4 h-4" />}
                        />
                      </div>
                    </div>

                    {/* Preview em Tempo Real do Nome Gerado */}
                    <div className="bg-gray-950/80 border border-gray-700/80 rounded-xl p-3.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                          <Barcode className="w-3.5 h-3.5 text-emerald-400" />
                          Nome Final Formado na Sequência:
                        </span>
                        {computedProductName && (
                          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                            Pronto para Salvar
                          </span>
                        )}
                      </div>
                      <div className="min-h-[28px] flex items-center">
                        {computedProductName ? (
                          <p className="text-sm font-bold text-emerald-300 uppercase tracking-wide break-words font-mono">
                            {computedProductName}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-500 italic">
                            Preencha os campos acima para gerar o nome (Ex: COLCHÃO ECO PREMIUM 22CM CASAL MARROM)
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Preço e Botão de Salvar */}
                    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end pt-1">
                      <div className="flex-1">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-300 mb-1">
                          Preço Padrão (R$)
                        </label>
                        <Input
                          label="Preço Padrão (R$)"
                          value={newProductPrice}
                          onChange={(e) => setNewProductPrice(e.target.value)}
                          placeholder="EX: 1200,00"
                          icon={<Tag className="w-4 h-4"/>}
                        />
                      </div>
                      <button
                        onClick={handleAddCustomProduct}
                        disabled={!computedProductName || !newProductPrice.trim() || isSavingCustomProduct}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-3.5 rounded-lg transition-all flex items-center justify-center gap-2 font-semibold text-xs uppercase shadow-lg shadow-blue-900/30 active:scale-95 sm:min-w-[200px]"
                      >
                        {isSavingCustomProduct ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Salvando no Supabase...
                          </>
                        ) : (
                          <>
                            <Plus className="w-4 h-4" />
                            Salvar no Supabase
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs text-gray-400 font-bold uppercase tracking-wider">Produtos no Supabase</h3>
                        <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {allSupabaseCatalog.length > 0 ? allSupabaseCatalog.length : customProducts.length} itens
                        </span>
                      </div>
                      
                      <button
                        onClick={() => fetchCatalogFromSupabase()}
                        disabled={isLoadingCatalog}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                        title="Atualizar lista do Supabase"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCatalog ? 'animate-spin text-blue-400' : ''}`} />
                        Atualizar
                      </button>
                    </div>

                    {/* Search bar inside catalog tab */}
                    <div className="relative">
                      <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={catalogSearchTerm}
                        onChange={(e) => setCatalogSearchTerm(e.target.value)}
                        placeholder="Filtrar produtos por nome ou código..."
                        className="w-full bg-gray-800/80 border border-gray-700 focus:border-blue-500 text-gray-100 text-xs rounded-xl pl-9 pr-3 py-2 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all uppercase"
                      />
                    </div>
                    
                    <div className="max-h-80 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
                      {isLoadingCatalog && allSupabaseCatalog.length === 0 ? (
                        <div className="flex items-center justify-center py-8 text-gray-400 text-xs gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                          <span>Carregando produtos do Supabase...</span>
                        </div>
                      ) : (
                        (() => {
                          const displayList = allSupabaseCatalog.length > 0 
                            ? allSupabaseCatalog.filter(p => 
                                !catalogSearchTerm.trim() || 
                                p.nome.toLowerCase().includes(catalogSearchTerm.toLowerCase()) || 
                                (p.codigo && p.codigo.includes(catalogSearchTerm))
                              )
                            : customProducts
                                .filter(p => !catalogSearchTerm.trim() || p.name.toLowerCase().includes(catalogSearchTerm.toLowerCase()))
                                .map((p, idx) => ({ id: `custom-${idx}`, codigo: `PROD-${idx}`, nome: p.name, preco: p.price }));

                          if (displayList.length === 0) {
                            return (
                              <p className="text-center text-gray-500 text-xs py-6">
                                {catalogSearchTerm ? 'Nenhum produto encontrado com este filtro.' : 'Nenhum produto cadastrado no catálogo. Adicione um novo acima!'}
                              </p>
                            );
                          }

                          return displayList.map((product) => (
                            <div key={product.id || product.nome} className="flex items-center justify-between bg-gray-800/80 hover:bg-gray-800 p-3 rounded-xl border border-gray-700/80 transition-colors">
                               <div className="flex-1 min-w-0 pr-3">
                                 <div className="flex items-center gap-2 mb-0.5">
                                   {product.codigo && (
                                     <span className="text-[10px] bg-gray-900 border border-gray-700 text-gray-400 font-mono px-1.5 py-0.5 rounded">
                                       #{product.codigo}
                                     </span>
                                   )}
                                   <span className="text-[9px] text-emerald-400 font-mono tracking-wider font-bold">SUPABASE DB</span>
                                 </div>
                                 <span className="text-xs font-semibold text-gray-100 block truncate uppercase">{product.nome}</span>
                                 <span className="text-xs text-green-400 font-bold">
                                   {Number(product.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                 </span>
                               </div>
                               <button 
                                 onClick={() => handleRequestDeleteProduct(product.id, product.nome, product.preco, product.codigo)}
                                 className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors flex-shrink-0"
                                 title="Excluir produto do Supabase (Requer senha)"
                               >
                                 <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                          ));
                        })()
                      )}
                    </div>
                  </div>
              </div>
             )}

            {/* Products Section (Manual) */}
            {activeTab === 'manual' && (
             <>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <span className="w-1 h-6 bg-green-500 rounded-full"></span>
                    ADICIONAR PRODUTO
                    </h2>
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Carrinho</span>
                </div>

                <div className="space-y-4">
                    <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700/50 flex flex-col gap-3">
                    
                    <div className="relative">
                        <Input
                            label="Buscar Produto..."
                            value={searchTerm}
                            onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setIsSearchOpen(true);
                                setSelectedProduct("");
                            }}
                            onFocus={() => setIsSearchOpen(true)}
                            onBlur={() => setTimeout(() => setIsSearchOpen(false), 200)}
                            icon={<Search className="w-4 h-4" />}
                            autoComplete="off"
                        />
                        
                        {isSearchOpen && (
                            <div className="absolute z-20 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
                                {isSearchingSupabase ? (
                                    <div className="flex items-center justify-center py-4 text-xs text-gray-400 gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                                        <span>Buscando produtos no Supabase...</span>
                                    </div>
                                ) : supabaseProducts.length > 0 ? (
                                    supabaseProducts.map((product, idx) => (
                                        <button
                                            key={product.id || `${product.nome}-${idx}`}
                                            className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 transition-colors uppercase border-b border-gray-700/50 last:border-0 flex items-center justify-between group"
                                            onClick={() => handleSearchSelect(product)}
                                        >
                                            <div className="flex flex-col min-w-0 pr-2">
                                                <span className="font-medium text-xs text-gray-200 group-hover:text-white truncate">
                                                    {product.nome}
                                                </span>
                                                {product.codigo && (
                                                    <span className="text-[10px] text-gray-400 font-mono">
                                                        Cód: {product.codigo}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-xs font-bold text-green-400 group-hover:text-green-300 flex-shrink-0">
                                                {Number(product.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </span>
                                        </button>
                                    ))
                                ) : (
                                    <div className="px-4 py-4 text-sm text-gray-500 text-center flex flex-col items-center gap-2">
                                        <span>Nenhum produto encontrado</span>
                                        <button 
                                            type="button"
                                            onClick={() => {
                                                setNewProdProduto(searchTerm);
                                                setActiveTab('catalog');
                                            }}
                                            className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center justify-center gap-1 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-full border border-blue-500/20 transition-all uppercase"
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                            Cadastrar Novo Produto
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Input 
                            label="Qtd" 
                            type="number"
                            min="1"
                            value={selectedQuantity}
                            onChange={(e) => setSelectedQuantity(e.target.value)}
                            placeholder="1"
                        />
                        <Input 
                            label="Valor (R$)" 
                            type="text"
                            value={selectedPrice}
                            onChange={(e) => setSelectedPrice(e.target.value)}
                            placeholder="0,00"
                            icon={<Tag className="w-4 h-4" />}
                        />
                    </div>

                    <div className="flex items-center gap-2 px-1">
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <div className="relative flex items-center">
                                <input 
                                    type="checkbox" 
                                    checked={isExchange}
                                    onChange={(e) => setIsExchange(e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600"></div>
                            </div>
                            <span className="text-xs font-bold text-gray-400 group-hover:text-gray-200 transition-colors uppercase tracking-wider">Troca de Produto</span>
                        </label>
                    </div>

                    {isExchange && (
                        <div className="px-1 animate-in fade-in slide-in-from-top-1 duration-200">
                            <TextArea 
                                label="Motivo / Observação da Troca"
                                value={exchangeDetails}
                                onChange={(e) => setExchangeDetails(e.target.value)}
                                placeholder="Informe por qual motivo este produto foi trocado (ex: Defeito de fabricação, tamanho incorreto, garantia...)"
                                className="text-xs min-h-[60px]"
                            />
                        </div>
                    )}

                    <button 
                        onClick={handleAddProduct}
                        className="w-full bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white text-sm font-semibold rounded-lg py-3 flex items-center justify-center gap-2 transition-colors uppercase mt-1"
                    >
                        <Plus className="w-4 h-4" />
                        Adicionar Produto
                    </button>
                    </div>

                    {data.products.length > 0 && (
                    <div className="space-y-2 mt-4">
                        {data.products.map((p, idx) => (
                        <div key={idx} className={`p-3 rounded-lg border group transition-all ${
                            p.isExchange 
                                ? 'bg-red-950/20 border-2 border-red-500/60 shadow-lg shadow-red-950/20' 
                                : 'bg-gray-800 border-gray-700'
                        }`}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex-1 min-w-0 pr-4">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <span className="text-[10px] text-gray-400 border border-gray-700 rounded px-1.5 py-0.5 font-mono">{p.code}</span>
                                        {p.isExchange && (
                                            <span className="text-[10px] bg-red-600 text-white font-extrabold px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 shadow-sm">
                                                <RotateCcw className="w-3 h-3"/> PRODUTO DE TROCA
                                            </span>
                                        )}
                                        <p className={`text-sm truncate font-semibold ${p.isExchange ? 'text-red-300' : 'text-gray-200'}`}>
                                            <span className="text-gray-400 mr-1">{p.quantity}x</span> {p.name}
                                        </p>
                                    </div>
                                    <p className={`text-xs font-bold ${p.isExchange ? 'text-red-400' : 'text-green-400'}`}>
                                        {p.isExchange ? 'ABATIMENTO DE TROCA: -' : ''}{p.quantity} x {p.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} = {p.isExchange ? '-' : ''}{(p.quantity * p.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                    </p>
                                </div>
                                <button 
                                onClick={() => handleRemoveProduct(idx)}
                                className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                                title="Remover produto"
                                >
                                <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-700/50">
                                <div className="relative">
                                    <input 
                                        type="text"
                                        placeholder="Ex: 3"
                                        value={p.warrantyTime || ''}
                                        onChange={(e) => handleUpdateProductWarranty(idx, 'time', e.target.value)}
                                        className="w-full bg-gray-800 border-2 border-gray-600 hover:border-gray-500 focus:border-blue-500 text-gray-100 text-xs rounded px-2 py-1.5 focus:ring-1 focus:ring-blue-500"
                                    />
                                    <span className="absolute right-2 top-2 text-[9px] text-gray-400 pointer-events-none font-bold">TEMPO</span>
                                </div>
                                <div>
                                    <select
                                        value={p.warrantyUnit || 'MESES'}
                                        onChange={(e) => handleUpdateProductWarranty(idx, 'unit', e.target.value)}
                                        className="w-full bg-gray-800 border-2 border-gray-600 hover:border-gray-500 focus:border-blue-500 text-gray-100 text-xs rounded px-2 py-1.5 focus:ring-1 focus:ring-blue-500 uppercase cursor-pointer"
                                    >
                                        <option value="DIAS">DIAS</option>
                                        <option value="MESES">MESES</option>
                                        <option value="ANOS">ANOS</option>
                                    </select>
                                </div>
                            </div>

                            {p.isExchange && (
                                <div className="mt-2 pt-2 border-t border-red-500/30">
                                    <label className="text-[10px] font-bold text-red-400 uppercase tracking-wider block mb-1">
                                        Motivo / Observação da Troca:
                                    </label>
                                    <textarea 
                                        placeholder="Informe por qual motivo este produto foi trocado..."
                                        value={p.exchangeDetails || ''}
                                        onChange={(e) => handleUpdateProductExchangeDetails(idx, e.target.value)}
                                        className="w-full bg-gray-900/90 border-2 border-red-500/50 hover:border-red-400 focus:border-red-400 text-red-200 text-xs rounded p-2 focus:ring-1 focus:ring-red-400 min-h-[45px] resize-none"
                                    />
                                </div>
                            )}
                        </div>
                        ))}
                        
                        <div className="mt-4 pt-4 border-t border-gray-700">
                            
                            <div className="mb-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Forma de Pagamento</span>
                                </div>
                                <Select
                                    label="Selecione o método..."
                                    name="paymentMethod"
                                    value={data.paymentMethod}
                                    onChange={handleChange}
                                    options={["DINHEIRO", "PIX", "CARTÃO", "OUTROS"]}
                                    icon={<CreditCard className="w-4 h-4" />}
                                />
                            </div>

                            <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Desconto do Vendedor</span>
                            </div>
                            <div className="flex gap-2 mb-4">
                            <div className="w-1/2">
                                <div className="flex flex-col gap-1 w-full">
                                        <select
                                        value={data.discountType}
                                        onChange={handleDiscountTypeChange}
                                        className="w-full bg-gray-800 border-2 border-gray-600 hover:border-gray-500 focus:border-blue-500 text-gray-100 text-sm rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block w-full p-3 uppercase cursor-pointer"
                                        >
                                            <option value="fixed">R$ (Fixo)</option>
                                            <option value="percentage">% (Porcentagem)</option>
                                        </select>
                                </div>
                            </div>
                            <div className="flex-1">
                                    <Input 
                                        label="Valor Desconto" 
                                        type="text"
                                        value={discountInput}
                                        onChange={handleDiscountInputChange}
                                        placeholder="0,00"
                                        icon={<Percent className="w-4 h-4" />}
                                    />
                            </div>
                            </div>

                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Frete de Entrega</span>
                            </div>
                            <div className="mb-4">
                                <Input 
                                    label="Valor do Frete" 
                                    type="text"
                                    value={shippingInput}
                                    onChange={handleShippingInputChange}
                                    placeholder="0,00"
                                    icon={<Tag className="w-4 h-4" />}
                                />
                            </div>

                            <div className="flex flex-col gap-1 text-sm border-t border-gray-700/50 pt-2 mt-4">
                                <div className="pt-2 flex justify-between items-center text-gray-400">
                                    <span>Subtotal:</span>
                                    <span>{subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                </div>

                                {bundleDiscount > 0 && (
                                    <div className="flex justify-between items-center text-blue-400">
                                        <span className="flex items-center gap-1"><Tag className="w-3 h-3"/> {bundleDiscountLabel}:</span>
                                        <span>- {bundleDiscount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                    </div>
                                )}

                                {manualDiscount > 0 && (
                                    <div className="flex justify-between items-center text-red-400">
                                        <span>Desconto do Vendedor:</span>
                                        <span>- {manualDiscount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                    </div>
                                )}

                                <div className="flex justify-between items-center text-yellow-400">
                                    <span>Frete:</span>
                                    <span className="font-bold">
                                        {data.shippingValue && data.shippingValue > 0 
                                            ? `+ ${data.shippingValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                                            : 'FRETE GRÁTIS'
                                        }
                                    </span>
                                </div>

                                <div className="flex justify-between items-center mt-1 pt-2 border-t border-gray-700">
                                    <span className="font-bold text-white">Total Final:</span>
                                    <span className="text-lg font-bold text-green-400">
                                    {totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    )}
                </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl sm:rounded-2xl p-3.5 sm:p-6 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center justify-between mb-4 sm:mb-6">
                    <h2 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
                    <span className="w-1 h-5 sm:h-6 bg-blue-500 rounded-full"></span>
                    Dados do Cliente
                    </h2>
                    <span className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider">Formulário</span>
                </div>
                
                <div className="space-y-3 sm:space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <Input 
                            label="Código da Venda" 
                            name="saleCode"
                            value={data.saleCode}
                            onChange={handleChange}
                            icon={<Barcode className="w-4 h-4" />}
                            className="font-mono text-yellow-400 tracking-wider"
                        />
                         <Select
                            label="Vendedor"
                            name="salesperson"
                            value={data.salesperson}
                            onChange={handleChange}
                            options={salespeople}
                            icon={<User className="w-4 h-4" />}
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                         <Input 
                            label="Data" 
                            type="date" 
                            name="date"
                            value={data.date}
                            onChange={handleChange}
                            icon={<Calendar className="w-4 h-4" />}
                        />
                        <Input 
                            label="CPF/CNPJ" 
                            name="cpf"
                            value={data.cpf || ''}
                            onChange={handleChange}
                            icon={<Hash className="w-4 h-4" />}
                        />
                    </div>
                    
                    <Input 
                        label="Nome do Cliente" 
                        name="name"
                        value={data.name}
                        onChange={handleChange}
                        icon={<User className="w-4 h-4" />}
                    />

                    <Input 
                    label="Rua" 
                    name="street"
                    value={data.street}
                    onChange={handleChange}
                    icon={<MapPin className="w-4 h-4" />}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <Input 
                        label="Número" 
                        name="number"
                        value={data.number}
                        onChange={handleChange}
                        icon={<Hash className="w-4 h-4" />}
                    />
                    <Input 
                        label="Bairro" 
                        name="neighborhood"
                        value={data.neighborhood}
                        onChange={handleChange}
                        icon={<Map className="w-4 h-4" />}
                    />
                    </div>

                    <Input 
                    label="Cidade" 
                    name="city"
                    value={data.city}
                    onChange={handleChange}
                    icon={<Building2 className="w-4 h-4" />}
                    />

                    <Input 
                    label="Complemento" 
                    name="complement"
                    value={data.complement}
                    onChange={handleChange}
                    icon={<Building2 className="w-4 h-4" />}
                    />

                    <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-3 flex flex-col sm:flex-row gap-2 sm:gap-0 items-start sm:items-center justify-between">
                        <div className="flex items-center gap-2 text-gray-400 text-xs uppercase font-bold tracking-wider">
                           <MapPin className="w-4 h-4" />
                           <span>Localização</span>
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                             <button
                                onClick={handleOpenMap}
                                disabled={!data.street}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                             >
                                <ExternalLink className="w-3 h-3" />
                                Abrir no Maps
                             </button>
                             <button
                                onClick={handleShareLocation}
                                disabled={!data.street}
                                className="flex items-center justify-center px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                             >
                                <Share2 className="w-3 h-3" />
                             </button>
                        </div>
                    </div>
                    
                    <Input 
                    label="E-mail" 
                    name="email"
                    value={data.email || ''}
                    onChange={handleChange}
                    icon={<Mail className="w-4 h-4" />}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <Input 
                        label="Contato 1" 
                        name="contact1"
                        value={data.contact1}
                        onChange={handleChange}
                        icon={<Phone className="w-4 h-4" />}
                    />
                    <Input 
                        label="Contato 2" 
                        name="contact2"
                        value={data.contact2}
                        onChange={handleChange}
                        icon={<Phone className="w-4 h-4" />}
                    />
                    </div>
                </div>
                </div>
             </>
            )}
          </div>

          <div className="lg:col-span-7 space-y-4 sm:space-y-6">
            
            <div className="bg-gray-900 border border-gray-800 rounded-xl sm:rounded-2xl p-3.5 sm:p-4 shadow-xl flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              <div className="flex items-center gap-2">
                 <div className="h-8 w-8 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <Printer className="w-4 h-4 text-gray-400" />
                 </div>
                 <span className="text-sm font-medium text-gray-300">Ações Rápidas</span>
              </div>
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3">
                <button
                  onClick={handleResetData}
                  className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-lg shadow-red-900/20"
                >
                  <RotateCcw className="w-4 h-4" />
                  Novo Cliente
                </button>
                <button
                  onClick={handleSendWhatsApp}
                  className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-lg shadow-green-900/20"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </button>
                <button
                  onClick={handleSendEmail}
                  className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-lg shadow-gray-900/20"
                >
                  <Mail className="w-4 h-4" />
                  E-mail
                </button>
                <button
                  onClick={() => setIsHistoryModalOpen(true)}
                  className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-lg shadow-purple-900/20"
                  title="Ver histórico de comprovantes emitidos no Supabase"
                >
                  <History className="w-4 h-4" />
                  Histórico
                </button>
                <button
                  onClick={handleGeneratePDF}
                  disabled={isSavingSupabase}
                  className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 sm:py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-75 disabled:cursor-not-allowed text-white rounded-lg text-xs sm:text-sm font-bold transition-colors shadow-lg shadow-blue-900/20"
                >
                  {isSavingSupabase ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Gerar PDF
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl sm:rounded-2xl p-2 sm:p-8 shadow-2xl relative w-full overflow-hidden">
                <div className="absolute top-0 right-0 p-3 sm:p-4 z-10">
                    <span className="text-[10px] font-bold tracking-widest text-gray-600 uppercase border border-gray-700 bg-white/80 px-2 py-1 rounded backdrop-blur">Preview</span>
                </div>
                
                <div className="bg-white text-gray-900 p-3 sm:p-8 rounded-lg shadow-sm min-h-[700px] sm:min-h-[800px] w-full max-w-full sm:max-w-lg mx-auto transform transition-all flex flex-col overflow-x-auto">
                    
                    <div className="bg-[#1e40af] text-white p-3 sm:p-6 -mx-3 sm:-mx-8 -mt-3 sm:-mt-8 mb-4 sm:mb-6 flex justify-between items-start">
                       <div className="flex flex-col justify-center h-full">
                           <h1 className="font-serif font-bold text-2xl sm:text-3xl">BelConfort</h1>
                           <span className="text-[8px] sm:text-[9px] tracking-[0.2em] font-sans">CAMAS E MÓVEIS</span>
                       </div>
                       <div className="flex flex-col items-end text-[9px] leading-tight space-y-1 mt-2">
                           <p className="font-bold">CNPJ 60.190.028/0001-60</p>
                           <p>RUA B, 103C, CASTANHEIRA - BELEM/PA</p>
                           <p>belconfortcamasemoveis@gmail.com</p>
                           <p>(91) 99381-2592</p>
                           <div className="mt-2 w-8 h-8 bg-white/20 border border-white/40 flex items-center justify-center">
                               <div className="w-6 h-6 bg-white/90 grid grid-cols-3 gap-0.5 p-0.5">
                                   <div className="bg-blue-900 col-span-2 row-span-2"></div>
                                   <div className="bg-blue-900"></div>
                                   <div className="bg-blue-900"></div>
                               </div>
                           </div>
                       </div>
                    </div>

                    <div className="text-center mb-6">
                        <h2 className="text-lg font-bold text-gray-900 uppercase">COMPROVANTE DE COMPRA</h2>
                        <p className="text-[10px] text-gray-500">
                             Emissão: {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })} às {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    </div>

                    <div className="border border-gray-300 mb-6 text-sm">
                        <div className="grid grid-cols-[20%_55%_25%] border-b border-gray-300">
                            <PreviewCell label="DATA DO PEDIDO" value={data.date ? new Date(data.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'} className="border-r border-gray-300" />
                            <PreviewCell label="CLIENTE" value={data.name} className="border-r border-gray-300" />
                            <PreviewCell label="CPF/CNPJ" value={data.cpf} />
                        </div>
                        <div className="grid grid-cols-[40%_10%_15%_20%_15%] border-b border-gray-300">
                            <PreviewCell label="RUA" value={data.street} className="border-r border-gray-300" />
                            <PreviewCell label="Nº" value={data.number} className="border-r border-gray-300" />
                            <PreviewCell label="COMPLEMENTO" value={data.complement} className="border-r border-gray-300" />
                            <PreviewCell label="BAIRRO" value={data.neighborhood} className="border-r border-gray-300" />
                            <PreviewCell label="CIDADE" value={data.city} />
                        </div>
                        <div className="grid grid-cols-[55%_45%]">
                             <PreviewCell label="E-MAIL" value={data.email} className="border-r border-gray-300" />
                             <PreviewCell label="CONTATOS" value={[data.contact1, data.contact2].filter(Boolean).join(' / ')} />
                        </div>
                    </div>

                    <div className="mb-2">
                         <div className="grid grid-cols-[40px_1fr_30px_60px_60px] bg-gray-50 border-y border-gray-300 text-[9px] font-bold text-blue-900 py-1 px-1 gap-2">
                             <div>CÓD</div>
                             <div>DESCRIÇÃO DO PRODUTO</div>
                             <div className="text-center">QTD</div>
                             <div className="text-right">UNITÁRIO</div>
                             <div className="text-right">TOTAL</div>
                         </div>
                         <div className="flex flex-col">
                             {data.products.length > 0 ? (
                                data.products.map((p, i) => (
                                    <div 
                                        key={i} 
                                        className={`grid grid-cols-[40px_1fr_30px_60px_60px] text-[10px] py-2 border-b border-gray-200 gap-2 items-start px-1 rounded-sm ${
                                            p.isExchange ? 'bg-red-50/90 text-red-950 border-l-4 border-l-red-600' : 'text-gray-800'
                                        }`}
                                    >
                                        <div className="truncate flex flex-col items-start">
                                            <span>{p.code || '-'}</span>
                                            {p.code && <BarcodePreview code={p.code} />}
                                        </div>
                                        <div>
                                            {p.isExchange && (
                                                <span className="inline-block bg-red-600 text-white text-[8px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider mr-1.5 shadow-sm">
                                                    PRODUTO DE TROCA
                                                </span>
                                            )}
                                            <span className={p.isExchange ? "font-bold text-red-900" : "font-normal text-gray-900"}>{p.name}</span>

                                            {p.isExchange && (
                                                <div className="mt-1 p-1.5 bg-red-100/90 border border-red-300 rounded text-[9px] text-red-950 leading-snug">
                                                    <span className="font-extrabold uppercase text-red-800 block mb-0.5">MOTIVO DA TROCA:</span>
                                                    <span className="font-medium italic">{p.exchangeDetails && p.exchangeDetails.trim() ? p.exchangeDetails : "Motivo não especificado"}</span>
                                                </div>
                                            )}

                                            {p.warrantyTime && (
                                                <div className="text-[8px] text-gray-500 mt-0.5">
                                                    GARANTIA DE FÁBRICA: {p.warrantyTime} {p.warrantyUnit} | 90 DIAS LOJA
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-center font-bold">{p.quantity}</div>
                                        <div className="text-right">{p.isExchange ? `- ${p.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : p.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                                        <div className={`text-right font-bold ${p.isExchange ? 'text-red-700' : 'text-gray-900'}`}>
                                            {p.isExchange ? `- ${(p.price * p.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : (p.price * p.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </div>
                                    </div>
                                ))
                             ) : (
                                <div className="text-center text-xs text-gray-400 py-6">- Nenhum item adicionado -</div>
                             )}
                         </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-start pt-4 sm:pt-5 mb-4 justify-between gap-3 sm:gap-4">
                        <div className="border border-gray-300 rounded w-full sm:w-[240px]">
                            <div className="flex justify-between items-center px-3 py-2 border-b border-gray-300 bg-gray-50/50">
                                <span className="text-[10px] font-bold text-gray-400 uppercase">CÓDIGO DA VENDA</span>
                                <span className="text-sm font-bold text-blue-800">{data.saleCode?.toUpperCase() || '-'}</span>
                            </div>
                            <div className="flex justify-between items-center px-3 py-2 border-b border-gray-300">
                                <span className="text-[10px] font-bold text-gray-400 uppercase">VENDEDOR</span>
                                <span className="text-xs font-bold text-gray-700">{data.salesperson?.toUpperCase() || '-'}</span>
                            </div>
                            <div className="flex justify-between items-center px-3 py-2">
                                <span className="text-[10px] font-bold text-gray-400 uppercase">FORMA DE PAGAMENTO</span>
                                <span className="text-sm font-medium text-gray-900">{data.paymentMethod?.toUpperCase() || '-'}</span>
                            </div>
                        </div>

                        <div className="w-full sm:w-64 text-xs pt-1 sm:pt-2">
                             <div className="flex justify-between mb-1 text-gray-600">
                                 <span>Subtotal:</span>
                                 <span>{subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                             </div>
                             {bundleDiscount > 0 && (
                                <div className="flex justify-between mb-1 text-blue-500 font-medium">
                                    <span>{bundleDiscountLabel}:</span>
                                    <span>- {bundleDiscount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                </div>
                             )}
                             {manualDiscount > 0 && (
                                <div className="flex justify-between mb-1 text-red-500">
                                    <span>Desc. Vendedor:</span>
                                    <span>- {manualDiscount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                </div>
                             )}
                             <div className="flex justify-between mb-1 text-yellow-600">
                                <span>Frete:</span>
                                <span className="font-bold">
                                    {data.shippingValue && data.shippingValue > 0 
                                        ? `+ ${data.shippingValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                                        : 'FRETE GRÁTIS'
                                    }
                                </span>
                             </div>
                             <div className="flex justify-between mt-2 bg-gray-50 p-1.5 sm:p-1 rounded font-bold text-gray-900 border border-gray-200">
                                 <span>TOTAL:</span>
                                 <span>{totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                             </div>
                        </div>
                    </div>

                    <div className="bg-[#fefce8] border border-[#fef9c3] rounded-lg p-3 text-center mb-2">
                        <p className="text-[10px] font-bold text-[#a16207] mb-1">OBSERVAÇÃO</p>
                        <p className="text-[10px] italic text-gray-700 leading-tight">
                            A garantia cobre exclusivamente o que está especificado na etiqueta e no certificado de cada produto.
                        </p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-left mb-auto mt-2">
                        <p className="text-[10px] font-bold text-slate-800 mb-2 text-center uppercase border-b border-slate-200 pb-1">Política de Trocas e Devoluções</p>
                        
                        <div className="space-y-2">
                            <div>
                                <p className="text-[9px] font-bold text-slate-700">DIREITO DE ARREPENDIMENTO <span className="font-normal text-slate-500">(Art. 49 do CDC)</span>:</p>
                                <p className="text-[9px] text-slate-600 leading-tight mt-0.5 pl-1">
                                    O cliente tem o prazo de até 7 (sete) dias corridos para desistir da compra, contados a partir do recebimento do produto, desde que esteja sem uso e com lacre intacto.
                                </p>
                                <p className="text-[9px] text-slate-600 leading-tight mt-0.5 pl-3">
                                    • Compras online: frete de devolução por conta da empresa.
                                </p>
                            </div>

                            <div>
                                <p className="text-[9px] font-bold text-slate-700">COMPRAS EM LOJA FÍSICA:</p>
                                <p className="text-[9px] text-slate-600 leading-tight mt-0.5 pl-1">
                                    Compras realizadas em loja física não possuem direito de arrependimento, conforme o Código de Defesa do Consumidor, exceto em casos de defeito de fabricação.
                                </p>
                            </div>

                            <div>
                                <p className="text-[9px] font-bold text-slate-700">DEFEITOS DE FABRICAÇÃO (Garantia Legal):</p>
                                <ul className="list-disc pl-3 text-[9px] text-slate-600 leading-tight mt-0.5 space-y-0.5">
                                    <li>Garantia legal de 90 (noventa) dias, conforme o CDC.</li>
                                    <li>Após esse prazo, aplicar-se-á a garantia contratual do fabricante, quando houver, conforme certificado.</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    <div className="mt-12 pt-8 pb-4 relative">
                        <div className="border-t border-dashed border-gray-400 w-1/2 mx-auto mb-1"></div>
                        <p className="text-[10px] text-gray-500 text-center">Assinatura do Responsável</p>
                        <p className="text-[8px] text-gray-300 text-center mt-4">Documento gerado pelo Ecosistema Belconfort</p>

                        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 w-40 h-20 pointer-events-none opacity-50 text-blue-900">
                            <svg viewBox="0 0 100 50" width="100%" height="100%">
                                <path 
                                    d="M35 36 C 37 21, 43 21, 43 36 C 43 24, 49 24, 49 36 C 51 33, 53 38, 54 35 L 56 28 L 56 36 C 57 26, 61 26, 61 36 C 61 31, 64 31, 64 36 C 67 34, 70 38, 73 34 M 30 41 C 45 44, 65 39, 80 42" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    strokeWidth="0.15"
                                />
                            </svg>
                        </div>

                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-48 h-20 pointer-events-none flex flex-col items-center justify-center">
                            <div className="absolute top-0 left-0 w-3 h-3 border-l-2 border-t-2 border-blue-900"></div>
                            <div className="absolute top-0 right-0 w-3 h-3 border-r-2 border-t-2 border-blue-900"></div>
                            <div className="absolute bottom-0 left-0 w-3 h-3 border-l-2 border-b-2 border-blue-900"></div>
                            <div className="absolute bottom-0 right-0 w-3 h-3 border-r-2 border-b-2 border-blue-900"></div>
                            
                            <div className="text-blue-900 text-center z-10">
                                <p className="font-bold text-sm leading-tight">60.190.028/0001-60</p>
                                <p className="text-[10px] leading-tight mt-1">BELCONFORT CAMAS E MÓVEIS</p>
                                <p className="font-bold text-[8px] leading-tight mt-1">RUA B, 103C, CASTANHEIRA</p>
                                <p className="font-bold text-[8px] leading-tight">BELEM - PA</p>
                            </div>
                        </div>

                    </div>
                </div>
            </div>

          </div>
        </div>
      </main>

      {/* Histórico de Comprovantes Modal */}
      <ReceiptHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        onLoadReceipt={(loadedData) => {
          setData(prev => ({
            ...prev,
            ...loadedData
          }));
        }}
      />

      {/* Modal de Confirmação com Senha para Excluir Produto do Catálogo */}
      {productToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-gray-900 border border-red-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 flex-shrink-0">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Autorização Necessária</h3>
                <p className="text-xs text-gray-400">
                  Informe a senha administrativa para excluir este produto do catálogo.
                </p>
              </div>
            </div>

            <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-3 text-xs space-y-1">
              {productToDelete.codigo && (
                <p className="text-gray-400">
                  <span className="font-semibold text-gray-300">Código:</span>{' '}
                  <span className="font-mono text-gray-200">#{productToDelete.codigo}</span>
                </p>
              )}
              <p className="text-gray-400">
                <span className="font-semibold text-gray-300">Produto:</span>{' '}
                <span className="text-gray-100 font-bold uppercase">{productToDelete.name}</span>
              </p>
              {productToDelete.preco !== undefined && (
                <p className="text-gray-400">
                  <span className="font-semibold text-gray-300">Preço Padrão:</span>{' '}
                  <span className="text-green-400 font-bold">
                    {Number(productToDelete.preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                </p>
              )}
            </div>

            <form onSubmit={handleConfirmDeleteProductWithPassword} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-purple-400" />
                  Senha de Segurança
                </label>
                <div className="relative">
                  <input
                    type={showDeleteProductPassword ? 'text' : 'password'}
                    value={deleteProductPassword}
                    onChange={(e) => {
                      setDeleteProductPassword(e.target.value);
                      if (deleteProductPasswordError) setDeleteProductPasswordError('');
                    }}
                    placeholder="Digite a senha de segurança..."
                    autoFocus
                    className="w-full bg-gray-950 border border-gray-700 focus:border-red-500 text-gray-100 text-sm rounded-xl pl-3 pr-10 py-2.5 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeleteProductPassword(!showDeleteProductPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                  >
                    {showDeleteProductPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {deleteProductPasswordError && (
                  <p className="text-xs text-red-400 font-medium flex items-center gap-1 mt-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {deleteProductPasswordError}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setProductToDelete(null);
                    setDeleteProductPassword('');
                    setDeleteProductPasswordError('');
                  }}
                  disabled={isDeletingProduct}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!deleteProductPassword || isDeletingProduct}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-red-900/30 flex items-center gap-1.5"
                >
                  {isDeletingProduct ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Excluindo...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      Confirmar Exclusão
                    </>
                  )}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* Modal de Boas-Vindas / Importação Inteligente & Identificação Obrigatória do Vendedor */}
      {isWelcomeModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-gray-900 border border-blue-500/50 rounded-2xl sm:rounded-3xl max-w-xl w-full p-4 sm:p-8 shadow-2xl shadow-blue-950/90 relative my-auto text-left ring-1 ring-blue-500/30">
            
            {/* Botão de Fechar (Apenas permitido se já houver um vendedor identificado no sistema) */}
            {data.salesperson?.trim() && (
              <button 
                type="button"
                onClick={() => setIsWelcomeModalOpen(false)}
                className="absolute top-4 sm:top-5 right-4 sm:right-5 text-gray-400 hover:text-white bg-gray-800/80 hover:bg-gray-700 p-1.5 sm:p-2 rounded-full transition-colors"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Cabeçalho do Modal */}
            <div className="flex items-start gap-3 sm:gap-3.5 mb-4 sm:mb-6 pr-6">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30 flex-shrink-0">
                <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] sm:text-[10px] font-bold tracking-widest text-blue-400 uppercase bg-blue-500/10 px-2 sm:px-2.5 py-0.5 rounded-full border border-blue-500/20 flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-blue-400" />
                    Identificação Obrigatória
                  </span>
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-white mt-1">Identifique-se para Acessar</h2>
                <p className="text-[11px] sm:text-xs text-gray-400 mt-0.5">
                  Informe o seu nome para liberar o painel de vendas e carregar o atendimento.
                </p>
              </div>
            </div>

            <form onSubmit={handleConfirmWelcomeModal} className="space-y-5">
              
              {/* 1. Nome do Vendedor / Atendente (OBRIGATÓRIO) */}
              <div className="bg-gray-800/60 p-4 rounded-2xl border border-blue-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-blue-400" />
                    Quem está na página? <span className="text-red-400 font-bold">*</span>
                  </label>
                  {modalSalesperson.trim() ? (
                    <span className="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                      ✓ {modalSalesperson.toUpperCase()}
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-400 font-mono font-bold bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/30">
                      Campo Obrigatório
                    </span>
                  )}
                </div>

                <Input
                  label="Nome do Vendedor"
                  value={modalSalesperson}
                  onChange={(e) => setModalSalesperson(e.target.value.toUpperCase())}
                  placeholder="DIGITE SEU NOME OU ESCOLHA ABAIXO"
                  className="uppercase font-semibold text-sm"
                  icon={<User className="w-4 h-4 text-blue-400" />}
                  autoFocus
                />

                {/* Chips rápidos de vendedores */}
                <div>
                  <p className="text-[10px] text-gray-400 uppercase font-medium mb-1.5">Sugestões rápidas:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {salespeople.map((name) => {
                      const isSelected = modalSalesperson.toUpperCase() === name.toUpperCase();
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setModalSalesperson(name)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold uppercase transition-all duration-150 border ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-400 shadow-md shadow-blue-900/40 scale-105'
                              : 'bg-gray-900/90 text-gray-300 border-gray-700 hover:border-gray-500 hover:text-white'
                          }`}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 2. Importação Inteligente (IA) - Opcional */}
              <div className="bg-gray-800/60 p-4 rounded-2xl border border-gray-700/60 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    Importação Inteligente (WhatsApp / Texto) <span className="text-[10px] text-gray-400 lowercase font-normal">(opcional)</span>
                  </label>
                  <span className="text-[10px] font-mono text-indigo-400 bg-indigo-950/60 border border-indigo-500/30 px-2 py-0.5 rounded-full font-bold">
                    IA Gemini
                  </span>
                </div>

                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Cole abaixo o texto do pedido copiado do WhatsApp para preencher o cliente e itens automaticamente:
                </p>

                <textarea
                  value={modalImportText}
                  onChange={(e) => setModalImportText(e.target.value)}
                  placeholder={"Exemplo:\nCliente: Mariana Souza\nEndereço: Rua das Flores, 123 - Centro\nTelefone: (11) 98765-4321\nProdutos: 1 COLCHÃO ECO PREMIUM 22CM CASAL MARROM e 2 TRAVESSEIRO FLOCOS\nPagamento: PIX"}
                  rows={3}
                  className="w-full bg-gray-950/90 border border-gray-700 focus:border-indigo-500 text-gray-100 text-xs rounded-xl p-3 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono transition-all resize-none"
                />

                {modalImportError && (
                  <div className="p-3 bg-red-950/50 border border-red-500/30 rounded-xl text-xs text-red-300 space-y-0.5">
                    <p className="font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {modalImportError.title}
                    </p>
                    <p className="text-[11px] text-red-200">{modalImportError.msg}</p>
                  </div>
                )}
              </div>

              {/* Botões de Ação */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                {modalImportText.trim() ? (
                  <button
                    type="submit"
                    disabled={!modalSalesperson.trim() || isModalImporting}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3.5 px-5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-900/40 flex items-center justify-center gap-2 active:scale-98"
                  >
                    {isModalImporting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processando com IA...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Liberar com IA & Iniciar
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!modalSalesperson.trim()}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3.5 px-5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-900/40 flex items-center justify-center gap-2 active:scale-98"
                  >
                    <UserCheck className="w-4 h-4" />
                    {modalSalesperson.trim() ? `Liberar Acesso como ${modalSalesperson.toUpperCase()}` : 'Informe seu Nome para Liberar Acesso'}
                  </button>
                )}

                {data.salesperson?.trim() && (
                  <button
                    type="button"
                    onClick={() => setIsWelcomeModalOpen(false)}
                    className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold uppercase transition-colors text-center"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              {!modalSalesperson.trim() && (
                <p className="text-[11px] text-center text-amber-400/90 font-medium">
                  ⚠️ O acesso ao sistema só será liberado após digitar ou selecionar seu nome.
                </p>
              )}

            </form>

          </div>
        </div>
      )}
    </div>
  );
}

const PreviewCell = ({ label, value, className = "" }: { label: string, value: string, className?: string }) => {
    return (
        <div className={`p-2 flex flex-col justify-center overflow-hidden ${className}`}>
            <p className="text-[8px] font-bold text-gray-400 uppercase mb-0.5 leading-none">{label}</p>
            <p className="text-xs text-gray-800 leading-tight break-words">{value || '-'}</p>
        </div>
    );
};
