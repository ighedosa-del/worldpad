'use client';

export interface AccountInfo {
  loginid: string;
  isVirtual: boolean;
  currency: string;
  balance?: number;
}

export interface AuthResult {
  loginid: string;
  fullname: string;
  balance: number;
  currency: string;
  isVirtual: boolean;
  scopes: string[];
  accountList: AccountInfo[];
}

export interface TickData {
  symbol: string;
  price: number;
  digit: number;
  epoch: number;
  timestamp: number;
}

export interface ProposalResult {
  id: string;
  askPrice: number;
  payout: number;
}

export interface BuyResult {
  contractId: string;
  buyPrice: number;
  payout: number;
  profit: number;
  balanceAfter: number;
}
