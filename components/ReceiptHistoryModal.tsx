import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { generateReceiptPDF } from '../services/pdfService';
import { ReceiptData, INITIAL_DATA, formatSafeDate } from '../types';
import { 
  X, Search, Download, Loader2, RefreshCw, 
  Calendar, User, ShoppingBag, DollarSign, 
  RotateCcw, Trash2, FileText, ChevronDown, ChevronUp, AlertCircle,
  Lock, Eye, EyeOff, ShieldAlert
} from 'lucide-react';

const ADMIN_DELETE_PASSWORD = '50735073Math@';

export interface ComprovanteItem {
  id: string;
  comprovante_id: string;
  nome_produto: string;
  quantidade: number;
  preco: number;
}

export interface Comprovante {
  id: string;
  cliente_nome: string;
  total: number;
  data_emissao: string;
  itens_comprovante?: ComprovanteItem[];
}

interface ReceiptHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadReceipt?: (receiptData: Partial<ReceiptData>) => void;
}

export const ReceiptHistoryModal: React.FC<ReceiptHistoryModalProps> = ({
  isOpen,
  onClose,
  onLoadReceipt,
}) => {
  const [comprovantes, setComprovantes] = useState<Comprovante[]>([]);
  const [serverSnapshots, setServerSnapshots] = useState<Record<string, ReceiptData>>({});
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Password confirmation states
  const [itemToDelete, setItemToDelete] = useState<Comprovante | null>(null);
  const [inputPassword, setInputPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const fetchHistory = async () => {
    setLoading(true);
    try {
      // 1. Carrega comprovantes do Supabase
      const { data, error } = await supabase
        .from('comprovantes')
        .select('*, itens_comprovante(*)')
        .order('data_emissao', { ascending: false });

      if (error) {
        console.error('[Supabase] Erro ao carregar histórico:', error);
      } else if (data) {
        setComprovantes(data as Comprovante[]);
      }

      // 2. Carrega snapshots do servidor
      try {
        const snapRes = await fetch('/api/receipts-snapshots');
        if (snapRes.ok) {
          const snaps = await snapRes.json();
          if (snaps && typeof snaps === 'object') {
            setServerSnapshots(snaps);
          }
        }
      } catch (snapErr) {
        console.warn('Erro ao carregar snapshots do servidor:', snapErr);
      }
    } catch (err) {
      console.error('[Supabase] Falha ao consultar comprovantes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Extrai o snapshot completo de emissão se disponível no comprovante, no servidor ou no cache local
  const getSnapshotFromComprovante = (comp: Comprovante): ReceiptData | null => {
    // 1. Snapshot persistido no backend
    if (serverSnapshots && serverSnapshots[comp.id]) {
      return serverSnapshots[comp.id];
    }

    // 2. Snapshot salvo no banco (itens_comprovante)
    if (comp.itens_comprovante && comp.itens_comprovante.length > 0) {
      const snapshotItem = comp.itens_comprovante.find(i => 
        i.nome_produto && i.nome_produto.includes('__BELCONFORT_RECEIPT_SNAPSHOT__:')
      );
      if (snapshotItem && snapshotItem.nome_produto) {
        try {
          const idx = snapshotItem.nome_produto.indexOf('__BELCONFORT_RECEIPT_SNAPSHOT__:');
          const jsonStr = snapshotItem.nome_produto.substring(idx + '__BELCONFORT_RECEIPT_SNAPSHOT__:'.length);
          const parsed = JSON.parse(jsonStr);
          if (parsed && typeof parsed === 'object') {
            return parsed as ReceiptData;
          }
        } catch (e) {
          console.error('Erro ao ler snapshot do comprovante:', e);
        }
      }
    }

    // 3. Fallback: verificar cache em localStorage
    try {
      const stored = JSON.parse(localStorage.getItem('belconfort_receipt_snapshots') || '{}');
      if (stored[comp.id]) {
        return stored[comp.id] as ReceiptData;
      }
    } catch {}

    return null;
  };

  // Reconstrói o ReceiptData completo com 100% dos dados originais da emissão
  const getFullReceiptData = (comp: Comprovante): ReceiptData => {
    const snapshot = getSnapshotFromComprovante(comp);
    if (snapshot) {
      return {
        ...INITIAL_DATA,
        ...snapshot,
        date: formatSafeDate(snapshot.date, formatSafeDate(comp.data_emissao)),
        emissionDate: formatSafeDate(snapshot.emissionDate, formatSafeDate(comp.data_emissao)),
        products: (Array.isArray(snapshot.products) ? snapshot.products : []).filter(p => 
          p && p.name && !p.name.includes('__BELCONFORT_RECEIPT_SNAPSHOT__') && !p.name.startsWith('__')
        )
      };
    }

    // Fallback gracioso para registros legados sem snapshot
    const dateObj = comp.data_emissao ? new Date(comp.data_emissao) : new Date();
    const formattedDate = formatSafeDate(comp.data_emissao);
    const emissionDate = formatSafeDate(comp.data_emissao);
    const emissionTime = !isNaN(dateObj.getTime()) 
      ? dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) 
      : new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const validItems = (comp.itens_comprovante || []).filter(i => 
      i.nome_produto && !i.nome_produto.includes('__BELCONFORT_RECEIPT_SNAPSHOT__') && !i.nome_produto.startsWith('__')
    );

    const prods = validItems.length > 0
      ? validItems.map((item, idx) => ({
          code: (100000 + idx).toString(),
          name: item.nome_produto || 'PRODUTO',
          price: Number(item.preco) || 0,
          quantity: Number(item.quantidade) || 1,
          warrantyTime: '1',
          warrantyUnit: 'ANOS' as const
        }))
      : [
          {
            code: '100001',
            name: 'PRODUTO REGISTRADO EM COMPROVANTE',
            price: Number(comp.total) || 0,
            quantity: 1,
            warrantyUnit: 'MESES' as const
          }
        ];

    const itemsSum = prods.reduce((sum, p) => sum + (p.price * p.quantity), 0);
    const discount = Math.max(0, itemsSum - Number(comp.total || 0));

    return {
      ...INITIAL_DATA,
      name: comp.cliente_nome || 'CLIENTE NÃO INFORMADO',
      date: formattedDate,
      emissionDate: emissionDate,
      emissionTime: emissionTime,
      products: prods,
      discountType: 'fixed',
      discountValue: discount,
      paymentMethod: 'NÃO ESPECIFICADO'
    };
  };

  const filteredList = comprovantes.filter(c => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const matchesName = (c.cliente_nome || '').toLowerCase().includes(term);
    const matchesId = (c.id || '').toLowerCase().includes(term);
    
    // Itens reais do comprovante (excluindo snapshot)
    const validItems = (c.itens_comprovante || []).filter(i => 
      i && i.nome_produto && !i.nome_produto.includes('__BELCONFORT_RECEIPT_SNAPSHOT__') && !i.nome_produto.startsWith('__')
    );
    const matchesItem = validItems.some(i => 
      (i.nome_produto || '').toLowerCase().includes(term)
    );

    // Snapshot metadata (vendedor, código de venda, cpf)
    const snap = getSnapshotFromComprovante(c);
    const matchesSeller = snap?.salesperson ? snap.salesperson.toLowerCase().includes(term) : false;
    const matchesSaleCode = snap?.saleCode ? snap.saleCode.toLowerCase().includes(term) : false;
    const matchesCpf = snap?.cpf ? snap.cpf.toLowerCase().includes(term) : false;

    return matchesName || matchesId || matchesItem || matchesSeller || matchesSaleCode || matchesCpf;
  });

  const totalValueSum = comprovantes.reduce((sum, c) => sum + (Number(c.total) || 0), 0);

  const handleDownloadPDF = async (comp: Comprovante) => {
    setDownloadingId(comp.id);
    try {
      // Reconstrói 100% dos dados originais da emissão
      const receiptData = getFullReceiptData(comp);
      await generateReceiptPDF(receiptData);
    } catch (err) {
      console.error('Erro ao gerar PDF do histórico:', err);
      alert('Erro ao gerar PDF para este comprovante.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleLoadToForm = (comp: Comprovante) => {
    if (onLoadReceipt) {
      const receiptData = getFullReceiptData(comp);
      onLoadReceipt(receiptData);
      onClose();
    }
  };

  const handleRequestDelete = (comp: Comprovante) => {
    setItemToDelete(comp);
    setInputPassword('');
    setPasswordError('');
    setShowPassword(false);
  };

  const handleConfirmDeleteWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemToDelete) return;

    if (inputPassword !== ADMIN_DELETE_PASSWORD) {
      setPasswordError('Senha incorreta! Não autorizado a excluir.');
      return;
    }

    const id = itemToDelete.id;
    setDeletingId(id);
    setItemToDelete(null);

    try {
      await supabase.from('itens_comprovante').delete().eq('comprovante_id', id);
      const { error } = await supabase.from('comprovantes').delete().eq('id', id);
      if (error) {
        alert('Erro ao excluir comprovante: ' + error.message);
      } else {
        setComprovantes(prev => prev.filter(c => c.id !== id));
        // Remove do cache de snapshots do servidor e local
        try {
          await fetch(`/api/receipts-snapshots/${id}`, { method: 'DELETE' });
          setServerSnapshots(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          const stored = JSON.parse(localStorage.getItem('belconfort_receipt_snapshots') || '{}');
          delete stored[id];
          localStorage.setItem('belconfort_receipt_snapshots', JSON.stringify(stored));
        } catch {}
      }
    } catch (err) {
      console.error('Erro ao excluir:', err);
    } finally {
      setDeletingId(null);
      setInputPassword('');
      setPasswordError('');
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-gray-900 border border-gray-800 rounded-xl sm:rounded-2xl w-full max-w-4xl max-h-[92vh] sm:max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-4 py-3 sm:px-6 sm:py-5 border-b border-gray-800 flex items-center justify-between bg-gray-900/90 sticky top-0 z-10">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 flex-shrink-0">
              <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                Histórico
                <span className="text-[10px] sm:text-xs font-normal px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  Supabase
                </span>
              </h2>
              <p className="text-[11px] sm:text-xs text-gray-400">
                Visualize e gerencie os comprovantes
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={fetchHistory}
              disabled={loading}
              title="Atualizar lista"
              className="p-2 text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Stats & Search Bar */}
        <div className="p-6 pb-3 space-y-4 border-b border-gray-800/80 bg-gray-950/40">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Total de Comprovantes</p>
                <p className="text-2xl font-bold text-white mt-0.5">{comprovantes.length}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <FileText className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Total Faturado no Histórico</p>
                <p className="text-2xl font-bold text-green-400 mt-0.5">
                  {totalValueSum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por cliente, ID do comprovante ou nome de produto..."
              className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500 text-gray-100 text-sm rounded-xl pl-10 pr-4 py-2.5 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all uppercase"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-200"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center text-gray-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
              <p className="text-sm font-medium">Carregando comprovantes do Supabase...</p>
            </div>
          ) : filteredList.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-gray-800 rounded-2xl bg-gray-950/20">
              <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 mb-3">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-gray-200">
                {searchTerm ? 'Nenhum comprovante encontrado para a busca' : 'Nenhum comprovante emitido ainda'}
              </h3>
              <p className="text-xs text-gray-400 max-w-sm mt-1">
                {searchTerm 
                  ? 'Tente buscar com outro nome de cliente ou termo.' 
                  : 'Gere um novo PDF no formulário principal para que ele seja salvo automaticamente aqui no histórico do Supabase.'}
              </p>
            </div>
          ) : (
            filteredList.map((comp) => {
              const snapshot = getSnapshotFromComprovante(comp);
              const validItems = (comp.itens_comprovante || []).filter(i => 
                i && i.nome_produto && !i.nome_produto.includes('__BELCONFORT_RECEIPT_SNAPSHOT__') && !i.nome_produto.startsWith('__')
              );
              const hasSnapshotProducts = Boolean(snapshot?.products && snapshot.products.length > 0);
              const itemsCount = hasSnapshotProducts ? snapshot!.products.length : validItems.length;
              const isExpanded = expandedId === comp.id;
              const isDownloading = downloadingId === comp.id;
              const isDeleting = deletingId === comp.id;

              return (
                <div
                  key={comp.id}
                  className="bg-gray-800/70 hover:bg-gray-800 border border-gray-700/60 rounded-xl p-4 transition-all duration-150 shadow-sm"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    
                    {/* Left: Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-bold text-white uppercase tracking-tight flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-purple-400" />
                          {snapshot?.name || comp.cliente_nome || 'CLIENTE NÃO INFORMADO'}
                        </span>
                        {snapshot?.saleCode && (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/60">
                            PEDIDO: {snapshot.saleCode}
                          </span>
                        )}
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-900 text-gray-400 border border-gray-700">
                          ID: {comp.id.substring(0, 8)}...
                        </span>
                      </div>

                      <div className="flex items-center gap-x-4 gap-y-1 text-xs text-gray-400 flex-wrap mt-1">
                        <span className="flex items-center gap-1 text-gray-300 font-medium">
                          <Calendar className="w-3.5 h-3.5 text-purple-400" />
                          {snapshot?.emissionDate && snapshot?.emissionTime 
                            ? `Emitido em ${snapshot.emissionDate} às ${snapshot.emissionTime}` 
                            : formatDate(comp.data_emissao)}
                        </span>
                        <span className="flex items-center gap-1">
                          <ShoppingBag className="w-3.5 h-3.5 text-gray-500" />
                          {itemsCount} {itemsCount === 1 ? 'produto' : 'produtos'}
                        </span>
                        {snapshot?.salesperson && (
                          <span className="text-gray-400">
                            <span className="text-gray-500 font-semibold">Vendedor:</span> {snapshot.salesperson}
                          </span>
                        )}
                        {snapshot?.paymentMethod && (
                          <span className="text-gray-400">
                            <span className="text-gray-500 font-semibold">Pagamento:</span> {snapshot.paymentMethod}
                          </span>
                        )}
                        {(snapshot?.city || snapshot?.neighborhood) && (
                          <span className="text-gray-400 truncate max-w-xs">
                            <span className="text-gray-500 font-semibold">Local:</span> {[snapshot.neighborhood, snapshot.city].filter(Boolean).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle: Price */}
                    <div className="md:text-right">
                      <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Valor Total</p>
                      <p className="text-lg font-extrabold text-green-400">
                        {Number(comp.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </p>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 flex-wrap pt-2 md:pt-0 border-t md:border-t-0 border-gray-700/50">
                      
                      {/* Toggle items */}
                      {itemsCount > 0 && (
                        <button
                          onClick={() => toggleExpand(comp.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-700/60 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors"
                          title="Ver detalhes e produtos da venda"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="w-3.5 h-3.5" />
                              Ocultar
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3.5 h-3.5" />
                              Detalhes ({itemsCount})
                            </>
                          )}
                        </button>
                      )}

                      {/* Download PDF */}
                      <button
                        onClick={() => handleDownloadPDF(comp)}
                        disabled={isDownloading}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-blue-900/20"
                        title="Baixar PDF idêntico ao emitido originalmente"
                      >
                        {isDownloading ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Gerando...
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5" />
                            Baixar PDF
                          </>
                        )}
                      </button>

                      {/* Load to form */}
                      {onLoadReceipt && (
                        <button
                          onClick={() => handleLoadToForm(comp)}
                          className="p-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white rounded-lg transition-colors"
                          title="Recarregar todos os dados desta venda no formulário"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Delete */}
                      <button
                        onClick={() => handleRequestDelete(comp)}
                        disabled={isDeleting}
                        className="p-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 hover:text-red-300 rounded-lg transition-colors disabled:opacity-50"
                        title="Excluir comprovante (Requer senha)"
                      >
                        {isDeleting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>

                    </div>
                  </div>

                  {/* Expanded Items & Full Metadata Drawer */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-gray-700/80 bg-gray-900/70 rounded-lg p-3.5 space-y-3 animate-in fade-in duration-150">
                      
                      {/* Products List */}
                      <div>
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                          Produtos da Venda:
                        </p>
                        <div className="space-y-1.5">
                          {hasSnapshotProducts ? (
                            snapshot!.products.map((prod, idx) => (
                              <div
                                key={prod.code || idx}
                                className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded bg-gray-800/90 border border-gray-700/50"
                              >
                                <div className="flex items-center gap-2 min-w-0 pr-2">
                                  <span className="w-5 h-5 rounded bg-purple-500/20 text-purple-300 font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                                    {prod.quantity}x
                                  </span>
                                  {prod.code && (
                                    <span className="text-[10px] font-mono text-gray-400">
                                      #{prod.code}
                                    </span>
                                  )}
                                  <span className="text-gray-100 uppercase font-medium truncate">
                                    {prod.name}
                                  </span>
                                  {prod.warrantyTime && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/30">
                                      Garantia: {prod.warrantyTime} {prod.warrantyUnit}
                                    </span>
                                  )}
                                  {prod.isExchange && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/30 font-bold">
                                      TROCA
                                    </span>
                                  )}
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <span className="text-green-400 font-bold">
                                    {Number(prod.price * prod.quantity).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                  </span>
                                  {prod.quantity > 1 && (
                                    <span className="text-[10px] text-gray-400 ml-1">
                                      ({Number(prod.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} un)
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))
                          ) : (
                            validItems.map((item, idx) => (
                              <div
                                key={item.id || idx}
                                className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded bg-gray-800/90 border border-gray-700/50"
                              >
                                <div className="flex items-center gap-2 min-w-0 pr-2">
                                  <span className="w-5 h-5 rounded bg-purple-500/20 text-purple-300 font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                                    {item.quantidade}x
                                  </span>
                                  <span className="text-gray-200 uppercase font-medium truncate">
                                    {item.nome_produto}
                                  </span>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <span className="text-green-400 font-bold">
                                    {Number(item.preco * item.quantidade).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                  </span>
                                  {item.quantidade > 1 && (
                                    <span className="text-[10px] text-gray-400 ml-1">
                                      ({Number(item.preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} un)
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Snapshot Metadata Box if available */}
                      {snapshot && (
                        <div className="pt-2 border-t border-gray-800 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-gray-400 bg-gray-950/40 p-2.5 rounded-lg">
                          <div>
                            <span className="font-semibold text-gray-300">Cliente:</span> {snapshot.name || 'NÃO INFORMADO'}
                            {snapshot.cpf && <span className="ml-2 font-mono">({snapshot.cpf})</span>}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-300">Telefones:</span> {[snapshot.contact1, snapshot.contact2].filter(Boolean).join(' / ') || 'NÃO INFORMADO'}
                          </div>
                          {(snapshot.street || snapshot.city) && (
                            <div className="sm:col-span-2">
                              <span className="font-semibold text-gray-300">Endereço:</span> {[snapshot.street, snapshot.number, snapshot.neighborhood, snapshot.city, snapshot.complement].filter(Boolean).join(', ')}
                            </div>
                          )}
                          {(snapshot.discountValue > 0 || (snapshot.bundleDiscount && snapshot.bundleDiscount > 0)) && (
                            <div>
                              <span className="font-semibold text-amber-400">Desconto Aplicado:</span> {Number((snapshot.discountValue || 0) + (snapshot.bundleDiscount || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              {snapshot.bundleLabel && <span className="ml-1 text-gray-400">({snapshot.bundleLabel})</span>}
                            </div>
                          )}
                          {snapshot.shippingValue && snapshot.shippingValue > 0 ? (
                            <div>
                              <span className="font-semibold text-blue-400">Frete:</span> {Number(snapshot.shippingValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </div>
                          ) : null}
                          {snapshot.observation && (
                            <div className="sm:col-span-2 pt-1 border-t border-gray-800/60 text-gray-400 italic">
                              <span className="font-semibold text-gray-300 not-italic">Observação:</span> {snapshot.observation}
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/90 flex items-center justify-between text-xs text-gray-400">
          <span>Total de {filteredList.length} registro(s) exibido(s)</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
          >
            Fechar
          </button>
        </div>

      </div>

      {/* Modal de Confirmação com Senha para Excluir */}
      {itemToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-gray-900 border border-red-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 flex-shrink-0">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Autorização Necessária</h3>
                <p className="text-xs text-gray-400">
                  Informe a senha administrativa para excluir este registro.
                </p>
              </div>
            </div>

            <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-3 text-xs space-y-1">
              <p className="text-gray-400">
                <span className="font-semibold text-gray-300">Cliente:</span> {itemToDelete.cliente_nome || 'NÃO INFORMADO'}
              </p>
              <p className="text-gray-400">
                <span className="font-semibold text-gray-300">Valor Total:</span>{' '}
                <span className="text-green-400 font-bold">
                  {Number(itemToDelete.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
              </p>
              <p className="text-gray-500 font-mono text-[10px]">
                ID: {itemToDelete.id}
              </p>
            </div>

            <form onSubmit={handleConfirmDeleteWithPassword} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-purple-400" />
                  Senha de Exclusão
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={inputPassword}
                    onChange={(e) => {
                      setInputPassword(e.target.value);
                      if (passwordError) setPasswordError('');
                    }}
                    placeholder="Digite a senha de segurança..."
                    autoFocus
                    className="w-full bg-gray-950 border border-gray-700 focus:border-red-500 text-gray-100 text-sm rounded-xl pl-3 pr-10 py-2.5 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordError && (
                  <p className="text-xs text-red-400 font-medium flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {passwordError}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setItemToDelete(null);
                    setInputPassword('');
                    setPasswordError('');
                  }}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!inputPassword}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-red-900/30 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Confirmar Exclusão
                </button>
              </div>
            </form>

          </div>
        </div>
      )}
    </div>
  );
};
