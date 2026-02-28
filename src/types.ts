export interface Transaction {
  id: string | number;
  desc: string;
  amount: number;
  cat: string;
  date: string;
  type: 'expense' | 'saving';
}

export interface User {
  name: string;
  password?: string;
}

export interface UsersMap {
  [username: string]: User;
}

export interface CategoryDef {
  icon: string;
  color: string;
  label: string;
}

export const CATS: Record<string, CategoryDef> = {
  food: { icon: '🍔', color: '#f4845f', label: 'Food & Dining' },
  transport: { icon: '🚗', color: '#9b72cf', label: 'Transport' },
  shopping: { icon: '🛍️', color: '#e84855', label: 'Shopping' },
  health: { icon: '💊', color: '#2ec4b6', label: 'Health' },
  bills: { icon: '💡', color: '#f0c040', label: 'Bills & Utilities' },
  entertainment: { icon: '🎮', color: '#3bb273', label: 'Entertainment' },
  education: { icon: '📚', color: '#64a8f5', label: 'Education' },
  others: { icon: '📦', color: '#7a8299', label: 'Others' },
};

export const CURR: Record<string, { sym: string }> = {
  PHP: { sym: '₱' }, USD: { sym: '$' }, EUR: { sym: '€' }, GBP: { sym: '£' },
  JPY: { sym: '¥' }, KRW: { sym: '₩' }, AUD: { sym: 'A$' }, SGD: { sym: 'S$' },
  CAD: { sym: 'C$' }, INR: { sym: '₹' }, MYR: { sym: 'RM' },
};
