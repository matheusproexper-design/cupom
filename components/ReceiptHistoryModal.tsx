import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { generateReceiptPDF } from '../services/pdfService';
import { ReceiptData, INITIAL_DATA } from '../types';
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
      const { data, error } = await supabase
        .from('comprovantes')
        .select('*, itens_comprovante(*)')
        .order('data_emissao', { ascending: false });

      if (error) {
        console.error('[Supabase] Erro ao carregar histórico:', error);
      } else if (data) {
        setComprovantes(data as Comprovante[]);
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

  const filteredList = comprovantes.filter(c => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const matchesName = (c.cliente_nome || '').toLowerCase().includes(term);
    const matchesId = (c.id || '').toLowerCase().includes(term);
    const matchesItem = (c.itens_comprovante || []).some(i => 
      (i.nome_produto || '').toLowerCase().includes(term)
    );
    return matchesName || matchesId || matchesItem;
  });

  const totalValueSum = comprovantes.reduce((sum, c) => sum + (Number(c.total) || 0), 0);

  const handleDownloadPDF = async (comp: Comprovante) => {
    setDownloadingId(comp.id);
    try {
      const formattedDate = comp.data_emissao 
        ? new Date(comp.data_emissao).toLocaleDateString('pt-BR') 
        : new Date().toLocaleDateString('pt-BR');

      const receiptData: ReceiptData = {
        ...INITIAL_DATA,
        name: comp.cliente_nome || 'CLIENTE',
        date: formattedDate,
        products: (comp.itens_comprovante && comp.itens_comprovante.length > 0)
          ? comp.itens_comprovante.map((item, idx) => ({
              code: (100000 + idx).toString(),
              name: item.nome_produto || 'PRODUTO',
              price: Number(item.preco) || 0,
              quantity: Number(item.quantidade) || 1,
              warrantyUnit: 'MESES'
            }))
          : [
              {
                code: '100001',
                name: 'PRODUTO REGISTRADO EM COMPROVANTE',
                price: Number(comp.total) || 0,
                quantity: 1,
                warrantyUnit: 'MESES'
              }
            ],
        discountType: 'fixed',
        discountValue: 0
      };

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
      const formattedDate = comp.data_emissao 
        ? new Date(comp.data_emissao).toLocaleDateString('pt-BR') 
        : '';

      const products = (comp.itens_comprovante && comp.itens_comprovante.length > 0)
        ? comp.itens_comprovante.map((item, idx) => ({
            code: (100000 + idx).toString(),
            name: item.nome_produto || 'PRODUTO',
            price: Number(item.preco) || 0,
            quantity: Number(item.quantidade) || 1,
            warrantyUnit: 'MESES' as const
          }))
        : [];

      onLoadReceipt({
        name: comp.cliente_nome || '',
        date: formattedDate,
        products: products,
      });

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-800 flex items-center justify-between bg-gray-900/90 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Histórico de Comprovantes
                <span className="text-xs font-normal px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  Supabase
                </span>
              </h2>
              <p className="text-xs text-gray-400">
                Visualize, gerencie e faça o download dos comprovantes emitidos
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
              const isExpanded = expandedId === comp.id;
              const itemsCount = comp.itens_comprovante?.length || 0;
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
                          {comp.cliente_nome || 'CLIENTE NÃO INFORMADO'}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-900 text-gray-400 border border-gray-700">
                          ID: {comp.id.substring(0, 8)}...
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-gray-500" />
                          {formatDate(comp.data_emissao)}
                        </span>
                        <span className="flex items-center gap-1">
                          <ShoppingBag className="w-3.5 h-3.5 text-gray-500" />
                          {itemsCount} {itemsCount === 1 ? 'item' : 'itens'}
                        </span>
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
                          title="Ver itens da venda"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="w-3.5 h-3.5" />
                              Ocultar
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3.5 h-3.5" />
                              Itens ({itemsCount})
                            </>
                          )}
                        </button>
                      )}

                      {/* Download PDF */}
                      <button
                        onClick={() => handleDownloadPDF(comp)}
                        disabled={isDownloading}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-blue-900/20"
                        title="Baixar PDF deste comprovante"
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
                          title="Carregar dados desta venda no formulário"
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

                  {/* Expanded Items Drawer */}
                  {isExpanded && comp.itens_comprovante && comp.itens_comprovante.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-700/80 bg-gray-900/60 rounded-lg p-3 space-y-2 animate-in fade-in duration-150">
                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                        Itens Inclusos na Venda:
                      </p>
                      <div className="space-y-1.5">
                        {comp.itens_comprovante.map((item, idx) => (
                          <div
                            key={item.id || idx}
                            className="flex items-center justify-between text-xs py-1 px-2 rounded bg-gray-800/80 border border-gray-700/40"
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
                        ))}
                      </div>
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
