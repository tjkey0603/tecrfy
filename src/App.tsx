import { useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  Check,
  ChevronDown,
  Database,
  Download,
  LineChart,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  Wallet,
  X,
} from 'lucide-react';

type TransactionType = 'deposit' | 'withdrawal' | 'trade';
type AccountType = 'cfd' | 'isa';
type ViewMode = 'chart' | 'tally';
type Period = 'week' | 'month' | 'year';
type ChartRange = 'week' | 'month' | 'all';
type ChartMetric = 'account' | 'daily' | 'weekly' | 'monthly';
type TradeSummary = { pnl: number; count: number };

type Transaction = {
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  note: string;
  createdAt: number;
};

type SeriesPoint = {
  date: string;
  label: string;
  pnl: number;
  cumulative: number;
};

const STORAGE_KEYS: Record<AccountType, string> = {
  cfd: 'cfd-profit-tracker.transactions.v1',
  isa: 'stocks-isa-profit-tracker.transactions.v1',
};
const ACTIVE_ACCOUNT_KEY = 'profit-tracker.active-account.v1';
const moneyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const compactMoneyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const longDateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const monthYearFormatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromInput(value: string) {
  return new Date(`${value}T12:00:00`);
}

function offsetDate(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return dateInputValue(date);
}

function formatMoney(value: number, withSign = false) {
  const formatted = moneyFormatter.format(Math.abs(value));
  if (!withSign) return value < 0 ? `-${formatted}` : formatted;
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatCompactMoney(value: number) {
  return compactMoneyFormatter.format(value);
}

function readStoredTransactions(storageKey: string): Transaction[] | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Transaction[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStoredAccount(): AccountType {
  if (typeof window === 'undefined') return 'cfd';
  return window.localStorage.getItem(ACTIVE_ACCOUNT_KEY) === 'isa' ? 'isa' : 'cfd';
}

function isTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Transaction>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.type === 'deposit' || candidate.type === 'withdrawal' || candidate.type === 'trade') &&
    typeof candidate.amount === 'number' &&
    Number.isFinite(candidate.amount) &&
    typeof candidate.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.date) &&
    typeof candidate.note === 'string' &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt)
  );
}

function parseBackupFile(raw: string): Transaction[] {
  const parsed: unknown = JSON.parse(raw);
  const candidate = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && 'transactions' in parsed
      ? (parsed as { transactions?: unknown }).transactions
      : null;
  if (!Array.isArray(candidate)) throw new Error('This file does not contain a valid account ledger.');
  const validTransactions = candidate.filter(isTransaction);
  if (validTransactions.length !== candidate.length) {
    throw new Error('Some entries in this file are invalid.');
  }
  return validTransactions;
}

function createDemoTransactions(): Transaction[] {
  const createdAt = Date.now();
  return [
    { id: 'demo-deposit', type: 'deposit', amount: 2400, date: offsetDate(-28), note: 'Starting capital', createdAt: createdAt - 1000 * 60 * 60 * 24 * 28 },
    { id: 'demo-trade-1', type: 'trade', amount: 126.4, date: offsetDate(0), note: 'US indices', createdAt: createdAt - 1000 * 60 * 32 },
    { id: 'demo-trade-2', type: 'trade', amount: -48.75, date: offsetDate(-1), note: 'Late entry', createdAt: createdAt - 1000 * 60 * 60 * 25 },
    { id: 'demo-trade-3', type: 'trade', amount: 212.1, date: offsetDate(-3), note: 'London open', createdAt: createdAt - 1000 * 60 * 60 * 74 },
    { id: 'demo-withdrawal', type: 'withdrawal', amount: 300, date: offsetDate(-8), note: 'Paid to bank', createdAt: createdAt - 1000 * 60 * 60 * 24 * 8 },
    { id: 'demo-trade-4', type: 'trade', amount: 87.3, date: offsetDate(-10), note: 'DAX follow-through', createdAt: createdAt - 1000 * 60 * 60 * 24 * 10 },
  ];
}

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getPeriodDays(period: Period) {
  return period === 'week' ? 7 : period === 'month' ? 30 : 365;
}

function getPeriodStart(period: Period) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  if (period === 'year') return `${date.getFullYear()}-01-01`;
  date.setDate(date.getDate() - (getPeriodDays(period) - 1));
  return dateInputValue(date);
}

function percentOf(value: number, base: number) {
  if (!base) return 0;
  return (value / Math.abs(base)) * 100;
}

