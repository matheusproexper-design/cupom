import React, { useState, useEffect, useRef } from 'react';
import { Lock, ShieldCheck, Eye, EyeOff, UserCheck, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { findUserByPassword, StoreUser } from '../services/storeAuth';

interface StoreAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: StoreUser) => void;
  actionType?: 'pdf' | 'whatsapp' | 'email' | 'identify';
  currentSalesperson?: string;
}

export const StoreAuthModal: React.FC<StoreAuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  actionType = 'pdf',
  currentSalesperson = '',
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [matchedUser, setMatchedUser] = useState<StoreUser | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setErrorMsg('');
      setMatchedUser(null);
      setShowPassword(false);
      // Focus input on open
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Live match as user types
  const handlePasswordChange = (val: string) => {
    setPassword(val);
    setErrorMsg('');
    if (!val.trim()) {
      setMatchedUser(null);
      return;
    }
    const user = findUserByPassword(val);
    if (user) {
      setMatchedUser(user);
    } else {
      setMatchedUser(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setErrorMsg('Por favor, informe sua senha de usuário do aplicativo da loja.');
      return;
    }

    const user = findUserByPassword(password);
    if (!user) {
      setErrorMsg('Senha incorreta! Não encontramos nenhum usuário com esta senha.');
      return;
    }

    onSuccess(user);
  };

  if (!isOpen) return null;

  const actionLabels: Record<string, { title: string; btn: string }> = {
    pdf: {
      title: 'Gerar Comprovante em PDF',
      btn: 'Confirmar e Gerar PDF',
    },
    whatsapp: {
      title: 'Enviar Comprovante via WhatsApp',
      btn: 'Confirmar e Enviar WhatsApp',
    },
    email: {
      title: 'Enviar Comprovante por E-mail',
      btn: 'Confirmar e Enviar E-mail',
    },
    identify: {
      title: 'Identificar Usuário Responsável',
      btn: 'Confirmar Usuário',
    },
  };

  const currentAction = actionLabels[actionType] || actionLabels.pdf;

  return (
    <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-gray-900 border border-blue-500/40 rounded-2xl sm:rounded-3xl max-w-md w-full p-5 sm:p-7 shadow-2xl shadow-blue-950/80 relative my-auto text-left ring-1 ring-blue-500/20">
        
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white bg-gray-800/80 hover:bg-gray-700 p-1.5 rounded-full transition-colors"
          title="Cancelar"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Header */}
        <div className="flex items-start gap-3.5 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shadow-lg shadow-blue-600/30 flex-shrink-0">
            <ShieldCheck className="w-6 h-6 text-blue-100" />
          </div>
          <div>
            <span className="text-[10px] font-bold tracking-wider text-blue-400 uppercase bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20 inline-flex items-center gap-1">
              <Lock className="w-2.5 h-2.5" />
              Segurança da Loja
            </span>
            <h2 className="text-lg sm:text-xl font-bold text-white mt-1">
              {currentAction.title}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
              Insira sua senha de usuário para emitir o comprovante. O responsável será colocado automaticamente.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center justify-between">
              <span>Senha de Usuário do Aplicativo</span>
              {matchedUser && (
                <span className="text-emerald-400 font-normal normal-case text-[11px] flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Senha reconhecida
                </span>
              )}
            </label>

            <div className="relative">
              <input
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => handlePasswordChange(e.target.value)}
                placeholder="Digite sua senha de usuário..."
                autoComplete="off"
                className={`w-full bg-gray-800/90 border ${
                  matchedUser 
                    ? 'border-emerald-500 ring-2 ring-emerald-500/30' 
                    : errorMsg 
                    ? 'border-red-500 ring-2 ring-red-500/20' 
                    : 'border-gray-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30'
                } rounded-xl px-3.5 py-3 pr-11 text-white text-sm placeholder-gray-500 transition-all outline-none font-mono`}
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 p-1 rounded transition-colors"
                title={showPassword ? 'Ocultar senha' : 'Ver senha'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Matched User Visual Card */}
          {matchedUser && (
            <div className="bg-emerald-950/50 border border-emerald-500/40 rounded-xl p-3.5 flex items-center gap-3 animate-in fade-in duration-150">
              <div className="w-9 h-9 rounded-xl bg-emerald-600/30 border border-emerald-500/50 flex items-center justify-center text-emerald-300 flex-shrink-0">
                <UserCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">
                  Usuário Responsável no Comprovante:
                </p>
                <p className="text-base font-bold text-white uppercase truncate">
                  {matchedUser.name}
                </p>
              </div>
            </div>
          )}

          {/* Error message */}
          {errorMsg && (
            <div className="bg-red-950/60 border border-red-500/40 rounded-xl p-3 flex items-center gap-2.5 text-red-200 text-xs animate-in shake duration-150">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Help tip when no password entered yet */}
          {!matchedUser && !errorMsg && (
            <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-3 text-[11px] text-gray-400 leading-relaxed">
              <p className="font-semibold text-gray-300 mb-1">ℹ️ Como funciona:</p>
              <p>
                Cada atendente possui sua senha individual. Ao digitar a sua senha, o sistema identifica você e insere seu nome como responsável pela venda no comprovante.
              </p>
              {currentSalesperson && (
                <p className="mt-1.5 pt-1.5 border-t border-gray-700/60 text-gray-400">
                  Atendente anterior na tela: <span className="font-semibold text-gray-200 uppercase">{currentSalesperson}</span>
                </p>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors border border-gray-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!matchedUser}
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg ${
                matchedUser
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-900/30 cursor-pointer scale-[1.02]'
                  : 'bg-gray-800 text-gray-500 border border-gray-700/50 cursor-not-allowed'
              }`}
            >
              <Lock className="w-4 h-4" />
              {currentAction.btn}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
