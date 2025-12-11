

import React, { useState, useEffect, useRef } from 'react';
import { INITIAL_DATA, ReceiptData, PRODUCTS_LIST, PRODUCT_CATALOG, Product } from './types';
import { generateReceiptPDF, getReceiptBlob } from './services/pdfService';
import { generateClientMessage, parseReceiptFromText } from './services/geminiService';
import { Input, Select, TextArea } from './components/Input';
import { 
  Calendar, User, MapPin, Hash, Map, Building2, 
  Phone, Download, Printer, CreditCard, Plus, Trash2, Tag, Percent, Search,
  ShieldCheck, Mail, MessageCircle, FileText, Sparkles, Loader2, Barcode,
  Users, UserPlus, ExternalLink, Share2, Copy, RotateCcw, AlertTriangle
} from 'lucide-react';
import Fuse from 'fuse.js';
import JsBarcode from 'jsbarcode';

const STORAGE_KEY = 'belconfort_receipt_data';
const TEAM_STORAGE_KEY = 'belconfort_team_list';

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

  // Salespeople Team State
  const [salespeople, setSalespeople] = useState<string[]>(() => {
    try {
      const savedTeam = localStorage.getItem(TEAM_STORAGE_KEY);
      if (savedTeam) {
        return JSON.parse(savedTeam);
      }
    } catch (error) {}
    return ['ROBSON', 'SARA']; // Defaults
  });

  const [newSalespersonName, setNewSalespersonName] = useState("");

  // UI State
  const [activeTab, setActiveTab] = useState<'manual' | 'import' | 'team'>('manual');
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<{title: string, msg: string} | null>(null);

  // Temporary state for adding a product
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedPrice, setSelectedPrice] = useState("");
  const [selectedQuantity, setSelectedQuantity] = useState("1");

  // Search state
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // State for discount input as string
  const [discountInput, setDiscountInput] = useState("");

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
        setSelectedProduct("");
        setSelectedPrice("");
        setSelectedQuantity("1");
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

  // Filter products using Fuse.js fuzzy search
  const filteredProducts = searchTerm
    ? fuse.search(searchTerm).map(result => result.item)
    : PRODUCTS_LIST;

  const handleSearchSelect = (name: string) => {
    setSelectedProduct(name);
    setSearchTerm(name);
    setIsSearchOpen(false);
    
    // Auto-fill price
    const product = PRODUCT_CATALOG.find(p => p.name === name);
    if (product) {
        setSelectedPrice(product.price.toFixed(2).replace('.', ','));
    } else {
        setSelectedPrice("");
    }
  };

  const handleAddProduct = () => {
    if (!selectedProduct) return;
    
    // Parse the price input (handling comma as decimal separator)
    const priceValue = parseFloat(selectedPrice.replace('.', '').replace(',', '.') || "0");
    const quantityValue = parseInt(selectedQuantity) || 1;
    
    // Generate a pseudo-code (Numeric only - 6 digits)
    const pseudoCode = Math.floor(100000 + Math.random() * 900000).toString();

    const newProduct: Product = {
      code: pseudoCode,
      name: selectedProduct,
      price: priceValue,
      quantity: quantityValue,
      warrantyTime: "", // Default empty, user edits in list
      warrantyUnit: "MESES" // Default unit
    };

    setData(prev => ({
      ...prev,
      products: [...prev.products, newProduct]
    }));

    // Reset inputs
    setSelectedProduct("");
    setSearchTerm("");
    setSelectedPrice("");
    setSelectedQuantity("1");
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

  const handleDiscountInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDiscountInput(val);
    const num = parseFloat(val.replace('.', '').replace(',', '.') || "0");
    setData(prev => ({ ...prev, discountValue: num }));
  };

  const handleDiscountTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setData(prev => ({ ...prev, discountType: e.target.value as 'fixed' | 'percentage' }));
  };

  const handleSmartImport = async () => {
    if (!importText.trim()) return;

    setIsImporting(true);
    setImportError(null);
    try {
      // Pass the system product list so AI can match exact names
      const result = await parseReceiptFromText(importText, PRODUCTS_LIST);
      
      // LOGIC UPDATE: Check existing products in the cart to update quantity instead of duplicating
      // Create a working copy of current products
      let updatedProducts = [...data.products];
      
      if (result.items && Array.isArray(result.items)) {
        result.items.forEach((item: { name: string, quantity: number }) => {
            // item comes from AI as { name: "EXACT NAME", quantity: 2 }
            const systemProduct = PRODUCT_CATALOG.find(p => p.name === item.name);
            
            if (systemProduct) {
                const quantityToAdd = item.quantity || 1;

                // Check if product already exists in the cart (by exact name)
                const existingProductIndex = updatedProducts.findIndex(p => p.name === systemProduct.name);

                if (existingProductIndex >= 0) {
                    // Update quantity
                    const existingProduct = updatedProducts[existingProductIndex];
                    updatedProducts[existingProductIndex] = {
                        ...existingProduct,
                        quantity: existingProduct.quantity + quantityToAdd
                    };
                } else {
                    // Add new product
                    // Generate Numeric Code (6 digits)
                    const pseudoCode = Math.floor(100000 + Math.random() * 900000).toString();
                    
                    updatedProducts.push({
                        code: pseudoCode,
                        name: systemProduct.name,
                        price: systemProduct.price,
                        quantity: quantityToAdd,
                        warrantyTime: "", // Default manual
                        warrantyUnit: "MESES"
                    });
                }
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
        // Search for JSON structure like details: {...} or just {...}
        // Example: Detalhes: {"error": {"code":403 ...}}
        const jsonMatch = rawMsg.match(/\{.*\}/);
        
        if (jsonMatch) {
            const parsedError = JSON.parse(jsonMatch[0]);
            
            // Check for structure returned by Google
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
      } catch (e) { /* falha no parse, usa a mensagem original */ }

      // Fallback: Detecta erro de chave vazada por texto simples se o JSON parse falhar
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
    let totalDiscount = 0;
    let hasBaseDiscount = false;
    let hasPillowDiscount = false;

    const specificPillowName = "TRAVESSEIRO FLOCOS CONFORTO 20CM 60X40 BRANCO";

    // 1. Check if there is ANY product other than the specific pillow
    const hasAnyOtherProduct = products.some(p => p.name !== specificPillowName);

    // 2. Identify Inventory of Mattresses (Colchão) for Base Bundle Logic
    let casalMattressCount = 0;
    let queenMattressCount = 0;
    let superKingMattressCount = 0;

    products.forEach(p => {
        const name = p.name.toUpperCase();
        if (name.includes("COLCHÃO") || name.includes("COLCHAO")) {
            if (name.includes("CASAL")) casalMattressCount += p.quantity;
            else if (name.includes("QUEEN")) queenMattressCount += p.quantity;
            else if (name.includes("SUPER KING")) superKingMattressCount += p.quantity;
        }
    });

    // 3. Iterate products to apply specific rules
    products.forEach(p => {
        const name = p.name.toUpperCase();
        
        // RULE: Pillow "FLOCOS CONFORTO" is discounted (free) if there is ANY other product in the cart
        if (name === specificPillowName) {
             if (hasAnyOtherProduct) {
                // Discount the full price of the pillow(s)
                totalDiscount += (p.price * p.quantity);
                hasPillowDiscount = true;
             }
        }

        // RULE: Base Discounts based on Mattresses (Bundle Logic)
        if (name.startsWith("BASE")) {
            let targetPrice = 0;
            let applied = false;

            if (name.includes("CASAL") && casalMattressCount > 0) {
                targetPrice = 250.00;
                const quantityToDiscount = Math.min(p.quantity, casalMattressCount);
                if (quantityToDiscount > 0) {
                    const discountPerItem = Math.max(0, p.price - targetPrice);
                    totalDiscount += (discountPerItem * quantityToDiscount);
                    casalMattressCount -= quantityToDiscount;
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
            else if (name.includes("SUPER KING") && superKingMattressCount > 0) {
                targetPrice = 350.00;
                const quantityToDiscount = Math.min(p.quantity, superKingMattressCount);
                if (quantityToDiscount > 0) {
                    const discountPerItem = Math.max(0, p.price - targetPrice);
                    totalDiscount += (discountPerItem * quantityToDiscount);
                    superKingMattressCount -= quantityToDiscount;
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
        // Fallback
        label = "Desconto Promocional";
    }

    return { totalDiscount, label };
  };

  // --- TOTAL CALCULATIONS ---
  const subtotal = data.products.reduce((acc, curr) => acc + (curr.price * curr.quantity), 0);
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
  const totalValue = Math.max(0, subtotal - totalDiscount);

  // Helper to create a temporary data object with the FULL discount applied for the PDF/Message
  const getDataForExport = () => {
    return {
        ...data,
        bundleDiscount: bundleDiscount,
        bundleLabel: bundleDiscountLabel, // Pass the computed label
        discountType: data.discountType,
        discountValue: data.discountValue
    } as ReceiptData;
  };

  const handleGeneratePDF = async () => {
    await generateReceiptPDF(getDataForExport());
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
      
      {/* Navbar */}
      <header className="border-b border-gray-800 bg-[#0047AB] shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
               <h1 className="text-3xl font-serif font-bold tracking-tight text-white drop-shadow-md">BelConfort</h1>
            </div>
            <div className="flex items-center gap-3 text-blue-100 text-[10px] tracking-[0.2em] font-medium uppercase mt-[-4px]">
               <span>Camas e Móveis</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="hidden sm:block text-right">
                <p className="text-xs text-blue-200 font-medium">Ecosistema</p>
                <p className="text-xs text-white font-bold">Vendas & Gestão</p>
             </div>
             <span className="text-[10px] font-medium px-2 py-1 bg-white/10 rounded-full text-white border border-white/20">v1.6.0</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Form */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Tab Navigation */}
            <div className="flex p-1 space-x-1 bg-gray-900 rounded-xl border border-gray-800">
                <button
                onClick={() => setActiveTab('manual')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                    activeTab === 'manual'
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
                >
                <FileText className="w-4 h-4" />
                Manual
                </button>
                <button
                onClick={() => setActiveTab('import')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                    activeTab === 'import'
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
                >
                <Sparkles className="w-4 h-4" />
                Importar
                </button>
                <button
                onClick={() => setActiveTab('team')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                    activeTab === 'team'
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
                >
                <Users className="w-4 h-4" />
                Equipe
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

            {/* Team Management Section */}
            {activeTab === 'team' && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                 <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                      <span className="w-1 h-6 bg-yellow-500 rounded-full"></span>
                      Gerenciar Equipe
                    </h2>
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Vendedores</span>
                  </div>

                  <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700/50 mb-6">
                    <div className="flex gap-2 items-end">
                      <Input
                        label="Nome do Vendedor"
                        value={newSalespersonName}
                        onChange={(e) => setNewSalespersonName(e.target.value)}
                        placeholder="Ex: JOÃO"
                        className="uppercase"
                        icon={<UserPlus className="w-4 h-4"/>}
                      />
                      <button
                        onClick={handleAddSalesperson}
                        disabled={!newSalespersonName.trim()}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white p-3.5 rounded-lg transition-colors"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">Vendedores Cadastrados</h3>
                    {salespeople.map((person) => (
                      <div key={person} className="flex items-center justify-between bg-gray-800 p-3 rounded-lg border border-gray-700">
                         <div className="flex items-center gap-3">
                           <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">
                             {person.substring(0,2)}
                           </div>
                           <span className="text-sm font-medium text-gray-200">{person}</span>
                         </div>
                         <button 
                           onClick={() => handleRemoveSalesperson(person)}
                           className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                         >
                           <Trash2 className="w-4 h-4" />
                         </button>
                      </div>
                    ))}
                    {salespeople.length === 0 && (
                      <p className="text-center text-gray-500 text-sm py-4">Nenhum vendedor cadastrado.</p>
                    )}
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
                    
                    {/* Searchable Input */}
                    <div className="relative">
                        <Input
                            label="Buscar Produto..."
                            value={searchTerm}
                            onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setIsSearchOpen(true);
                                setSelectedProduct(""); // Clear exact selection while typing
                            }}
                            onFocus={() => setIsSearchOpen(true)}
                            // Delay blur to allow click on dropdown items
                            onBlur={() => setTimeout(() => setIsSearchOpen(false), 200)}
                            icon={<Search className="w-4 h-4" />}
                            autoComplete="off"
                        />
                        
                        {/* Dropdown Results */}
                        {isSearchOpen && (
                            <div className="absolute z-20 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
                                {filteredProducts.length > 0 ? (
                                    filteredProducts.map((product) => (
                                        <button
                                            key={product}
                                            className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 transition-colors uppercase border-b border-gray-700/50 last:border-0"
                                            onClick={() => handleSearchSelect(product)}
                                        >
                                            {product}
                                        </button>
                                    ))
                                ) : (
                                    <div className="px-4 py-3 text-sm text-gray-500 text-center">
                                        Nenhum produto encontrado
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Price, Qty Row */}
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
                            readOnly
                            placeholder="0,00"
                            icon={<Tag className="w-4 h-4" />}
                            className="bg-gray-800/50 text-gray-500 cursor-not-allowed border-gray-700 focus:ring-0 focus:border-gray-700 hover:border-gray-700"
                        />
                    </div>

                    <button 
                        onClick={handleAddProduct}
                        className="w-full bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white text-sm font-semibold rounded-lg py-3 flex items-center justify-center gap-2 transition-colors uppercase mt-1"
                    >
                        <Plus className="w-4 h-4" />
                        Adicionar Produto
                    </button>
                    </div>

                    {/* Products List */}
                    {data.products.length > 0 && (
                    <div className="space-y-2 mt-4">
                        {data.products.map((p, idx) => (
                        <div key={idx} className="bg-gray-800 p-3 rounded-lg border border-gray-700 group">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex-1 min-w-0 pr-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[10px] text-gray-500 border border-gray-700 rounded px-1">{p.code}</span>
                                        <p className="text-sm text-gray-200 truncate font-medium">
                                            <span className="text-gray-400 mr-1">{p.quantity}x</span> {p.name}
                                        </p>
                                    </div>
                                    <p className="text-xs text-green-400 font-bold">
                                        {p.quantity} x {p.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} = {(p.quantity * p.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                    </p>
                                </div>
                                <button 
                                onClick={() => handleRemoveProduct(idx)}
                                className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                                >
                                <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                            
                            {/* Warranty Inputs inside list */}
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
                        </div>
                        ))}
                        
                        {/* Discount & Payment Section */}
                        <div className="mt-4 pt-4 border-t border-gray-700">
                            
                            {/* Payment Method - Moved Here */}
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

                            {/* Discount Section */}
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

                            <div className="flex flex-col gap-1 text-sm border-t border-gray-700/50 pt-2 mt-4">
                                <div className="pt-2 flex justify-between items-center text-gray-400">
                                    <span>Subtotal:</span>
                                    <span>{subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                </div>

                                {/* Automatic Bundle Discount Display */}
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

                {/* Client Data Section */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                    Dados do Cliente
                    </h2>
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Formulário</span>
                </div>
                
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
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
                    <div className="grid grid-cols-2 gap-4">
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

                    <div className="grid grid-cols-2 gap-4">
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

                    {/* Google Maps Actions */}
                    <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-gray-400 text-xs uppercase font-bold tracking-wider">
                           <MapPin className="w-4 h-4" />
                           <span>Localização</span>
                        </div>
                        <div className="flex gap-2">
                             <button
                                onClick={handleOpenMap}
                                disabled={!data.street}
                                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                             >
                                <ExternalLink className="w-3 h-3" />
                                Abrir no Maps
                             </button>
                             <button
                                onClick={handleShareLocation}
                                disabled={!data.street}
                                className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

                    <div className="grid grid-cols-2 gap-4">
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

          {/* Right Column: Preview & Actions */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Action Bar */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 shadow-xl flex flex-wrap gap-3 items-center justify-between">
              <div className="flex items-center gap-2">
                 <div className="h-8 w-8 rounded-full bg-gray-800 flex items-center justify-center">
                    <Printer className="w-4 h-4 text-gray-400" />
                 </div>
                 <span className="text-sm font-medium text-gray-300">Ações Rápidas</span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleResetData}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-red-900/20"
                >
                  <RotateCcw className="w-4 h-4" />
                  Novo Cliente
                </button>
                <button
                  onClick={handleSendWhatsApp}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-green-900/20"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </button>
                <button
                  onClick={handleSendEmail}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-gray-900/20"
                >
                  <Mail className="w-4 h-4" />
                  E-mail
                </button>
                <button
                  onClick={handleGeneratePDF}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20"
                >
                  <Download className="w-4 h-4" />
                  Gerar PDF
                </button>
              </div>
            </div>

            {/* Live Preview - Paper Style */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 z-10">
                    <span className="text-[10px] font-bold tracking-widest text-gray-600 uppercase border border-gray-700 bg-white/80 px-2 py-1 rounded backdrop-blur">Preview</span>
                </div>
                
                {/* Simulated Paper - MATCHING PDF EXACTLY */}
                <div className="bg-white text-gray-900 p-8 rounded-lg shadow-sm min-h-[800px] max-w-lg mx-auto transform transition-all flex flex-col">
                    
                    {/* 1. Header (Blue) */}
                    <div className="bg-[#1e40af] text-white p-6 -mx-8 -mt-8 mb-6 flex justify-between items-start">
                       <div className="flex flex-col justify-center h-full">
                           <h1 className="font-serif font-bold text-3xl">BelConfort</h1>
                           <span className="text-[9px] tracking-[0.2em] font-sans">CAMAS E MÓVEIS</span>
                       </div>
                       <div className="flex flex-col items-end text-[9px] leading-tight space-y-1 mt-2">
                           <p className="font-bold">CNPJ 60.190.028/0001-60</p>
                           <p>RUA B, 103C, CASTANHEIRA - BELEM/PA</p>
                           <p>belconfortcamasemoveis@gmail.com</p>
                           <p>(91) 99381-2592</p>
                           <div className="mt-2 w-8 h-8 bg-white/20 border border-white/40 flex items-center justify-center">
                               {/* QR Placeholder */}
                               <div className="w-6 h-6 bg-white/90 grid grid-cols-3 gap-0.5 p-0.5">
                                   <div className="bg-blue-900 col-span-2 row-span-2"></div>
                                   <div className="bg-blue-900"></div>
                                   <div className="bg-blue-900"></div>
                               </div>
                           </div>
                       </div>
                    </div>

                    {/* 2. Title */}
                    <div className="text-center mb-6">
                        <h2 className="text-lg font-bold text-gray-900 uppercase">COMPROVANTE DE COMPRA</h2>
                        <p className="text-[10px] text-gray-500">
                             Emissão: {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })} às {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    </div>

                    {/* 3. Client Data Grid (Boxed) */}
                    <div className="border border-gray-300 mb-6 text-sm">
                        {/* Row 1 */}
                        <div className="grid grid-cols-[20%_55%_25%] border-b border-gray-300">
                            <PreviewCell label="DATA DO PEDIDO" value={data.date ? new Date(data.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'} className="border-r border-gray-300" />
                            <PreviewCell label="CLIENTE" value={data.name} className="border-r border-gray-300" />
                            <PreviewCell label="CPF/CNPJ" value={data.cpf} />
                        </div>
                        {/* Row 2 - Split Address Grid */}
                        <div className="grid grid-cols-[40%_10%_15%_20%_15%] border-b border-gray-300">
                            <PreviewCell label="RUA" value={data.street} className="border-r border-gray-300" />
                            <PreviewCell label="Nº" value={data.number} className="border-r border-gray-300" />
                            <PreviewCell label="COMPLEMENTO" value={data.complement} className="border-r border-gray-300" />
                            <PreviewCell label="BAIRRO" value={data.neighborhood} className="border-r border-gray-300" />
                            <PreviewCell label="CIDADE" value={data.city} />
                        </div>
                        {/* Row 3 - Email, Contacts - REMOVED PAYMENT FROM HERE */}
                        <div className="grid grid-cols-[55%_45%]">
                             <PreviewCell label="E-MAIL" value={data.email} className="border-r border-gray-300" />
                             <PreviewCell label="CONTATOS" value={[data.contact1, data.contact2].filter(Boolean).join(' / ')} />
                        </div>
                    </div>

                    {/* 4. Products Table */}
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
                                    <div key={i} className="grid grid-cols-[40px_1fr_30px_60px_60px] text-[10px] text-gray-800 py-2 border-b border-gray-200 gap-2 items-start">
                                        <div className="truncate flex flex-col items-start">
                                            <span>{p.code || '-'}</span>
                                            {p.code && <BarcodePreview code={p.code} />}
                                        </div>
                                        <div>
                                            {p.name}
                                            {p.warrantyTime && (
                                                <div className="text-[8px] text-gray-500 mt-0.5">
                                                    GARANTIA DE FÁBRICA: {p.warrantyTime} {p.warrantyUnit} | 90 DIAS LOJA
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-center font-bold">{p.quantity}</div>
                                        <div className="text-right">{p.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                                        <div className="text-right font-bold">{(p.price * p.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                                    </div>
                                ))
                             ) : (
                                <div className="text-center text-xs text-gray-400 py-6">- Nenhum item adicionado -</div>
                             )}
                         </div>
                    </div>

                    {/* 5. Summary Section */}
                    <div className="flex items-start pt-5 mb-4 justify-between">
                        {/* Sale Code & Payment & Salesperson - Boxed/Grid Style */}
                        <div className="border border-gray-300 rounded w-[240px]">
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

                        {/* Totals */}
                        <div className="w-64 text-xs pt-2">
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
                             <div className="flex justify-between mt-2 bg-gray-50 p-1 rounded font-bold text-gray-900 border border-gray-200">
                                 <span>TOTAL:</span>
                                 <span>{totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                             </div>
                        </div>
                    </div>

                    {/* 6. Observation */}
                    <div className="bg-[#fefce8] border border-[#fef9c3] rounded-lg p-3 text-center mb-2">
                        <p className="text-[10px] font-bold text-[#a16207] mb-1">OBSERVAÇÃO</p>
                        <p className="text-[10px] italic text-gray-700 leading-tight">
                            A garantia cobre exclusivamente o que está especificado na etiqueta e no certificado de cada produto.
                        </p>
                    </div>

                    {/* 7. Return Policy (CDC) */}
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

                    {/* 8. Footer (Stamp & Signature) */}
                    <div className="mt-12 pt-8 pb-4 relative">
                        {/* Signature Line */}
                        <div className="border-t border-dashed border-gray-400 w-1/2 mx-auto mb-1"></div>
                        <p className="text-[10px] text-gray-500 text-center">Assinatura do Responsável</p>
                        <p className="text-[8px] text-gray-300 text-center mt-4">Documento gerado pelo Ecosistema Belconfort</p>

                        {/* Simulated Signature Layer (SVG) */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 w-40 h-20 pointer-events-none opacity-50 text-blue-900">
                            <svg viewBox="0 0 100 50" width="100%" height="100%">
                                <path 
                                    d="M35 36 C 37 21, 43 21, 43 36 C 43 24, 49 24, 49 36 C 51 33, 53 38, 54 35 L 56 28 L 56 36 C 57 26, 61 26, 61 36 C 61 31, 64 31, 64 36 C 67 34, 70 38, 73 34 M 30 41 C 45 44, 65 39, 80 42" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    strokeWidth="0.15" // Very thin
                                />
                            </svg>
                        </div>

                        {/* Simulated Stamp Layer */}
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-48 h-20 pointer-events-none flex flex-col items-center justify-center">
                            {/* Brackets */}
                            <div className="absolute top-0 left-0 w-3 h-3 border-l-2 border-t-2 border-blue-900"></div>
                            <div className="absolute top-0 right-0 w-3 h-3 border-r-2 border-t-2 border-blue-900"></div>
                            <div className="absolute bottom-0 left-0 w-3 h-3 border-l-2 border-b-2 border-blue-900"></div>
                            <div className="absolute bottom-0 right-0 w-3 h-3 border-r-2 border-b-2 border-blue-900"></div>
                            
                            {/* Content */}
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
