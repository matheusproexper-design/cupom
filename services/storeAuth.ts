export interface StoreUser {
  name: string;
  password: string;
}

export const STORE_USERS: StoreUser[] = [
  { name: 'Sara Noemi', password: '5073Ma' },
  { name: 'Gabriel Silva', password: '91660855Gg#' },
  { name: 'Robson Luiz', password: '50735073' },
  { name: 'Ana Maria', password: '985149554' },
  { name: 'Jefferson Martins', password: '310720' },
  { name: 'Manoela Pereira', password: '456712' },
  { name: 'Débora Evelyn', password: 'Debora100' },
  { name: 'Italo Monteiro', password: 'Ita301117' },
  { name: 'Matheus pereira', password: '32855073' },
  { name: 'Telmis Cardoso', password: 'Top1telmis' },
  { name: 'Patricia', password: '319523' },
  { name: 'Benedito de jesus', password: '9042020' },
];

export const STORE_USER_NAMES = STORE_USERS.map(u => u.name);

/**
 * Procura um usuário cadastrado com base na senha digitada.
 * Realiza comparação exata (com trim) e fallback insensível a maiúsculas/minúsculas.
 */
export function findUserByPassword(inputPassword: string): StoreUser | null {
  if (!inputPassword) return null;
  const trimmed = inputPassword.trim();
  if (!trimmed) return null;

  // 1. Busca exata
  const exactMatch = STORE_USERS.find(user => user.password === trimmed);
  if (exactMatch) return exactMatch;

  // 2. Fallback insensível a maiúsculas/minúsculas para evitar falhas por autocapitalização de teclado móvel
  const lower = trimmed.toLowerCase();
  const caseInsensitiveMatch = STORE_USERS.find(
    user => user.password.toLowerCase() === lower
  );
  if (caseInsensitiveMatch) return caseInsensitiveMatch;

  return null;
}