function App() {
  const initialAccount = readStoredAccount();
  const initialStored = readStoredTransactions(STORAGE_KEYS[initialAccount]);
  const [accountType, setAccountType] = useState<AccountType>(initialAccount);
  const [transactions, setTransactions] = useState<Transaction[]>(() => initialStored ?? (initialAccount === 'cfd' ? createDemoTransactions() : []));
  const [entryType, setEntryType] = useState<TransactionType>('trade');
  const [tradeResult, setTradeResult] = useState<'profit' | 'loss'>('profit');
  const [amount, setAmount] = useState('');
  const [entryDate, setEntryDate] = useState(dateInputValue(new Date()));
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState(false);
  const [period, setPeriod] = useState<Period>('month');
  const [viewMode, setViewMode] = useState<ViewMode>('chart');
  const [chartRange, setChartRange] = useState<ChartRange>('all');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('account');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [isDemo, setIsDemo] = useState(() => initialStored === null && initialAccount === 'cfd');
  const [fileError, setFileError] = useState('');
  const activeStorageKey = STORAGE_KEYS[accountType];
  const accountLabel = accountType === 'cfd' ? 'CFD ACCOUNT' : 'STOCKS ISA';

  useEffect(() => {
    window.localStorage.setItem(activeStorageKey, JSON.stringify(transactions));
  }, [activeStorageKey, transactions]);
  useEffect(() => {
    window.localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountType);
  }, [accountType]);

  const metrics = useMemo(() => {
    const totalDeposited = transactions.filter((t) => t.type === 'deposit').reduce((sum, t) => sum + t.amount, 0);
    const totalWithdrawn = transactions.filter((t) => t.type === 'withdrawal').reduce((sum, t) => sum + t.amount, 0);
    const totalTradePnl = transactions.filter((t) => t.type === 'trade').reduce((sum, t) => sum + t.amount, 0);
    const today = dateInputValue(new Date());
    const pnlSince = (start: string) => transactions.filter((t) => t.type === 'trade' && t.date >= start && t.date <= today).reduce((sum, t) => sum + t.amount, 0);
    const netFunding = totalDeposited - totalWithdrawn;
    return {
      totalDeposited,
      totalWithdrawn,
      netFunding,
      totalTradePnl,
      accountValue: netFunding + totalTradePnl,
      todayPnl: pnlSince(today),
      weekPnl: pnlSince(getPeriodStart('week')),
      monthPnl: pnlSince(getPeriodStart('month')),
      startingBalance: totalDeposited,
    };
  }, [transactions]);

  const chartSeries = useMemo<SeriesPoint[]>(() => {
    const today = dateFromInput(dateInputValue(new Date()));
    const days = chartRange === 'week' ? 7 : chartRange === 'month' ? 30 : Math.max(1, Math.min(90, transactions.length ? Math.ceil((today.getTime() - Math.min(...transactions.map((t) => dateFromInput(t.date).getTime()))) / 86400000) + 1 : 1));
    const start = new Date(today);
    start.setDate(today.getDate() - (days - 1));
    const transactionValueAt = (key: string) => transactions
      .filter((t) => t.date <= key)
      .reduce((sum, t) => sum + (t.type === 'deposit' ? t.amount : t.type === 'withdrawal' ? -t.amount : t.amount), 0);
    const tradePnlBetween = (fromKey: string, toKey: string) => transactions
      .filter((t) => t.type === 'trade' && t.date >= fromKey && t.date <= toKey)
      .reduce((sum, t) => sum + t.amount, 0);
    const rangeStartKey = dateInputValue(start);
    const pointValue = (date: Date) => {
      const key = dateInputValue(date);
      if (chartMetric === 'account') return transactionValueAt(key);
      if (chartMetric === 'daily') return tradePnlBetween(rangeStartKey, key);
      const lookback = chartMetric === 'monthly' ? 30 : chartMetric === 'weekly' ? 7 : 0;
      if (!lookback) return transactionValueAt(key);
      const from = new Date(date);
      from.setDate(date.getDate() - (lookback - 1));
      const fromKey = dateInputValue(from);
      return tradePnlBetween(fromKey, key);
    };
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const value = pointValue(date);
      return { date: dateInputValue(date), label: days === 1 ? 'Today' : shortDateFormatter.format(date), pnl: value, cumulative: value };
    });
  }, [chartMetric, chartRange, transactions]);

  const recentTransactions = useMemo(() => [...transactions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8), [transactions]);

  function openSheet(type: TransactionType, transaction?: Transaction) {
    setEntryType(type);
    setTradeResult(transaction?.amount && transaction.amount < 0 ? 'loss' : 'profit');
    setAmount(transaction ? String(Math.abs(transaction.amount)) : '');
    setNote(transaction ? transaction.note : '');
    setFormError('');
    setEntryDate(transaction?.date ?? dateInputValue(new Date()));
    setSaved(false);
    setEditingId(transaction?.id ?? null);
    setMenuOpen(false);
    setAccountMenuOpen(false);
    setSheetOpen(true);
  }

  function switchAccount(nextAccount: AccountType) {
    if (nextAccount === accountType) {
      setAccountMenuOpen(false);
      return;
    }
    const storedTransactions = readStoredTransactions(STORAGE_KEYS[nextAccount]);
    setAccountType(nextAccount);
    setTransactions(storedTransactions ?? []);
    setIsDemo(false);
    setConfirmClear(false);
    setFileError('');
    setAccountMenuOpen(false);
  }

  function handleAddEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!amount.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError(entryType === 'trade' ? 'Enter a positive amount.' : 'Enter an amount greater than zero.');
      return;
    }
    if (!entryDate) {
      setFormError('Choose the date this entry happened.');
      return;
    }
    const signedTradeAmount = tradeResult === 'loss' ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);
    const nextTransaction: Transaction = {
      id: makeId(),
      type: entryType,
      amount: entryType === 'trade' ? signedTradeAmount : Math.abs(parsedAmount),
      date: entryDate,
      note: note.trim() || (entryType === 'trade' ? 'Trade result' : entryType === 'deposit' ? 'Bank deposit' : 'Bank withdrawal'),
      createdAt: Date.now(),
    };
    setTransactions((current) => editingId
      ? current.map((transaction) => transaction.id === editingId ? { ...nextTransaction, id: editingId, createdAt: transaction.createdAt } : transaction)
      : [nextTransaction, ...current]);
    setIsDemo(false);
    setSaved(true);
    window.setTimeout(() => {
      setSaved(false);
      setSheetOpen(false);
      setAmount('');
      setNote('');
      setEditingId(null);
    }, 500);
  }

  function handleDelete(id: string) {
    setTransactions((current) => current.filter((transaction) => transaction.id !== id));
    setIsDemo(false);
  }

  function handleClear() {
    setTransactions([]);
    setIsDemo(false);
    setConfirmClear(false);
  }

  function restoreDemo() {
    setTransactions(createDemoTransactions());
    setIsDemo(true);
    setMenuOpen(false);
    setConfirmClear(false);
  }

  async function saveAsFile() {
    const backup = {
      app: 'Profit Tracker',
      account: accountType,
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions,
    };
    const json = JSON.stringify(backup, null, 2);
    const filename = `${accountType === 'cfd' ? 'cfd-account' : 'stocks-isa'}-${dateInputValue(new Date())}.json`;

    if (Capacitor.isNativePlatform()) {
      try {
        const written = await Filesystem.writeFile({
          path: filename,
          data: json,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        await Share.share({ title: filename, url: written.uri, dialogTitle: 'Save backup' });
        setFileError('');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!/cancel/i.test(message)) setFileError('Could not export the backup file.');
      }
      setMenuOpen(false);
      return;
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setFileError('');
    setMenuOpen(false);
  }

  async function loadFromFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const importedTransactions = parseBackupFile(await file.text());
      setTransactions(importedTransactions);
      setIsDemo(false);
      setFileError('');
      setMenuOpen(false);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not load this file.');
      setMenuOpen(false);
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="mobile-header reveal">
          <div className="account-switcher-wrap">
            <button className="account-selector" type="button" onClick={() => { setAccountMenuOpen((open) => !open); setMenuOpen(false); }} aria-label="Switch account" aria-expanded={accountMenuOpen} data-testid="button-account-switcher">
              <span className="eyebrow">{accountLabel}</span>
              <ChevronDown size={15} />
            </button>
          </div>
          <div className="header-menu-wrap">
            <button className="icon-button overflow-button" type="button" onClick={() => { setMenuOpen((open) => !open); setAccountMenuOpen(false); }} aria-label="Open account menu" aria-expanded={menuOpen} data-testid="button-account-menu">
              <MoreHorizontal size={21} />
            </button>
          </div>
        </header>
        {accountMenuOpen && (
          <>
            <div className="menu-backdrop" aria-hidden="true" onClick={() => setAccountMenuOpen(false)} />
            <div className="account-switcher-menu" role="menu" aria-label="Choose account">
              <span className="menu-status">Switch account</span>
              <button className={accountType === 'cfd' ? 'selected' : ''} type="button" role="menuitem" onClick={() => switchAccount('cfd')} data-testid="button-switch-cfd">
                <span>CFD Account</span>
                {accountType === 'cfd' ? <Check size={14} /> : null}
              </button>
              <button className={accountType === 'isa' ? 'selected' : ''} type="button" role="menuitem" onClick={() => switchAccount('isa')} data-testid="button-switch-isa">
                <span>Switch to Stocks ISA</span>
                {accountType === 'isa' ? <Check size={14} /> : null}
              </button>
            </div>
          </>
        )}
        {menuOpen && (
          <>
            <div className="menu-backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />
            <div className="account-menu" role="menu">
              {isDemo && <span className="menu-status"><Database size={13} />Demo data</span>}
              <button type="button" role="menuitem" onClick={() => { setConfirmClear(true); setMenuOpen(false); }} data-testid="button-reset-account"><RefreshCw size={13} />Reset account</button>
              <button type="button" role="menuitem" onClick={saveAsFile} data-testid="button-save-file"><Download size={13} />Save as file</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); document.getElementById('ledger-file-input')?.click(); }} data-testid="button-load-file"><Upload size={13} />Load file</button>
              {isDemo && <button type="button" role="menuitem" onClick={restoreDemo} data-testid="button-restore-demo"><Database size={13} />Restore demo</button>}
            </div>
          </>
        )}
        <input id="ledger-file-input" className="visually-hidden" type="file" accept="application/json,.json" onChange={loadFromFile} />
        {fileError && <div className="file-error" role="alert"><span>{fileError}</span><button type="button" onClick={() => setFileError('')} aria-label="Dismiss file error"><X size={14} /></button></div>}

        <section className="account-card reveal reveal-delay-1" data-testid="card-account-value">
          <p className="card-eyebrow">ACCOUNT VALUE</p>
          <div className="account-value" data-testid="text-account-value">{formatMoney(metrics.accountValue)}</div>
          <p className="card-caption">Calculated from bank transfers + trade P/L</p>
          <div className="account-pnl">
            <p className="card-eyebrow">TRADE P/L</p>
            <div className={`account-pnl-value ${metrics.totalTradePnl < 0 ? 'negative' : ''}`} data-testid="text-total-trade-pnl">
              {formatMoney(metrics.totalTradePnl, true)} <span>{percentOf(metrics.totalTradePnl, metrics.startingBalance).toFixed(2)}%</span>
            </div>
          </div>
          <div className="account-divider" />
          <div className="account-sources">
            <div><span className="source-label"><ArrowDownLeft size={15} />From bank</span><strong data-testid="text-total-deposited">{formatMoney(metrics.totalDeposited)}</strong></div>
            <div><span className="source-label"><ArrowUpRight size={15} />To bank</span><strong data-testid="text-total-withdrawn">{formatMoney(metrics.totalWithdrawn)}</strong></div>
          </div>
        </section>

        <section className="pnl-section reveal reveal-delay-2" aria-labelledby="pnl-heading">
          <div className="section-title-row"><h2 id="pnl-heading">TRADE P/L</h2></div>
          <div className="pnl-cards">
            <MetricCard label="Today" value={metrics.todayPnl} base={metrics.startingBalance} testId="today" />
            <MetricCard label="Week" value={metrics.weekPnl} base={metrics.startingBalance} testId="week" />
            <MetricCard label="Month" value={metrics.monthPnl} base={metrics.startingBalance} testId="month" />
          </div>
        </section>

        <section className="surface-card chart-card reveal reveal-delay-3" aria-labelledby={viewMode === 'chart' ? 'chart-heading' : 'tally-heading'}>
          {viewMode === 'chart' ? (
            <>
              <div className="surface-heading">
                <h2 id="chart-heading">Chart</h2>
                <div className="segmented compact" role="tablist" aria-label="Chart range">
                  {(['week', 'month', 'all'] as ChartRange[]).map((option) => (
                    <button key={option} className={chartRange === option ? 'active' : ''} type="button" onClick={() => setChartRange(option)} data-testid={`button-chart-range-${option}`}>{option === 'week' ? '1W' : option === 'month' ? '1M' : 'ALL'}</button>
                  ))}
                </div>
              </div>
              <div className="segmented chart-metrics" role="tablist" aria-label="Chart measure">
                {(['account', 'daily', 'weekly', 'monthly'] as ChartMetric[]).map((option) => (
                  <button key={option} className={chartMetric === option ? 'active' : ''} type="button" onClick={() => setChartMetric(option)} data-testid={`button-chart-metric-${option}`}>{option[0].toUpperCase() + option.slice(1)}</button>
                ))}
              </div>
              <PerformanceChart series={chartSeries} metric={chartMetric} />
            </>
          ) : <PerformanceTally transactions={transactions} period={period} onPeriodChange={setPeriod} />}
          <div className="chart-view-switch" role="tablist" aria-label="Chart or tally">
            <button className={viewMode === 'chart' ? 'active' : ''} type="button" onClick={() => setViewMode('chart')} data-testid="button-view-chart"><LineChart size={14} />Chart</button>
            <button className={viewMode === 'tally' ? 'active' : ''} type="button" onClick={() => setViewMode('tally')} data-testid="button-view-tally"><List size={14} />Tally</button>
          </div>
        </section>

        <section className="surface-card activity-card reveal" aria-labelledby="activity-heading">
          <div className="surface-heading"><div><h2 id="activity-heading">Activity</h2><p className="surface-subtitle">{transactions.length ? `${transactions.length} ${transactions.length === 1 ? 'entry' : 'entries'} saved on this device` : 'Your ledger is ready'}</p></div>{transactions.length > 0 && <button className="text-danger-button" type="button" onClick={() => setConfirmClear(true)} data-testid="button-clear-data"><Trash2 size={13} />Clear</button>}</div>
           {confirmClear && <div className="clear-confirm" role="alert"><span>Reset this account?</span><div><button type="button" onClick={() => setConfirmClear(false)} data-testid="button-cancel-clear">Keep</button><button className="danger-fill" type="button" onClick={handleClear} data-testid="button-confirm-clear">Reset account</button></div></div>}
          {recentTransactions.length ? <div className="activity-list">{recentTransactions.map((transaction) => <ActivityRow key={transaction.id} transaction={transaction} accountValue={transactions.filter((item) => item.createdAt <= transaction.createdAt).reduce((sum, item) => sum + (item.type === 'withdrawal' ? -item.amount : item.amount), 0)} onDelete={handleDelete} onEdit={(item) => openSheet(item.type, item)} />)}</div> : <div className="empty-activity" data-testid="empty-activity"><Wallet size={18} /><strong>No activity yet</strong><p>Add a trade or move money from the action bar.</p></div>}
        </section>

        <p className="footer-note"><RefreshCw size={12} />Offline first · nothing leaves this device</p>
      </div>

      <nav className="bottom-actions" aria-label="Ledger actions">
        <button className="bank-action" type="button" onClick={() => openSheet('deposit')} data-testid="button-open-bank"><Banknote size={17} />Bank</button>
        <button className="trade-action" type="button" onClick={() => openSheet('trade')} data-testid="button-open-trade"><Plus size={18} />Log trade</button>
      </nav>

      {sheetOpen && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSheetOpen(false); }}>
          <section className="entry-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
            <div className="sheet-handle" />
            <div className="sheet-heading"><h2 id="sheet-title">{editingId ? 'Edit entry' : entryType === 'trade' ? 'Log trade' : 'Bank transfer'}</h2><button className="sheet-close" type="button" onClick={() => { setSheetOpen(false); setEditingId(null); }} aria-label="Close entry form" data-testid="button-close-sheet"><X size={20} /></button></div>
            <div className="segmented sheet-mode" role="tablist" aria-label="Entry mode">
              <button className={entryType === 'trade' ? 'active' : ''} type="button" onClick={() => { setEntryType('trade'); setFormError(''); }} data-testid="button-sheet-trade">Trade P/L</button>
              <button className={entryType !== 'trade' ? 'active' : ''} type="button" onClick={() => { setEntryType('deposit'); setFormError(''); }} data-testid="button-sheet-bank">Bank</button>
            </div>
            <form onSubmit={handleAddEntry}>
              <label className="form-label" htmlFor="entry-date">Date</label>
              <div className="date-input-wrap"><CalendarDays size={16} /><input id="entry-date" className="form-input" type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} data-testid="input-entry-date" /></div>
              {entryType === 'trade' ? (
                <>
                  <label className="form-label">Result</label>
                  <div className="segmented result-tabs" role="tablist" aria-label="Profit or loss">
                    <button className={tradeResult === 'profit' ? 'active profit' : ''} type="button" onClick={() => setTradeResult('profit')} data-testid="button-result-profit"><TrendingUp size={15} />Profit</button>
                    <button className={tradeResult === 'loss' ? 'active loss' : ''} type="button" onClick={() => setTradeResult('loss')} data-testid="button-result-loss"><TrendingDown size={15} />Loss</button>
                  </div>
                </>
              ) : (
                <>
                  <label className="form-label">Bank movement</label>
                  <div className="segmented result-tabs" role="tablist" aria-label="Bank movement">
                    <button className={entryType === 'deposit' ? 'active profit' : ''} type="button" onClick={() => setEntryType('deposit')} data-testid="button-result-added"><ArrowDownLeft size={15} />Money added</button>
                    <button className={entryType === 'withdrawal' ? 'active loss' : ''} type="button" onClick={() => setEntryType('withdrawal')} data-testid="button-result-sent"><ArrowUpRight size={15} />Sent to bank</button>
                  </div>
                </>
              )}
              <label className="form-label" htmlFor="entry-amount">Amount (£)</label>
              <div className="amount-field"><span>£</span><input id="entry-amount" className="form-input" type="number" min="0" inputMode="decimal" step="0.01" placeholder="0.00" value={amount} onChange={(event) => { setAmount(event.target.value); setFormError(''); }} data-testid="input-entry-amount" /></div>
              <label className="form-label" htmlFor="entry-note">Note <span>optional</span></label>
              <textarea id="entry-note" className="form-input note-input" maxLength={48} placeholder="Optional" value={note} onChange={(event) => setNote(event.target.value)} data-testid="input-entry-note" />
              <div className="account-preview">Account becomes <strong>{formatMoney(metrics.accountValue + (entryType === 'trade' ? (tradeResult === 'loss' ? -1 : 1) : entryType === 'withdrawal' ? -1 : 1) * (Number(amount) || 0))}</strong><span>({formatMoney((entryType === 'trade' ? (tradeResult === 'loss' ? -1 : 1) : entryType === 'withdrawal' ? -1 : 1) * (Number(amount) || 0), true)})</span></div>
              {formError && <p className="form-error" role="alert" data-testid="status-form-error">{formError}</p>}
              <div className="sheet-actions"><button className="cancel-sheet" type="button" onClick={() => { setSheetOpen(false); setEditingId(null); }} data-testid="button-cancel-entry">Cancel</button><button className={`save-sheet ${saved ? 'is-saved' : ''}`} type="submit" data-testid="button-save-entry">{saved ? <Check size={17} /> : null}{saved ? 'Saved' : 'Save'}</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function MetricCard({ label, value, base, testId }: { label: string; value: number; base: number; testId: string }) {
  const percentage = percentOf(value, base);
  const isNegative = value < 0;
  return (
    <div className="pnl-card" data-testid={`card-metric-${testId}`}>
      <div className="pnl-card-label">{label}</div>
      <div className={`pnl-card-value ${isNegative ? 'negative' : ''}`} data-testid={`text-pnl-${testId}`}>{value === 0 ? 'No trades' : formatMoney(value, true)}</div>
      <div className={`pnl-card-change ${isNegative ? 'negative' : ''}`}>{value === 0 ? '—' : `${percentage >= 0 ? '+' : ''}${percentage.toFixed(1)}%`}</div>
    </div>
  );
}

function PerformanceChart({ series, metric }: { series: SeriesPoint[]; metric: ChartMetric }) {
  const width = 600;
  const height = 228;
  const left = 43;
  const right = 17;
  const top = 13;
  const bottom = 30;
  const values = series.map((point) => Number.isFinite(point.cumulative) ? point.cumulative : 0);
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 0);
  const valueRange = rawMax - rawMin;
  const padding = Math.max(valueRange * 0.14, metric === 'account' ? 35 : 12);
  const min = valueRange === 0 ? rawMin - padding : rawMin;
  const max = valueRange === 0 ? rawMax + padding : rawMax;
  const lower = min - padding;
  const upper = max + padding;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const xAt = (index: number) => left + (series.length === 1 ? chartWidth / 2 : (index / (series.length - 1)) * chartWidth);
  const yAt = (value: number) => top + ((upper - value) / (upper - lower)) * chartHeight;
  const coordinates = series.map((point, index) => ({ x: xAt(index), y: yAt(point.cumulative) }));
  const smoothPath = coordinates.length === 1
    ? `M ${coordinates[0].x} ${coordinates[0].y}`
    : coordinates.reduce((path, point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const previous = coordinates[index - 1];
      const middleX = (previous.x + point.x) / 2;
      return `${path} C ${middleX} ${previous.y}, ${middleX} ${point.y}, ${point.x} ${point.y}`;
    }, '');
  const zeroInDomain = lower <= 0 && upper >= 0;
  const baseline = zeroInDomain ? yAt(0) : height - bottom;
  const areaPath = coordinates.length ? `${smoothPath} L ${coordinates[coordinates.length - 1].x} ${baseline} L ${coordinates[0].x} ${baseline} Z` : '';
  const labelIndexes = series.length <= 7 ? [0, Math.max(0, Math.floor((series.length - 1) / 2)), series.length - 1] : [0, Math.floor((series.length - 1) / 2), series.length - 1];
  return (
    <div className="chart-wrap" data-testid="chart-performance">
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric} performance chart`}>
        <defs>
          <linearGradient id="chart-area-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#d9d5d0" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#d9d5d0" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.333, 0.666, 1].map((guide) => <g key={guide}><line className="chart-grid-line" x1={left} x2={width - right} y1={top + guide * chartHeight} y2={top + guide * chartHeight} /><text className="chart-axis-value" x={left - 8} y={top + guide * chartHeight + 4} textAnchor="end">{formatCompactMoney(upper - guide * (upper - lower))}</text></g>)}
        {zeroInDomain && <line className="chart-zero-line" x1={left} x2={width - right} y1={yAt(0)} y2={yAt(0)} />}
        {areaPath && <path className="chart-area" d={areaPath} />}
        {smoothPath && <path className="chart-line" d={smoothPath} />}
        {series.map((point, index) => (series.length <= 14 || index === series.length - 1) && <circle key={point.date} className="chart-point" cx={xAt(index)} cy={yAt(point.cumulative)} r={index === series.length - 1 ? 4.5 : 2.2} />)}
        {labelIndexes.map((index) => <text key={`${series[index].date}-${index}`} className="chart-axis-label" x={xAt(index)} y={height - 8} textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}>{series[index].label}</text>)}
      </svg>
      <div className="chart-legend"><span><span className="legend-line" />{metric === 'account' ? 'Account value' : `${metric[0].toUpperCase()}${metric.slice(1)} P/L`}</span><strong>{formatMoney(series[series.length - 1]?.cumulative ?? 0, true)}</strong></div>
    </div>
  );
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function PerformanceTally({ transactions, period, onPeriodChange }: { transactions: Transaction[]; period: Period; onPeriodChange: (period: Period) => void }) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateInputValue(today));
  const tradeByDate = useMemo(() => {
    const summaries = new Map<string, TradeSummary>();
    transactions.filter((transaction) => transaction.type === 'trade').forEach((transaction) => {
      const current = summaries.get(transaction.date) ?? { pnl: 0, count: 0 };
      summaries.set(transaction.date, { pnl: current.pnl + transaction.amount, count: current.count + 1 });
    });
    return summaries;
  }, [transactions]);

  const calendar = useMemo(() => {
    const summaryFor = (date: Date) => {
      const dateKey = dateInputValue(date);
      return { date, dateKey, ...(tradeByDate.get(dateKey) ?? { pnl: 0, count: 0 }) };
    };
    if (period === 'week') {
      const start = startOfWeek(today);
      return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        return summaryFor(date);
      });
    }
    const firstDay = new Date(currentYear, currentMonth, 1, 12);
    const firstCell = period === 'month' ? new Date(firstDay) : new Date(currentYear, 0, 1, 12);
    firstCell.setDate(firstCell.getDate() - firstCell.getDay());
    const cellCount = period === 'month' ? 42 : 0;
    return period === 'month'
      ? Array.from({ length: cellCount }, (_, index) => {
        const date = new Date(firstCell);
        date.setDate(firstCell.getDate() + index);
        return { ...summaryFor(date), inCurrentMonth: date.getMonth() === currentMonth };
      })
      : [];
  }, [currentMonth, currentYear, period, today, tradeByDate]);

  const range = useMemo(() => {
    if (period === 'week') {
      const start = startOfWeek(today);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start: dateInputValue(start), end: dateInputValue(end) };
    }
    if (period === 'month') {
      return {
        start: dateInputValue(new Date(currentYear, currentMonth, 1, 12)),
        end: dateInputValue(new Date(currentYear, currentMonth + 1, 0, 12)),
      };
    }
    return {
      start: `${currentYear}-01-01`,
      end: `${currentYear}-12-31`,
    };
  }, [currentMonth, currentYear, period, today]);

  const total = useMemo(() => transactions
    .filter((transaction) => transaction.type === 'trade' && transaction.date >= range.start && transaction.date <= range.end)
    .reduce((sum, transaction) => sum + transaction.amount, 0), [range.end, range.start, transactions]);
  const tradeCount = useMemo(() => transactions
    .filter((transaction) => transaction.type === 'trade' && transaction.date >= range.start && transaction.date <= range.end)
    .length, [range.end, range.start, transactions]);
  const selectedTransactions = useMemo(() => transactions
    .filter((transaction) => transaction.date === selectedDateKey)
    .sort((a, b) => b.createdAt - a.createdAt), [selectedDateKey, transactions]);
  const selectedPnl = selectedTransactions
    .filter((transaction) => transaction.type === 'trade')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const periodLabel = period === 'week' ? 'Weekly P/L' : period === 'month' ? 'Monthly P/L' : 'Yearly P/L';
  const title = period === 'week'
    ? `Week of ${longDateFormatter.format(startOfWeek(today))}`
    : period === 'month'
      ? monthYearFormatter.format(today)
      : `${currentYear}`;
  const monthSummaries = Array.from({ length: 12 }, (_, monthIndex) => {
    const start = `${currentYear}-${String(monthIndex + 1).padStart(2, '0')}-01`;
    const end = dateInputValue(new Date(currentYear, monthIndex + 1, 0, 12));
    const trades = transactions.filter((transaction) => transaction.type === 'trade' && transaction.date >= start && transaction.date <= end);
    return { monthIndex, pnl: trades.reduce((sum, transaction) => sum + transaction.amount, 0), count: trades.length };
  });

  return (
    <div className="tally-content" data-testid="tally-performance">
      <div className="tally-heading">
        <div>
          <p className="tally-period-title">{title}</p>
          <h2 id="tally-heading">Tally</h2>
        </div>
        <div className="tally-total-pill">
          <span>{periodLabel}</span>
          <strong className={total < 0 ? 'negative' : ''}>{formatMoney(total, true)}</strong>
          <ChevronDown size={15} />
        </div>
      </div>
      <div className="tally-toolbar">
        <span><CalendarDays size={15} />{tradeCount} {tradeCount === 1 ? 'trade' : 'trades'}</span>
        <span>{period === 'week' ? 'Sun – Sat' : period === 'month' ? 'Daily results' : 'Monthly results'}</span>
      </div>
      <div className="segmented tally-tabs" role="tablist" aria-label="Tally period">
        {(['week', 'month', 'year'] as Period[]).map((option) => (
          <button key={option} className={period === option ? 'active' : ''} type="button" onClick={() => onPeriodChange(option)} data-testid={`button-period-${option}`}>
            {option === 'week' ? 'Weekly' : option === 'month' ? 'Monthly' : 'Yearly'}
          </button>
        ))}
      </div>
      {period === 'year' ? (
        <div className="year-overview">
          {monthSummaries.map(({ monthIndex, pnl, count }) => (
            <button
              className={`year-month-card ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}`}
              key={monthIndex}
              type="button"
              onClick={() => {
                onPeriodChange('month');
                setSelectedDateKey(`${currentYear}-${String(monthIndex + 1).padStart(2, '0')}-01`);
              }}
              aria-label={`Open ${new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(new Date(currentYear, monthIndex, 1))}`}
            >
              <span>{new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(currentYear, monthIndex, 1))}</span>
              <strong>{formatMoney(pnl, true)}</strong>
              <small>{count} {count === 1 ? 'trade' : 'trades'}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className={`tally-calendar tally-calendar-${period}`}>
          <div className="calendar-weekdays">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
          <div className="calendar-grid">
            {calendar.map((cell) => (
              <button
                className={`calendar-cell ${cell.pnl > 0 ? 'positive' : cell.pnl < 0 ? 'negative' : ''} ${'inCurrentMonth' in cell && !cell.inCurrentMonth ? 'outside-month' : ''} ${cell.dateKey === dateInputValue(today) ? 'today' : ''}`}
                key={cell.dateKey}
                type="button"
                onClick={() => setSelectedDateKey(cell.dateKey)}
                aria-pressed={selectedDateKey === cell.dateKey}
                aria-label={`${longDateFormatter.format(cell.date)}${cell.count ? `, ${formatMoney(cell.pnl, true)}, ${cell.count} ${cell.count === 1 ? 'trade' : 'trades'}` : ''}`}
              >
                <span className="calendar-cell-day">{cell.date.getDate()}</span>
                {cell.count > 0 && <><strong>{formatMoney(cell.pnl, true)}</strong><small>{cell.count} {cell.count === 1 ? 'trade' : 'trades'}</small></>}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="tally-day-detail" data-testid="tally-day-detail" aria-live="polite">
        <div className="tally-day-heading">
          <div>
            <p>Selected day</p>
            <h3>{longDateFormatter.format(dateFromInput(selectedDateKey))}</h3>
          </div>
          <strong className={selectedPnl < 0 ? 'negative' : ''}>{formatMoney(selectedPnl, true)}</strong>
        </div>
        {selectedTransactions.length ? (
          <div className="tally-trade-list">
            {selectedTransactions.map((transaction) => {
              const isTrade = transaction.type === 'trade';
              const signedAmount = transaction.type === 'withdrawal' ? -transaction.amount : transaction.amount;
              const title = transaction.type === 'deposit' ? 'From bank' : transaction.type === 'withdrawal' ? 'To bank' : 'Trade P/L';
              return (
                <div className="tally-trade-row" key={transaction.id}>
                  <div>
                    <strong>{title}</strong>
                    <span>{transaction.note}</span>
                  </div>
                  <b className={(isTrade && transaction.amount < 0) || signedAmount < 0 ? 'negative' : ''}>{formatMoney(signedAmount, true)}</b>
                </div>
              );
            })}
          </div>
        ) : <p className="tally-day-empty">No trades or account entries on this day.</p>}
      </div>
    </div>
  );
}

function ActivityRow({ transaction, accountValue, onDelete, onEdit }: { transaction: Transaction; accountValue: number; onDelete: (id: string) => void; onEdit: (transaction: Transaction) => void }) {
  const isLoss = transaction.type === 'trade' && transaction.amount < 0;
  const title = transaction.type === 'deposit' ? 'From bank' : transaction.type === 'withdrawal' ? 'To bank' : 'Trade P/L';
  const amount = transaction.type === 'withdrawal' ? -transaction.amount : transaction.amount;
  return (
    <div className="activity-row" data-testid={`row-activity-${transaction.id}`}>
      <div className={`activity-icon ${transaction.type === 'withdrawal' ? 'withdrawal' : isLoss ? 'trade-loss' : ''}`}>{transaction.type === 'deposit' ? <ArrowDownLeft size={16} /> : transaction.type === 'withdrawal' ? <ArrowUpRight size={16} /> : <Banknote size={16} />}</div>
      <div className="activity-copy"><div className="activity-name">{title}</div><div className="activity-meta">{longDateFormatter.format(dateFromInput(transaction.date))} · {transaction.note}</div><div className="activity-account">Account {formatMoney(accountValue)}</div></div>
      <div className={`activity-amount ${amount < 0 ? 'negative' : ''}`}>{formatMoney(amount, true)}</div>
      <div className="activity-actions"><button type="button" aria-label={`Edit ${title} entry`} onClick={() => onEdit(transaction)} data-testid={`button-edit-${transaction.id}`}><Pencil size={15} /></button><button type="button" aria-label={`Delete ${title} entry`} onClick={() => onDelete(transaction.id)} data-testid={`button-delete-${transaction.id}`}><Trash2 size={15} /></button></div>
    </div>
  );
}

export default App;